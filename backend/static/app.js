// ── state ──
let currentTrackId = null
let currentLyrics = []
let currentLineIndex = -1
let progressMs = 0
let durationMs = 0
let isPlaying = false

// sync offset (negative = show lyrics earlier)
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
  document.getElementById('login-btn').style.display = showLogin ? 'inline-block' : 'none'
  stateScreen.style.display = 'flex'
  lyricsContainer.style.display = 'none'
  topBar.style.display = 'none'
  bottomBar.style.display = 'none'
}

function getCurrentLineIndex(lyrics, progressMs) {
  let currentIndex = 0
  for (let i = 0; i < lyrics.length; i++) {
    if (lyrics[i].time_ms <= progressMs) {
      currentIndex = i
    } else {
      break
    }
  }
  return currentIndex
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
}

function updateActiveLine(index) {
  if (index === currentLineIndex) return
  currentLineIndex = index

  const lines = document.querySelectorAll('.lyric-line')
  lines.forEach((line, i) => {
    line.classList.remove('active', 'near')
    if (i === index) {
      line.classList.add('active')
    } else if (i === index - 1 || i === index + 1) {
      line.classList.add('near')
    }
  })

  const activeLine = lines[index]
  if (activeLine) {
    activeLine.scrollIntoView({
      behavior: 'smooth',
      block: 'center'
    })
  }
}

function updateProgressBar() {
  if (durationMs > 0) {
    const pct = (progressMs / durationMs) * 100
    progressBar.style.width = `${Math.min(pct, 100)}%`
    timeCurrent.textContent = formatTime(progressMs)
    timeTotal.textContent = formatTime(durationMs)
  }
}

// ── main fetch loop ──
async function fetchNowPlaying() {
  try {
    const response = await fetch('/now-playing')

    if (response.redirected && response.url.includes('/login')) {
      showState('🎵', 'Welcome to LyricSync', 'Connect your Spotify to see real-time translated lyrics', true)
      return
    }

    if (!response.ok) {
      showState('⚠️', 'Something went wrong', 'Could not reach Spotify. Try refreshing.', false)
      return
    }

    const data = await response.json()

    isPlaying = data.playing

    if (!data.playing) {
      showState('⏸️', 'Nothing playing', 'Play something on Spotify to see lyrics', false)
      currentTrackId = null
      currentLyrics = []
      return
    }

    songName.textContent = data.song
    artistName.textContent = data.artist
    if (data.album_art) {
      albumArt.src = data.album_art
      albumArt.style.display = 'block'
    }
    topBar.style.display = 'flex'
    bottomBar.style.display = 'flex'

    progressMs = data.progress_ms
    durationMs = data.duration_ms
    updateProgressBar()

    if (data.track_id !== currentTrackId) {
      currentTrackId = data.track_id
      currentLyrics = []
      currentLineIndex = -1

      showState('⏳', 'Loading lyrics...', `Fetching translation for ${data.song}`, false)

      const translateResponse = await fetch(
        `/translate?song=${encodeURIComponent(data.song)}&artist=${encodeURIComponent(data.artist)}&track_id=${encodeURIComponent(data.track_id)}&target_lang=EN`
      )
      const translateData = await translateResponse.json()

      if (!translateData.translated) {
        showState('🎵', "We couldn't find lyrics for this song yet", 'Check back soon — we\'re working on it!', false)
        return
      }

      currentLyrics = translateData.lyrics.filter(line =>
        line.original.toLowerCase().trim() !== line.translation.toLowerCase().trim()
      )

      if (currentLyrics.length === 0) {
        showState('💬', 'Lyrics in English', 'No translation needed — lyrics are already in English', false)
        return
      }

      const detectedLang = translateData.lyrics[0]?.detected_language || ''
      if (detectedLang) {
        langBadge.textContent = `${detectedLang} → EN`
        langBadge.style.display = 'block'
      }

      renderLyrics(currentLyrics)
      stateScreen.style.display = 'none'
      lyricsContainer.style.display = 'flex'
    }

    if (currentLyrics.length > 0) {
      const newIndex = getCurrentLineIndex(currentLyrics, progressMs + SYNC_OFFSET)
      updateActiveLine(newIndex)
    }

  } catch (error) {
    console.error('Fetch error:', error)
    showState('⚠️', 'Connection error', 'Could not reach the server. Is Flask running?', false)
  }
}

// ── progress tick ──
function tickProgress() {
  if (isPlaying && progressMs < durationMs) {
    progressMs += 1000
    updateProgressBar()

    if (currentLyrics.length > 0) {
      const newIndex = getCurrentLineIndex(currentLyrics, progressMs + SYNC_OFFSET)
      updateActiveLine(newIndex)
    }
  }
}

fetchNowPlaying()
setInterval(fetchNowPlaying, 1000)