// ── state ──
let currentTrackId = null
let currentLyrics = []
let currentLineIndex = -1
let progressMs = 0
let durationMs = 0
let isPlaying = false
let translationEnabled = true
let lastServerSync = Date.now()
let lastKnownData = null
let isLoggedIn = false
let isFetching = false
let currentContentState = null // 'lyrics' | 'no-lyrics' | 'english' | 'loading' | null
const translation_cache_js = {}

const SYNC_OFFSET = -200

// ── element refs ──
const topBar = document.getElementById('top-bar')
const albumArt = document.getElementById('album-art')
const songName = document.getElementById('song-name')
const artistName = document.getElementById('artist-name')
const langBadge = document.getElementById('lang-badge')
const stateScreen = document.getElementById('state-screen')
const stateIcon = document.getElementById('state-icon')
const stateTitle = document.getElementById('state-title')
const stateSubtitle = document.getElementById('state-subtitle')
const lyricsContainer = document.getElementById('lyrics-container')
const lyricsInner = document.getElementById('lyrics-inner')
const bottomBar = document.getElementById('bottom-bar')
const progressBar = document.getElementById('progress-bar')
const timeCurrent = document.getElementById('time-current')
const timeTotal = document.getElementById('time-total')

// ── content panel: only the middle changes ──
function showContent(type, options = {}) {
  if (type === 'lyrics') {
    stateScreen.style.display = 'none'
    lyricsContainer.style.display = 'flex'
  } else {
    lyricsContainer.style.display = 'none'
    stateScreen.style.display = 'flex'
    stateIcon.textContent = options.icon || '🎵'
    stateTitle.textContent = options.title || ''
    stateSubtitle.textContent = options.subtitle || ''
    document.getElementById('login-btn').style.display =
      options.showLogin ? 'inline-flex' : 'none'
  }
}

// ── pre-login state: hide bars, show welcome ──
function showWelcome() {
  topBar.style.display = 'none'
  bottomBar.style.display = 'none'
  stateScreen.style.display = 'flex'
  lyricsContainer.style.display = 'none'
  stateIcon.textContent = '🎵'
  stateTitle.textContent = 'Welcome to LyricSync'
  stateSubtitle.textContent = 'Connect your Spotify account to see real-time translated lyrics'
  document.getElementById('login-btn').style.display = 'inline-flex'
}

// ── post-login: bars always visible ──
function showBars() {
  topBar.style.display = 'flex'
  bottomBar.style.display = 'flex'
}

