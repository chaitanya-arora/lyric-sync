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

// ── pause > 60s → welcome screen ──
let pausedAt = null
let pauseTimerFired = false

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
const welcomeScreen = document.getElementById('welcome-screen')
const welcomeLoginBtn = document.getElementById('welcome-login-btn')

// ─────────────────────────────────────────
//  WELCOME SCREEN CANVAS ANIMATION
// ─────────────────────────────────────────

const canvas = document.getElementById('welcome-canvas')
const ctx = canvas.getContext('2d')

// Floating elements — flag emojis + music notes, each with a colour hue
// Flags chosen for breadth of world music genres LyricSync supports
const LANG_ITEMS = [
  { text: '🇫🇷', hue: 355 },  // France   — coral red
  { text: '🇮🇳', hue: 42  },  // India    — amber
  { text: '🇰🇷', hue: 22  },  // Korea    — orange
  { text: '🇪🇸', hue: 82  },  // Spain    — lime
  { text: '🇧🇷', hue: 168 },  // Brazil   — teal
  { text: '🇯🇵', hue: 235 },  // Japan    — periwinkle
  { text: '🇲🇽', hue: 315 },  // Mexico   — magenta
  { text: '🇮🇹', hue: 335 },  // Italy    — hot pink
  { text: '🇩🇪', hue: 200 },  // Germany  — steel blue
  { text: '🇨🇳', hue: 272 },  // China    — purple
  { text: '🇵🇹', hue: 100 },  // Portugal — yellow-green
  { text: '🇸🇦', hue: 130 },  // Arabia   — green
  { text: '♪',   hue: 142 },  // Note     — Spotify green
  { text: '♫',   hue: 142 },  // Note     — Spotify green
  { text: '♩',   hue: 60  },  // Note     — warm yellow
  { text: '♬',   hue: 142 },  // Note     — Spotify green
]

// Aura orbs — brighter, more vivid than before
const ORBS = [
  { x: 0.15, y: 0.25, r: 0.40, hue: 355, speed: 0.00008 }, // coral red
  { x: 0.82, y: 0.58, r: 0.35, hue: 272, speed: 0.00006 }, // purple
  { x: 0.50, y: 0.88, r: 0.33, hue: 168, speed: 0.00010 }, // teal
  { x: 0.74, y: 0.18, r: 0.28, hue: 42,  speed: 0.00007 }, // amber
  { x: 0.28, y: 0.72, r: 0.25, hue: 315, speed: 0.00009 }, // magenta
  { x: 0.60, y: 0.40, r: 0.20, hue: 142, speed: 0.00011 }, // green
]

let floats = []
let orbPhase = 0
let animFrame = null
let isAnimating = false

function resizeCanvas() {
  canvas.width = canvas.offsetWidth
  canvas.height = canvas.offsetHeight
}

function initFloats() {
  // Remove any existing DOM floats
  document.querySelectorAll('.welcome-float').forEach(el => el.remove())

  const count = 28
  const container = welcomeScreen

  for (let i = 0; i < count; i++) {
    const item = LANG_ITEMS[i % LANG_ITEMS.length]
    const el = document.createElement('div')
    el.className = 'welcome-float'

    const startX = Math.random() * 100   // vw %
    const startY = 100 + Math.random() * 40  // start below viewport
    const size = 18 + Math.random() * 16
    const opacity = 0.25 + Math.random() * 0.30
    const duration = 8 + Math.random() * 10  // seconds to float up
    const delay = -(Math.random() * duration) // stagger start

    el.textContent = item.text
    el.style.cssText = `
      position: absolute;
      left: ${startX}%;
      top: ${startY}%;
      font-size: ${size}px;
      opacity: ${opacity};
      color: hsla(${item.hue}, 80%, 70%, 1);
      pointer-events: none;
      z-index: 1;
      animation: floatUp ${duration}s ${delay}s linear infinite;
      filter: drop-shadow(0 0 6px hsla(${item.hue}, 80%, 60%, 0.4));
    `
    container.appendChild(el)
  }
}

function drawOrbs(t) {
  ORBS.forEach((orb, i) => {
    // slow Lissajous drift
    const dx = Math.sin(t * orb.speed + i * 1.3) * 0.12
    const dy = Math.cos(t * orb.speed * 0.7 + i * 2.1) * 0.09
    const cx = (orb.x + dx) * canvas.width
    const cy = (orb.y + dy) * canvas.height
    const radius = orb.r * Math.min(canvas.width, canvas.height)

    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius)
    grad.addColorStop(0,   `hsla(${orb.hue}, 90%, 65%, 0.32)`)
    grad.addColorStop(0.5, `hsla(${orb.hue}, 80%, 55%, 0.14)`)
    grad.addColorStop(1,   `hsla(${orb.hue}, 70%, 40%, 0)`)

    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.arc(cx, cy, radius, 0, Math.PI * 2)
    ctx.fill()
  })
}

function drawFloats(t) {
  // Floats are now DOM elements animated via CSS — nothing to draw on canvas
}

function animateWelcome(t) {
  if (!isAnimating) return
  animFrame = requestAnimationFrame(animateWelcome)
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  drawOrbs(t)
  // floats are DOM-based, no canvas draw needed
}

function startWelcomeAnimation() {
  if (isAnimating) return
  resizeCanvas()
  initFloats()
  isAnimating = true
  requestAnimationFrame(animateWelcome)
}

function stopWelcomeAnimation() {
  isAnimating = false
  if (animFrame) {
    cancelAnimationFrame(animFrame)
    animFrame = null
  }
  document.querySelectorAll('.welcome-float').forEach(el => el.remove())
}

