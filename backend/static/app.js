// ── state ──
let currentTrackId = null
let currentLyrics = []
let currentLineIndex = -1
let progressMs = 0
let durationMs = 0
let isPlaying = false
let translationEnabled = true
let lastServerSync = Date.now()

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

// ── helpers ──
function formatTime(ms) {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

function showState(icon, title, subtitle, showLogin = false) {
  stateIcon.textContent = icon
  stateTitle.textContent = title
  stateSubtitle.textContent = subtitle
  document.getElementById('login-btn').style.display = showLogin ? 'inline-flex' : 'none'
  stateScreen.style.display = 'flex'
  lyricsContainer.style.display = 'none'
  topBar.style.display = 'none'
  bottomBar.style.display = 'none'
}

function getCurrentLineIndex(lyrics, ms) {
  let idx = 0
  for (let i = 0; i < lyrics.length; i++) {
    if (lyrics[i].time_ms <= ms) { idx = i } else { break }
  }
  return idx
}

// ── lyrics render ──
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

function updateProgressBar() {
  if (durationMs > 0) {
    progressBar.style.width = `${Math.min((progressMs / durationMs) * 100, 100)}%`
    timeCurrent.textContent = formatTime(progressMs)
    timeTotal.textContent = formatTime(durationMs)
  }
}

function updatePlayPauseIcon(playing) {
  document.getElementById('play-icon').style.display = playing ? 'none' : 'block'
  document.getElementById('pause-icon').style.display = playing ? 'block' : 'none'
}

function updateBottomBar(data) {
  document.getElementById('bottom-art').src = data.album_art || ''
  document.getElementById('bottom-song').textContent = data.song
  document.getElementById('bottom-artist').textContent = data.artist
  bottomBar.style.display = 'flex'
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
    await fetch('/playback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action })
    })
    // wait briefly then refresh state
    setTimeout(fetchNowPlaying, 300)
  } catch (e) {
    console.error('Playback error:', e)
  }
}

async function togglePlayPause() {
  const action = isPlaying ? 'pause' : 'play'
  isPlaying = !isPlaying
  updatePlayPauseIcon(isPlaying)
  await sendPlayback(action)
}

// ── queue ──
async function fetchQueue() {
  try {
    const res = await fetch('/queue')
    if (!res.ok) return
    const data = await res.json()
    renderQueue(data.queue || [])
  } catch (e) {
    console.error('Queue error:', e)
  }
}

function renderQueue(items) {
  const list = document.getElementById('queue-list')
  const dot = document.getElementById('queue-dot')

  if (!items.length) {
    list.innerHTML = '<div class="queue-empty">Nothing queued — add songs in Spotify</div>'
    dot.classList.remove('visible')
    return
  }

  dot.classList.add('visible')
  list.innerHTML = ''

  items.forEach((track, i) => {
    const div = document.createElement('div')
    div.className = 'queue-item'
    div.innerHTML = `
      <div class="queue-num">${i + 1}</div>
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
    list.appendChild(div)
  })
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
  try {
    const response = await fetch('/now-playing')

    if (response.redirected && response.url.includes('/login')) {
      showState('🎵', 'Welcome to LyricSync', 'Connect your Spotify to see real-time translated lyrics', true)
      return
    }

    if (!response.ok) {
      showState('⚠️', 'Something went wrong', 'Could not reach Spotify. Try refreshing.')
      return
    }

    const data = await response.json()
    isPlaying = data.playing

    if (!data.playing) {
      showState('⏸️', 'Nothing playing', 'Play something on Spotify to see lyrics')
      updatePlayPauseIcon(false)
      currentTrackId = null
      currentLyrics = []
      return
    }

    // sync timestamp for local tick
    progressMs = data.progress_ms
    durationMs = data.duration_ms
    lastServerSync = Date.now()

    updatePlayPauseIcon(data.is_playing)
    updateProgressBar()
    updateBottomBar(data)

    songName.textContent = data.song
    artistName.textContent = data.artist
    if (data.album_art) albumArt.src = data.album_art
    topBar.style.display = 'flex'

    // new track — fetch lyrics
    if (data.track_id !== currentTrackId) {
      currentTrackId = data.track_id
      currentLyrics = []
      currentLineIndex = -1
      langBadge.style.display = 'none'

      showState('⏳', 'Loading lyrics...', `Fetching translation for ${data.song}`)

      const translateRes = await fetch(
        `/translate?song=${encodeURIComponent(data.song)}&artist=${encodeURIComponent(data.artist)}&track_id=${encodeURIComponent(data.track_id)}&target_lang=EN`
      )
      const translateData = await translateRes.json()

      if (!translateData.translated) {
        showState('🎵', "Couldn't find lyrics yet", "We're working on it! Try another song.")
        return
      }

      currentLyrics = translateData.lyrics.filter(line =>
        line.original.toLowerCase().trim() !== line.translation.toLowerCase().trim()
      )

      if (currentLyrics.length === 0) {
        showState('💬', 'Already in English', 'No translation needed for this track.')
        return
      }

      const lang = translateData.lyrics[0]?.detected_language || ''
      if (lang) {
        langBadge.textContent = `${lang} → ENG`
        langBadge.style.display = 'block'
      }

      renderLyrics(currentLyrics)
      stateScreen.style.display = 'none'
      lyricsContainer.style.display = 'flex'
    }

    if (currentLyrics.length > 0) {
      updateActiveLine(getCurrentLineIndex(currentLyrics, progressMs + SYNC_OFFSET))
    }

  } catch (err) {
    console.error('Fetch error:', err)
    showState('⚠️', 'Connection error', 'Is Flask running?')
  }
}

// ── local progress tick (every 1s, no API call) ──
function tickProgress() {
  if (!isPlaying || durationMs === 0) return
  // use elapsed time since last server sync for accuracy
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
fetchQueue()
setInterval(fetchNowPlaying, 5000)
setInterval(fetchQueue, 10000)
setInterval(tickProgress, 1000)