// ── helpers ──
function formatTime(ms) {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

function getCurrentLineIndex(lyrics, ms) {
  let idx = 0
  for (let i = 0; i < lyrics.length; i++) {
    if (lyrics[i].time_ms <= ms) { idx = i } else { break }
  }
  return idx
}

function renderLyrics(lyrics) {
  lyricsInner.innerHTML = ''
  lyrics.forEach((line, index) => {
    const div = document.createElement('div')
    div.className = 'lyric-line'
    div.dataset.index = index

    const original = document.createElement('div')
    original.className = 'lyric-original'
    original.textContent = line.original

    const translation = document.createElement('div')
    translation.className = 'lyric-translation'
    translation.textContent = line.translation

    div.appendChild(original)
    div.appendChild(translation)
    lyricsInner.appendChild(div)
  })

  if (!translationEnabled) {
    document.querySelectorAll('.lyric-translation').forEach(el => {
      el.style.display = 'none'
    })
  }
}

function updateActiveLine(index) {
  if (index === currentLineIndex) return
  currentLineIndex = index

  document.querySelectorAll('.lyric-line').forEach((line, i) => {
    line.classList.remove('active', 'near')
    if (i === index) line.classList.add('active')
    else if (i === index - 1 || i === index + 1) line.classList.add('near')
  })

  const activeLine = document.querySelectorAll('.lyric-line')[index]
  if (activeLine) activeLine.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

function updateProgressBar(ms, dur) {
  if (dur > 0) {
    progressBar.style.width = `${Math.min((ms / dur) * 100, 100)}%`
    timeCurrent.textContent = formatTime(ms)
    timeTotal.textContent = formatTime(dur)
  }
}

function updatePlayPauseIcon(playing) {
  document.getElementById('play-icon').style.display = playing ? 'none' : 'block'
  document.getElementById('pause-icon').style.display = playing ? 'block' : 'none'
}

function updateTopBar(data) {
  songName.textContent = data.song
  artistName.textContent = data.artist
  if (data.album_art) albumArt.src = data.album_art
}

function updateBottomBar(data) {
  const bottomArt = document.getElementById('bottom-art')
  if (data.album_art) {
    bottomArt.src = data.album_art
    bottomArt.style.display = 'block'
  } else {
    bottomArt.style.display = 'none'
  }
  document.getElementById('bottom-song').textContent = data.song
  document.getElementById('bottom-artist').textContent = data.artist
}

// ── translation toggle ──
function toggleTranslation() {
  translationEnabled = !translationEnabled
  const toggle = document.getElementById('toggle-switch')
  toggle.classList.toggle('on', translationEnabled)
  document.querySelectorAll('.lyric-translation').forEach(el => {
    el.style.display = translationEnabled ? '' : 'none'
  })
}

// ── playback controls ──
async function sendPlayback(action) {
  try {
    const res = await fetch('/playback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action })
    })
    if (res.ok) setTimeout(fetchNowPlaying, 400)
  } catch (e) {
    console.error('Playback error:', e)
  }
}

async function togglePlayPause() {
  const action = isPlaying ? 'pause' : 'play'
  await sendPlayback(action)
}

// ── context (queue) ──
async function fetchContext() {
  if (!isLoggedIn) return
  try {
    const res = await fetch('/context')
    if (!res.ok) return
    const data = await res.json()
    renderContext(data.previous || [], data.next || [])
  } catch (e) {
    console.error('Context error:', e)
  }
}

function renderContext(prev, next) {
  const list = document.getElementById('queue-list')
  const dot = document.getElementById('queue-dot')

  if (!prev.length && !next.length) {
    list.innerHTML = '<div class="queue-empty">Nothing queued — add songs in Spotify</div>'
    dot.classList.remove('visible')
    return
  }

  dot.classList.add('visible')
  list.innerHTML = ''

  if (prev.length) {
    const prevHeader = document.createElement('div')
    prevHeader.className = 'queue-section-label'
    prevHeader.textContent = 'Recently Played'
    list.appendChild(prevHeader)
    prev.forEach(track => list.appendChild(buildQueueItem(track, 'prev')))
  }

  if (next.length) {
    const nextHeader = document.createElement('div')
    nextHeader.className = 'queue-section-label'
    nextHeader.textContent = 'Playing Next'
    list.appendChild(nextHeader)
    next.forEach((track, i) => list.appendChild(buildQueueItem(track, 'next', i + 1)))
  }
}

function buildQueueItem(track, direction, num) {
  const div = document.createElement('div')
  div.className = `queue-item ${direction === 'prev' ? 'queue-item-prev' : ''}`
  div.innerHTML = `
    <div class="queue-num">${direction === 'next' ? num : '↩'}</div>
    <div class="queue-thumb">
      ${track.album_art
        ? `<img src="${track.album_art}" alt="">`
        : `<div style="width:100%;height:100%;background:#222;border-radius:4px;"></div>`
      }
    </div>
    <div class="queue-info">
      <div class="queue-song">${track.song}</div>
      <div class="queue-artist">${track.artist}</div>
    </div>
    <div class="queue-duration">${formatTime(track.duration_ms)}</div>
  `
  return div
}

// ── coming soon modal ──
function showModal() {
  document.getElementById('coming-soon-modal').style.display = 'flex'
}

function closeModal() {
  document.getElementById('coming-soon-modal').style.display = 'none'
}

document.querySelectorAll('.coming-soon').forEach(link => {
  link.addEventListener('click', showModal)
})

document.getElementById('coming-soon-modal').addEventListener('click', function(e) {
  if (e.target === this) closeModal()
})

// ── main fetch loop ──
async function fetchNowPlaying() {
  if (isFetching) return
  isFetching = true

  try {
    const response = await fetch('/now-playing')

    if (response.redirected && response.url.includes('/login')) {
      showWelcome()
      return
    }

    if (!response.ok) {
      console.warn('now-playing error:', response.status)
      return
    }

    if (!isLoggedIn) {
      isLoggedIn = true
      showBars()
      fetchContext()
    }

    const data = await response.json()

    // ── PAUSED ──
    if (!data.is_playing && data.song) {
      isPlaying = false
      lastKnownData = data
      updatePlayPauseIcon(false)
      updateTopBar(data)
      updateBottomBar(data)
      updateProgressBar(data.progress_ms, data.duration_ms)
      // keep whatever is in the content panel — don't change it
      return
    }

    // ── NOTHING PLAYING ──
    if (!data.playing && !data.song) {
      isPlaying = false
      updatePlayPauseIcon(false)
      if (lastKnownData) {
        updateTopBar(lastKnownData)
        updateBottomBar(lastKnownData)
      }
      // only show "nothing playing" if we're not already showing a track-specific state
      if (!currentContentState || currentContentState === 'lyrics') {
        showContent('message', {
          icon: '⏸️',
          title: 'Nothing playing',
          subtitle: 'Play something on Spotify to see lyrics'
        })
      }
      return
    }

    // ── PLAYING ──
    isPlaying = true
    lastKnownData = data
    progressMs = data.progress_ms
    durationMs = data.duration_ms
    lastServerSync = Date.now()

    updatePlayPauseIcon(true)
    updateProgressBar(progressMs, durationMs)
    updateTopBar(data)
    updateBottomBar(data)

    // same track — just sync the line
    if (data.track_id === currentTrackId) {
      if (currentLyrics.length > 0) {
        updateActiveLine(getCurrentLineIndex(currentLyrics, progressMs + SYNC_OFFSET))
      }
      return
    }

    // ── NEW TRACK ──
    currentTrackId = data.track_id
    currentLyrics = []
    currentLineIndex = -1
    currentContentState = 'loading'
    langBadge.style.display = 'none'

    showContent('message', {
      icon: '⏳',
      title: 'Loading lyrics...',
      subtitle: `Fetching translation for ${data.song}`
    })

    const translateRes = await fetch(
      `/translate?song=${encodeURIComponent(data.song)}&artist=${encodeURIComponent(data.artist)}&track_id=${encodeURIComponent(data.track_id)}&target_lang=EN`
    )
    const translateData = await translateRes.json()

    if (!translateData.translated) {
      currentContentState = 'no-lyrics'
      showContent('message', {
        icon: '🎵',
        title: "Couldn't find lyrics yet",
        subtitle: "We're working on it! Try another song."
      })
      return
    }

    currentLyrics = translateData.lyrics.filter(line =>
      line.original.toLowerCase().trim() !== line.translation.toLowerCase().trim()
    )

    if (currentLyrics.length === 0) {
      currentContentState = 'english'
      showContent('message', {
        icon: '💬',
        title: 'Already in English',
        subtitle: 'No translation needed for this track.'
      })
      return
    }

    const lang = translateData.lyrics[0]?.detected_language || ''
    if (lang) {
      langBadge.textContent = `${lang} → ENG`
      langBadge.style.display = 'block'
      if (currentTrackId) translation_cache_js[currentTrackId] = `${lang} → EN`
    }

    renderLyrics(currentLyrics)
    currentContentState = 'lyrics'
    showContent('lyrics')

    if (currentLyrics.length > 0) {
      updateActiveLine(getCurrentLineIndex(currentLyrics, progressMs + SYNC_OFFSET))
    }

  } catch (err) {
    console.error('Fetch error:', err)
  } finally {
    isFetching = false
  }
}

// ── local progress tick ──
function tickProgress() {
  if (!isPlaying || durationMs === 0) return

  const elapsed = Date.now() - lastServerSync
  const estimated = progressMs + elapsed
  const capped = Math.min(estimated, durationMs)

  progressBar.style.width = `${(capped / durationMs) * 100}%`
  timeCurrent.textContent = formatTime(capped)

  if (currentLyrics.length > 0) {
    updateActiveLine(getCurrentLineIndex(currentLyrics, capped + SYNC_OFFSET))
  }
}

// ── kick off ──
fetchNowPlaying()
setInterval(fetchNowPlaying, 5000)
setInterval(fetchContext, 10000)
setInterval(tickProgress, 1000)