window.addEventListener('resize', () => {
  if (isAnimating) {
    resizeCanvas()
    initFloats()
  }
})

// ─────────────────────────────────────────
//  WELCOME SCREEN SHOW / HIDE
// ─────────────────────────────────────────

function showWelcomeScreen() {
  topBar.style.display = 'none'
  bottomBar.style.display = 'none'
  stateScreen.style.display = 'none'
  lyricsContainer.style.display = 'none'

  welcomeScreen.classList.remove('fade-out', 'hidden')
  welcomeScreen.style.display = 'flex'
  welcomeScreen.style.opacity = '1'

  if (isLoggedIn) {
    welcomeLoginBtn.classList.add('hidden')
    document.getElementById('welcome-tagline').textContent = "You're connected!"
    document.getElementById('welcome-desc').textContent =
      'Play a song in Spotify to see real-time translated lyrics.'
  } else {
    welcomeLoginBtn.classList.remove('hidden')
    document.getElementById('welcome-tagline').textContent = 'Music, understood.'
    document.getElementById('welcome-desc').textContent =
      'Connect Spotify and LyricSync shows you real-time translated lyrics — line by line, in sync, as you listen. No pausing. No Googling. Just music and meaning, together.'
  }

  startWelcomeAnimation()
}

function hideWelcomeScreen(callback) {
  welcomeScreen.classList.add('fade-out')
  setTimeout(() => {
    welcomeScreen.classList.add('hidden')
    welcomeScreen.style.display = 'none'
    stopWelcomeAnimation()
    if (callback) callback()
  }, 300)
}

// ─────────────────────────────────────────
//  CONTENT PANEL HELPERS
// ─────────────────────────────────────────

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
  }
}

// post-login: refresh welcome screen card now that isLoggedIn is true
function showBars() {
  showWelcomeScreen()
}

// ─────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────

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

// ─────────────────────────────────────────
//  TRANSLATION TOGGLE
// ─────────────────────────────────────────

function toggleTranslation() {
  translationEnabled = !translationEnabled
  const toggle = document.getElementById('toggle-switch')
  toggle.classList.toggle('on', translationEnabled)
  document.querySelectorAll('.lyric-translation').forEach(el => {
    el.style.display = translationEnabled ? '' : 'none'
  })
}

// ─────────────────────────────────────────
//  PLAYBACK CONTROLS
// ─────────────────────────────────────────

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

// ─────────────────────────────────────────
//  CONTEXT (QUEUE)
// ─────────────────────────────────────────

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

// ─────────────────────────────────────────
//  COMING SOON MODAL
// ─────────────────────────────────────────

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

// ─────────────────────────────────────────
//  MAIN FETCH LOOP
// ─────────────────────────────────────────

async function fetchNowPlaying() {
  if (isFetching) return
  isFetching = true

  try {
    const response = await fetch('/now-playing')

    if (response.redirected && response.url.includes('/login')) {
      showWelcomeScreen()
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

    // ── PAUSED or NOTHING PLAYING ──
    // Freeze everything exactly as-is. After 60s, show the welcome screen.
    if ((!data.is_playing && data.song) || (!data.playing && !data.song)) {
      isPlaying = false
      updatePlayPauseIcon(false)

      // freeze bars at current track
      if (data.song) {
        lastKnownData = data
        updateTopBar(data)
        updateBottomBar(data)
        updateProgressBar(data.progress_ms, data.duration_ms)
      } else if (lastKnownData) {
        updateTopBar(lastKnownData)
        updateBottomBar(lastKnownData)
      }

      // start 60s timer on first paused tick
      if (!pausedAt) {
        pausedAt = Date.now()
        pauseTimerFired = false
      }

      if (!pauseTimerFired && Date.now() - pausedAt > 60000) {
        pauseTimerFired = true
        showWelcomeScreen()
      }

      // content panel stays frozen — don't touch it
      return
    }

    // ── PLAYING ──
    isPlaying = true
    lastKnownData = data
    progressMs = data.progress_ms
    durationMs = data.duration_ms
    lastServerSync = Date.now()

    // reset pause timer
    pausedAt = null
    pauseTimerFired = false

    updatePlayPauseIcon(true)
    updateProgressBar(progressMs, durationMs)
    updateTopBar(data)
    updateBottomBar(data)

    // if welcome was showing (paused > 12s), fade it out and restore everything
    if (!welcomeScreen.classList.contains('hidden') && welcomeScreen.style.display !== 'none') {
      hideWelcomeScreen(() => {
        topBar.style.display = 'flex'
        bottomBar.style.display = 'flex'
        // restore whichever content panel was showing before pause
        if (currentContentState === 'lyrics') {
          lyricsContainer.style.display = 'flex'
          stateScreen.style.display = 'none'
          // re-sync to current position
          if (currentLyrics.length > 0) {
            updateActiveLine(getCurrentLineIndex(currentLyrics, progressMs + SYNC_OFFSET))
          }
        } else if (currentContentState) {
          // loading / no-lyrics / english — stateScreen was showing
          stateScreen.style.display = 'flex'
          lyricsContainer.style.display = 'none'
        }
      })
    }

    // same track — just sync line
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

// ─────────────────────────────────────────
//  LOCAL PROGRESS TICK
// ─────────────────────────────────────────

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

// ─────────────────────────────────────────
//  KICK OFF
// ─────────────────────────────────────────

// Show welcome (login mode) immediately — fetchNowPlaying will replace it
showWelcomeScreen()

fetchNowPlaying()
setInterval(fetchNowPlaying, 5000)
setInterval(fetchContext, 10000)
setInterval(tickProgress, 1000)