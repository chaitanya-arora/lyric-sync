// ── state ──
let currentTrackId = null
let currentTrackData = null   // display data for currentTrackId, kept in step with it
let localRecent = []          // tracks we saw finish, newest first
let currentLyrics = []
let currentLyricsSynced = false   // false for plain lyrics with no timestamps
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

// ── prefetch: next-track lyrics ──
let prefetchedTrackId = null     // track_id we already prefetched
let isPrefetching = false        // guard against duplicate prefetch calls

const SYNC_OFFSET_BASE = 200    // ms of lead — lines light up just before they're sung
const TICK_MS = 100             // how often the active line is re-evaluated
const SEEK_SETTLE_MS = 1000     // how long to trust our own position after a seek
let isScrubbing = false         // true while the progress bar is being dragged
let seekSettleUntil = 0         // ignore server progress until this timestamp
let dynamicOffset = 0           // auto-corrected drift measured each poll cycle
let lastPollProgressMs = 0      // server progress_ms from last poll
let lastPollTime = 0            // Date.now() when last poll completed

// ── element refs ──
const topBar = document.getElementById('top-bar')
const albumArt = document.getElementById('album-art')
const songName = document.getElementById('song-name')
const artistName = document.getElementById('artist-name')
const langBadge = document.getElementById('lang-badge')
const stateScreen = document.getElementById('state-screen')
const stateTitle = document.getElementById('state-title')
const stateSubtitle = document.getElementById('state-subtitle')
const lyricsContainer = document.getElementById('lyrics-container')
const lyricsInner = document.getElementById('lyrics-inner')
const bottomBar = document.getElementById('bottom-bar')
const progressBar = document.getElementById('progress-bar')
const progressHit = document.getElementById('progress-hit')
const progressContainer = document.getElementById('progress-bar-container')
const progressKnob = document.getElementById('progress-knob')
const timeCurrent = document.getElementById('time-current')
const timeTotal = document.getElementById('time-total')
const welcomeScreen = document.getElementById('welcome-screen')
const toast = document.getElementById('toast')
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
  { x: 0.15, y: 0.25, r: 0.50, hue: 355, speed: 0.00012 }, // coral red — bigger + faster
  { x: 0.82, y: 0.58, r: 0.45, hue: 272, speed: 0.00010 }, // purple
  { x: 0.50, y: 0.88, r: 0.42, hue: 168, speed: 0.00014 }, // teal
  { x: 0.74, y: 0.18, r: 0.38, hue: 42,  speed: 0.00011 }, // amber
  { x: 0.28, y: 0.72, r: 0.35, hue: 315, speed: 0.00013 }, // magenta
  { x: 0.60, y: 0.40, r: 0.28, hue: 142, speed: 0.00015 }, // green
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
    const opacity = 0.12 + Math.random() * 0.2
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
    grad.addColorStop(0,   `hsla(${orb.hue}, 70%, 60%, 0.16)`)
    grad.addColorStop(0.5, `hsla(${orb.hue}, 60%, 50%, 0.07)`)
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
  // always stop first so restart after disconnect works cleanly
  stopWelcomeAnimation()
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

function setWelcomeText(title, tagline, desc) {
  document.getElementById('welcome-title').textContent = title
  document.getElementById('welcome-tagline').textContent = tagline
  document.getElementById('welcome-desc').textContent = desc
}

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
    setWelcomeText("You're connected!", 'Play a song in Spotify to get started',
      'Your translated lyrics will appear here, line by line, as you listen.')
    // orbs run on connected screen too — just no floating flags/notes
    stopWelcomeAnimation()
    resizeCanvas()
    isAnimating = true
    requestAnimationFrame(animateWelcome)
  } else {
    welcomeLoginBtn.classList.remove('hidden')
    setWelcomeText('Welcome to LyricSync', 'Music, understood.',
      'Connect Spotify and LyricSync shows you real-time translated lyrics — line by line, in sync, as you listen. No pausing. No Googling. Just music and meaning, together.')
    startWelcomeAnimation()  // flags + notes + orbs
  }
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

// Loading, "no lyrics" and "already in English" share one card. `notes` puts
// the Figma's scattered music notes behind it; `action` adds a button below.
function showContent(type, options = {}) {
  if (type === 'lyrics') {
    stateScreen.style.display = 'none'
    lyricsContainer.style.display = 'block'
    return
  }
  lyricsContainer.style.display = 'none'
  stateScreen.style.display = 'flex'
  stateScreen.classList.toggle('notes', Boolean(options.notes))
  stateTitle.textContent = options.title || ''
  stateSubtitle.textContent = options.subtitle || ''

  const button = document.getElementById('state-action')
  button.hidden = !options.action
  if (options.action) {
    button.textContent = options.action.label
    button.disabled = false
    button.onclick = options.action.onClick
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

// LRCLIB only has plain lyrics for some songs. Their time_ms is null, which
// compares as 0, so every line would count as already sung and the highlight
// would sit on the last one. Those songs get a static, fully readable view.
function hasTimings(lyrics) {
  return lyrics.length > 0 && lyrics.every(line => line.time_ms != null)
}

function syncActiveLine(ms) {
  if (!currentLyricsSynced || currentLyrics.length === 0) return
  updateActiveLine(getCurrentLineIndex(currentLyrics, ms + SYNC_OFFSET_BASE + dynamicOffset))
}

// The Figma writes languages as three letters: "FRE → ENG".
const LANG_LABELS = {
  AR: 'ARA', BN: 'BEN', DE: 'GER', EL: 'GRE', EN: 'ENG', ES: 'ESP', FA: 'PER',
  FR: 'FRE', HE: 'HEB', HI: 'HIN', ID: 'IND', IT: 'ITA', JA: 'JPN', KO: 'KOR',
  NL: 'DUT', PA: 'PUN', PL: 'POL', PT: 'POR', RU: 'RUS', SV: 'SWE', TA: 'TAM',
  TE: 'TEL', TH: 'THA', TR: 'TUR', UK: 'UKR', UR: 'URD', VI: 'VIE', ZH: 'CHI'
}

function langLabel(code) {
  const base = (code || '').split('-')[0]
  return LANG_LABELS[base] || base
}

// Every language has its own colour: a hue for the pills, chips and cards
// that mark it. Languages not listed get a stable hue from their code.
const LANG_HUES = {
  FR: 12, ES: 42, HI: 68, PA: 140, KO: 292, JA: 345, ZH: 28, PT: 172,
  IT: 112, AR: 228, DE: 262, RU: 250, TR: 198, ID: 186, UR: 158, BN: 96,
  TA: 54, TE: 82, NL: 32, PL: 318, SV: 214, VI: 128, TH: 276, EN: 206
}

function langHue(code) {
  const base = (code || '').split('-')[0]
  if (base in LANG_HUES) return LANG_HUES[base]
  let hash = 0
  for (const ch of base) hash = (hash * 31 + ch.charCodeAt(0)) % 360
  return hash
}

function paintLangPill(el, code) {
  el.style.setProperty('--lang-h', langHue(code))
}

function normaliseLyric(text) {
  return text.toLowerCase().replace(/\s+/g, ' ').trim()
}

// A line DeepL left alone was already in English — there's nothing to show
// underneath it, but the line itself still belongs in the song.
function needsTranslation(line) {
  if (line.detected_language === 'EN') return false
  return normaliseLyric(line.original) !== normaliseLyric(line.translation)
}

// The badge names the language the song is mostly in. Reading line 0 alone
// got it wrong whenever a song opened with an English line.
function dominantLanguage(lyrics) {
  const counts = {}
  lyrics.forEach(line => {
    if (line.needsTranslation && line.detected_language) {
      counts[line.detected_language] = (counts[line.detected_language] || 0) + 1
    }
  })
  let best = ''
  for (const lang in counts) {
    if (!best || counts[lang] > counts[best]) best = lang
  }
  return best
}

function renderLyrics(lyrics) {
  lyricsInner.innerHTML = ''
  lyricsInner.classList.toggle('unsynced', !currentLyricsSynced)
  lyrics.forEach((line, index) => {
    const div = document.createElement('div')
    div.className = 'lyric-line'
    div.dataset.index = index

    const original = document.createElement('div')
    original.className = 'lyric-original'
    original.textContent = line.original

    const translation = document.createElement('div')
    translation.className = 'lyric-translation'
    if (!line.needsTranslation) translation.classList.add('untranslated')
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
  if (activeLine) centreLine(activeLine)
}

// scrollIntoView would also scroll #main — overflow:hidden, but still
// scrollable from script — and shove the whole card up. Scroll the lyrics
// well alone.
function centreLine(line) {
  const top = line.offsetTop - (lyricsContainer.clientHeight - line.offsetHeight) / 2
  lyricsContainer.scrollTo({ top: Math.max(top, 0), behavior: 'smooth' })
}

// A line can't be scrolled to while the lyrics are hidden (behind the welcome
// screen, or on another page). Forget which line is showing so the next sync
// scrolls to it, now that it can.
function recentreLyrics() {
  currentLineIndex = -1
  syncActiveLine(isPlaying ? progressMs + (Date.now() - lastServerSync) : progressMs)
}

function paintProgress(ms, dur = durationMs) {
  const pct = dur > 0 ? Math.min((ms / dur) * 100, 100) : 0
  progressBar.style.width = `${pct}%`
  progressKnob.style.left = `${pct}%`
}

function updateProgressBar(ms, dur) {
  if (dur <= 0) return
  timeTotal.textContent = formatTime(dur)
  if (isScrubbing) return   // the drag owns the bar until it's released
  paintProgress(ms, dur)
  timeCurrent.textContent = formatTime(ms)
}

function updatePlayPauseIcon(playing) {
  document.getElementById('play-icon').style.display = playing ? 'none' : 'block'
  document.getElementById('pause-icon').style.display = playing ? 'block' : 'none'
}

function updateTopBar(data) {
  songName.textContent = data.song
  artistName.textContent = data.artist
  if (data.album_art && albumArt.getAttribute('src') !== data.album_art) {
    albumArt.src = data.album_art
    tintFromArtwork(data.album_art)
  }
}

// The room takes on the colour of the album that's playing. Spotify's image
// CDN allows cross-origin reads, so the artwork can be sampled on a canvas.
function tintFromArtwork(url) {
  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.onload = () => {
    try {
      const size = 24
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = size
      const ctx2d = canvas.getContext('2d', { willReadFrequently: true })
      ctx2d.drawImage(img, 0, 0, size, size)
      const pixels = ctx2d.getImageData(0, 0, size, size).data

      // weight each pixel by how colourful it is, so a grey sleeve with one
      // red stripe reads as red rather than as mud
      let r = 0, g = 0, b = 0, total = 0
      for (let i = 0; i < pixels.length; i += 4) {
        const max = Math.max(pixels[i], pixels[i + 1], pixels[i + 2])
        const min = Math.min(pixels[i], pixels[i + 1], pixels[i + 2])
        const weight = (max - min) / 255 + 0.05
        r += pixels[i] * weight
        g += pixels[i + 1] * weight
        b += pixels[i + 2] * weight
        total += weight
      }
      const [h, s] = rgbToHsl(r / total, g / total, b / total)
      // keep it luminous enough to glow on near-black, never neon
      const [cr, cg, cb] = hslToRgb(h, Math.min(Math.max(s, 0.35), 0.7), 0.62)
      document.documentElement.style.setProperty('--ambient', `${cr} ${cg} ${cb}`)
    } catch (e) {
      // a tainted canvas or odd image just keeps the previous colour
    }
  }
  img.src = url
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0)
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  return [h / 6, s, l]
}

function hslToRgb(h, s, l) {
  const hue = t => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  return [hue(h + 1 / 3), hue(h), hue(h - 1 / 3)].map(v => Math.round(v * 255))
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

function applyTranslationEnabled(enabled) {
  translationEnabled = enabled
  const toggle = document.getElementById('toggle-switch')
  toggle.classList.toggle('on', translationEnabled)
  toggle.setAttribute('aria-checked', String(translationEnabled))
  document.querySelectorAll('.lyric-translation').forEach(el => {
    el.style.display = translationEnabled ? '' : 'none'
  })
}

function toggleTranslation() {
  applyTranslationEnabled(!translationEnabled)
  // remembered for next time, on any device — the switch works either way
  fetch('/prefs', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ auto_translate: translationEnabled })
  }).catch(e => console.warn('Saving the translation setting failed:', e))
}

async function loadPrefs() {
  try {
    const res = await fetch('/prefs')
    if (!res.ok) return
    const prefs = await res.json()
    applyTranslationEnabled(prefs.auto_translate !== false)
  } catch (e) {
    console.warn('Loading settings failed:', e)
  }
}

// ─────────────────────────────────────────
//  PLAYBACK CONTROLS
// ─────────────────────────────────────────

let toastTimer = null

function showToast(message, ms = 5000) {
  toast.textContent = message
  toast.classList.add('visible')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => toast.classList.remove('visible'), ms)
}

async function postPlayback(body) {
  const res = await fetch('/playback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (res.ok) return { ok: true }
  let payload = {}
  try { payload = await res.json() } catch (e) { /* no JSON body to read */ }
  return { ok: false, reason: payload.reason, error: payload.error }
}

// The Web API drives whichever Spotify device is active — it can't play audio
// itself. With Spotify closed everywhere there's nothing to drive, and the
// controls would otherwise just do nothing at all.
const PLAYBACK_PROBLEMS = {
  no_active_device: "Open Spotify on any device to start playback — LyricSync controls your player, it doesn't play the audio itself.",
  premium_required: 'Spotify Premium is required to control playback from here.'
}

const UNREACHABLE = "Couldn't reach Spotify — try again in a moment."

function reportPlaybackProblem(result) {
  // own keys only — a reason like "constructor" would otherwise resolve to
  // something off Object.prototype and get rendered into the toast
  const known = Object.hasOwn(PLAYBACK_PROBLEMS, result.reason ?? '')
    ? PLAYBACK_PROBLEMS[result.reason]
    : null
  showToast(known || result.error || UNREACHABLE)
}

async function sendPlayback(action) {
  try {
    const result = await postPlayback({ action })
    if (result.ok) {
      setTimeout(fetchNowPlaying, 400)
      return
    }
    reportPlaybackProblem(result)
  } catch (e) {
    console.error('Playback error:', e)
    showToast(UNREACHABLE)
  }
}

async function togglePlayPause() {
  const action = isPlaying ? 'pause' : 'play'
  await sendPlayback(action)
}

// ─────────────────────────────────────────
//  SHUFFLE, REPEAT, VOLUME, DEVICES
// ─────────────────────────────────────────

let shuffleOn = false
let repeatState = 'off'        // 'off' | 'context' | 'track'
let playerDevice = null        // { id, name, volume_percent, supports_volume }
let volumeHeldUntil = 0        // ignore polled volume while the slider settles
let playerHeldUntil = 0        // same for shuffle and repeat after a click

const REPEAT_NEXT = { off: 'context', context: 'track', track: 'off' }
const REPEAT_TITLES = { off: 'Repeat', context: 'Repeat: on', track: 'Repeat: this song' }

function paintPlayerState() {
  document.getElementById('btn-shuffle').setAttribute('aria-pressed', String(shuffleOn))
  const repeatBtn = document.getElementById('btn-repeat')
  repeatBtn.setAttribute('aria-pressed', String(repeatState !== 'off'))
  repeatBtn.title = REPEAT_TITLES[repeatState] || 'Repeat'
  document.getElementById('repeat-one').hidden = repeatState !== 'track'

  const volumeBtn = document.getElementById('btn-volume')
  const canSetVolume = Boolean(playerDevice && playerDevice.supports_volume !== false)
  volumeBtn.disabled = !canSetVolume
  volumeBtn.title = canSetVolume ? 'Volume' : "This device's volume can't be changed from here"
}

// The poll is the source of truth, except just after the user changed
// something — Spotify takes a moment to report it back.
function updatePlayerState(data) {
  if (Date.now() >= playerHeldUntil) {
    if (typeof data.shuffle === 'boolean') shuffleOn = data.shuffle
    if (data.repeat) repeatState = data.repeat
  }
  if (data.device) {
    playerDevice = data.device
    const volume = data.device.volume_percent
    if (typeof volume === 'number' && Date.now() >= volumeHeldUntil) {
      document.getElementById('volume-slider').value = volume
    }
  }
  paintPlayerState()
}

async function changePlayerSetting(body, undo) {
  playerHeldUntil = Date.now() + 3000
  paintPlayerState()
  try {
    const result = await postPlayback(body)
    if (!result.ok) {
      undo()
      paintPlayerState()
      reportPlaybackProblem(result)
    }
  } catch (e) {
    undo()
    paintPlayerState()
    showToast(UNREACHABLE)
  }
}

function toggleShuffle() {
  const was = shuffleOn
  shuffleOn = !was
  changePlayerSetting({ action: 'shuffle', state: shuffleOn }, () => { shuffleOn = was })
}

function cycleRepeat() {
  const was = repeatState
  repeatState = REPEAT_NEXT[was] || 'off'
  changePlayerSetting({ action: 'repeat', state: repeatState }, () => { repeatState = was })
}

// ── popovers (devices, volume) ──
function closePopovers(except) {
  for (const [buttonId, popoverId] of [['btn-devices', 'device-menu'], ['btn-volume', 'volume-popover']]) {
    if (popoverId === except) continue
    document.getElementById(popoverId).hidden = true
    document.getElementById(buttonId).setAttribute('aria-expanded', 'false')
  }
}

function togglePopover(buttonId, popoverId) {
  const popover = document.getElementById(popoverId)
  const open = popover.hidden
  closePopovers(popoverId)
  popover.hidden = !open
  document.getElementById(buttonId).setAttribute('aria-expanded', String(open))
  return open
}

document.addEventListener('click', e => {
  if (!e.target.closest('.popover-anchor')) closePopovers()
})

document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return
  closePopovers()
  toggleQueue(false)
})

function toggleVolume() {
  togglePopover('btn-volume', 'volume-popover')
}

// Send the volume once the slider rests, not on every pixel of the drag.
let volumeTimer = null
document.getElementById('volume-slider').addEventListener('input', e => {
  const volume = Number(e.target.value)
  volumeHeldUntil = Date.now() + 4000
  clearTimeout(volumeTimer)
  volumeTimer = setTimeout(async () => {
    const result = await postPlayback({ action: 'volume', volume_percent: volume }).catch(() => null)
    if (result && !result.ok) reportPlaybackProblem(result)
  }, 250)
})

const DEVICE_ICON = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zm-5 18a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm0-12a2 2 0 1 1 0-4 2 2 0 0 1 0 4z"/></svg>'

function deviceMessage(menu, text) {
  menu.innerHTML = ''
  const message = document.createElement('div')
  message.className = 'device-empty'
  message.textContent = text
  menu.appendChild(message)
}

async function toggleDevices() {
  if (!togglePopover('btn-devices', 'device-menu')) return
  const menu = document.getElementById('device-menu')
  deviceMessage(menu, 'Looking for devices…')
  try {
    const res = await fetch('/devices')
    const devices = res.ok ? (await res.json()).devices : []
    if (!devices.length) {
      deviceMessage(menu, 'No devices found. Open Spotify on your phone, computer or speaker and it will show up here.')
      return
    }
    menu.innerHTML = '<div class="device-heading">Connect to a device</div>'
    devices.forEach(device => {
      const option = document.createElement('button')
      option.type = 'button'
      option.className = 'device-option'
      option.innerHTML = DEVICE_ICON
      // device names are user-chosen — textContent, never innerHTML
      option.append(document.createTextNode(device.name || 'Unnamed device'))
      if (device.is_active) option.classList.add('active')
      if (device.is_restricted) {
        option.disabled = true
        option.title = "Spotify doesn't allow controlling this device from other apps"
      }
      option.addEventListener('click', () => transferTo(device))
      menu.appendChild(option)
    })
  } catch (e) {
    deviceMessage(menu, UNREACHABLE)
  }
}

async function transferTo(device) {
  closePopovers()
  if (device.is_active) return
  try {
    const result = await postPlayback({ action: 'transfer', device_id: device.id, play: isPlaying })
    if (!result.ok) {
      reportPlaybackProblem(result)
      return
    }
    showToast(`Playing on ${device.name}`, 3000)
    setTimeout(fetchNowPlaying, 800)
  } catch (e) {
    showToast(UNREACHABLE)
  }
}

function toggleFullscreen() {
  if (document.fullscreenElement) {
    document.exitFullscreen()
  } else {
    document.documentElement.requestFullscreen().catch(() => {})
  }
}

// ─────────────────────────────────────────
//  YOUR LIBRARY
// ─────────────────────────────────────────

let libraryItems = []
let libraryFilter = null      // 'playlist' | 'album' | 'show' | null for all
const libraryList = document.getElementById('library-list')

function libraryMessage(text, action) {
  libraryList.innerHTML = ''
  const message = document.createElement('div')
  message.className = 'library-message'
  message.textContent = text
  if (action) {
    message.appendChild(document.createElement('br'))
    message.appendChild(action)
  }
  libraryList.appendChild(message)
}

function renderLibrary() {
  const items = libraryFilter
    ? libraryItems.filter(item => item.kind === libraryFilter)
    : libraryItems
  if (!items.length) {
    libraryMessage(libraryItems.length
      ? 'Nothing saved here yet.'
      : 'Your playlists, albums and podcasts from Spotify will show up here.')
    return
  }
  libraryList.innerHTML = ''
  items.forEach(item => {
    // names come from Spotify and other users — textContent only
    const row = document.createElement('button')
    row.type = 'button'
    row.className = `library-item ${item.kind}`
    row.title = `Play ${item.name}`

    const art = document.createElement('img')
    art.className = 'library-art'
    art.alt = ''
    art.loading = 'lazy'
    if (item.image) art.src = item.image

    const info = document.createElement('div')
    info.className = 'library-info'
    const name = document.createElement('div')
    name.className = 'library-name'
    name.textContent = item.name
    const sub = document.createElement('div')
    sub.className = 'library-sub'
    sub.textContent = item.subtitle
    info.append(name, sub)

    row.append(art, info)
    row.addEventListener('click', () => playContext(item))
    libraryList.appendChild(row)
  })
}

async function loadLibrary() {
  libraryMessage('Loading your library…')
  try {
    const res = await fetch('/library')
    if (res.status === 403) {
      const reason = (await res.json().catch(() => ({}))).reason
      if (reason === 'reconnect') {
        // sessions from before Your Library existed lack its permissions
        const button = document.createElement('a')
        button.href = '/login'
        button.textContent = 'Reconnect Spotify'
        libraryMessage('LyricSync needs a new permission to show your library.', button)
        return
      }
      libraryMessage("Spotify isn't sharing your library right now.")
      return
    }
    if (!res.ok) throw new Error(`library: ${res.status}`)
    libraryItems = (await res.json()).items || []
    renderLibrary()
  } catch (e) {
    console.warn('Library error:', e)
    libraryMessage("Couldn't load your library — try again in a moment.")
  }
}

document.querySelectorAll('#library-chips .chip').forEach(chip => {
  chip.addEventListener('click', () => {
    // clicking the active filter again shows everything
    libraryFilter = libraryFilter === chip.dataset.kind ? null : chip.dataset.kind
    document.querySelectorAll('#library-chips .chip').forEach(other => {
      other.setAttribute('aria-pressed', String(other.dataset.kind === libraryFilter))
    })
    renderLibrary()
  })
})

async function playContext(item) {
  try {
    const result = await postPlayback({ action: 'play_context', context_uri: item.uri })
    if (!result.ok) {
      reportPlaybackProblem(result)
      return
    }
    location.hash = '#/now-playing'
    setTimeout(fetchNowPlaying, 600)
  } catch (e) {
    showToast(UNREACHABLE)
  }
}

// ─────────────────────────────────────────
//  PAGES
// ─────────────────────────────────────────

// Hash routes, so the back button and a refresh keep you on the same page.
const PLACEHOLDER_TITLES = { home: 'Home', search: 'Search', favourites: 'Favourites' }
const VIEWS = ['now-playing', 'recent', ...Object.keys(PLACEHOLDER_TITLES)]

function currentView() {
  const name = location.hash.replace(/^#\/?/, '')
  return VIEWS.includes(name) ? name : 'now-playing'
}

function route() {
  const view = currentView()
  document.getElementById('view-now-playing').hidden = view !== 'now-playing'
  document.getElementById('view-recent').hidden = view !== 'recent'

  const placeholder = PLACEHOLDER_TITLES[view]
  document.getElementById('view-placeholder').hidden = !placeholder
  if (placeholder) document.getElementById('placeholder-title').textContent = placeholder

  document.querySelectorAll('.nav-link').forEach(link => {
    const active = link.dataset.view === view
    link.classList.toggle('active', active)
    if (active) link.setAttribute('aria-current', 'page')
    else link.removeAttribute('aria-current')
  })
  document.getElementById('btn-lyrics').classList.toggle('on', view === 'now-playing')

  if (view === 'recent') loadRecent()
  if (view === 'now-playing') recentreLyrics()
}

window.addEventListener('hashchange', route)

// ─────────────────────────────────────────
//  REQUEST A SONG
// ─────────────────────────────────────────

async function requestSong(track) {
  const button = document.getElementById('state-action')
  button.disabled = true
  try {
    const res = await fetch('/song-requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ track_id: track.track_id, song: track.song, artist: track.artist })
    })
    if (!res.ok) throw new Error(`song-requests: ${res.status}`)
    button.textContent = "Requested — thanks!"
  } catch (e) {
    button.disabled = false
    showToast("Couldn't send the request — try again in a moment.")
  }
}

// ─────────────────────────────────────────
//  SEEKING (drag or click the progress bar)
// ─────────────────────────────────────────

// Where on the track the pointer is, as a position in the song.
function seekTargetFrom(e) {
  const rect = progressContainer.getBoundingClientRect()
  if (rect.width === 0) return 0
  const ratio = (e.clientX - rect.left) / rect.width
  return Math.round(Math.min(Math.max(ratio, 0), 1) * durationMs)
}

// Paint a position without telling Spotify about it yet, so dragging shows
// where you'd land — lyrics included — before you let go.
function previewSeek(ms) {
  paintProgress(ms)
  timeCurrent.textContent = formatTime(ms)
  lastDisplayedSecond = Math.floor(ms / 1000)
  syncActiveLine(ms)
}

async function commitSeek(ms) {
  const target = Math.max(0, Math.min(ms, durationMs))

  // Move locally straight away rather than waiting on the round trip, and hold
  // that position until Spotify has had a chance to catch up.
  progressMs = target
  lastServerSync = Date.now()
  lastPollTime = 0                 // a jump this size would poison drift correction
  seekSettleUntil = Date.now() + SEEK_SETTLE_MS
  previewSeek(target)

  try {
    const result = await postPlayback({ action: 'seek', position_ms: target })
    if (!result.ok) {
      seekSettleUntil = 0          // rejected — let the next poll put us back
      reportPlaybackProblem(result)
      fetchNowPlaying()
      return
    }
    setTimeout(fetchNowPlaying, SEEK_SETTLE_MS + 100)
  } catch (e) {
    console.warn('Seek error:', e)
    seekSettleUntil = 0
    showToast(UNREACHABLE)
    fetchNowPlaying()
  }
}

function stopScrubbing() {
  isScrubbing = false
  progressHit.classList.remove('scrubbing')
}

progressHit.addEventListener('pointerdown', e => {
  if (!durationMs) return          // nothing playing — nothing to seek within
  isScrubbing = true
  progressHit.classList.add('scrubbing')
  progressHit.setPointerCapture(e.pointerId)
  previewSeek(seekTargetFrom(e))
})

progressHit.addEventListener('pointermove', e => {
  if (isScrubbing) previewSeek(seekTargetFrom(e))
})

progressHit.addEventListener('pointerup', e => {
  if (!isScrubbing) return
  stopScrubbing()
  commitSeek(seekTargetFrom(e))
})

// Lost the pointer (gesture cancelled) — drop the drag and let the next poll
// repaint from wherever Spotify actually is.
progressHit.addEventListener('pointercancel', stopScrubbing)

// ─────────────────────────────────────────
//  CONTEXT (QUEUE)
// ─────────────────────────────────────────

async function fetchContext() {
  if (!isLoggedIn) return
  try {
    // tell the server what's playing so it can keep it out of "recently played"
    const playing = playerTrackId()
    const url = playing
      ? `/context?current=${encodeURIComponent(playing)}`
      : '/context'
    const res = await fetch(url)
    if (!res.ok) return
    const data = await res.json()
    lastServerContext = { previous: data.previous || [], next: data.next || [] }
    renderMergedContext()
  } catch (e) {
    console.error('Context error:', e)
  }
}

const RECENT_DISPLAY = 2      // how many previous tracks the sidebar shows
const MAX_LOCAL_RECENT = 5    // keep a little history spare for de-duping

// We watch every track change ourselves, so we know what just finished long
// before Spotify's feed does — and in the case Spotify drops entirely (a track
// skipped before its minimum play time) we still know it.
function rememberRecent(track) {
  if (!track || !track.track_id) return
  localRecent = [
    {
      song: track.song,
      artist: track.artist,
      album_art: track.album_art,
      duration_ms: track.duration_ms,
      track_id: track.track_id,
      direction: 'previous'
    },
    ...localRecent.filter(t => t.track_id !== track.track_id)
  ].slice(0, MAX_LOCAL_RECENT)
}

// Local history first (it's fresher), Spotify's list behind it, de-duped by
// track. The server sends oldest-first, so flip it in and flip the result back.
// What is loaded in the player right now. This is not always the track whose
// lyrics we hold: pausing and then switching track leaves currentTrackId behind
// until playback resumes, while lastKnownData follows the player.
function playerTrackId() {
  return lastKnownData?.track_id || currentTrackId
}

function mergeRecent(serverPrev) {
  const merged = []
  const seen = new Set()
  const playing = playerTrackId()

  for (const track of [...localRecent, ...[...serverPrev].reverse()]) {
    if (!track.track_id || seen.has(track.track_id)) continue
    if (track.track_id === playing) continue
    seen.add(track.track_id)
    merged.push(track)
    if (merged.length === RECENT_DISPLAY) break
  }

  return merged.reverse()
}

let lastServerContext = { previous: [], next: [] }

function renderMergedContext() {
  renderContext(mergeRecent(lastServerContext.previous), lastServerContext.next)
}

// Spotify only logs a track as recently-played once it has finished, and the
// feed lags behind that. Ask immediately on a track change, then once more a
// few seconds later to pick up Spotify's version when it lands.
let contextFollowUp = null

function refreshContextSoon() {
  renderMergedContext()   // paint local history now, don't wait on the network
  fetchContext()
  clearTimeout(contextFollowUp)
  contextFollowUp = setTimeout(fetchContext, 5000)
}

function renderContext(prev, next) {
  const list = document.getElementById('queue-list')

  if (!prev.length && !next.length) {
    list.innerHTML = '<div class="queue-empty">Nothing queued — add songs in Spotify</div>'
    return
  }

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

// Built with textContent rather than an HTML string: song and artist names
// come from Spotify, and a track called <img onerror=...> is legal there.
function buildQueueItem(track, direction, num) {
  const div = document.createElement('div')
  div.className = `queue-item${direction === 'prev' ? ' queue-item-prev' : ''}`

  const number = document.createElement('div')
  number.className = 'queue-num'
  number.textContent = direction === 'next' ? num : '↩'

  const thumb = document.createElement('img')
  thumb.className = 'queue-thumb'
  thumb.alt = ''
  if (track.album_art) thumb.src = track.album_art

  const info = document.createElement('div')
  info.className = 'queue-info'
  const song = document.createElement('div')
  song.className = 'queue-song'
  song.textContent = track.song
  const artist = document.createElement('div')
  artist.className = 'queue-artist'
  artist.textContent = track.artist
  info.append(song, artist)

  const duration = document.createElement('div')
  duration.className = 'queue-duration'
  duration.textContent = formatTime(track.duration_ms)

  div.append(number, thumb, info, duration)
  return div
}

function toggleQueue(open) {
  const panel = document.getElementById('queue-panel')
  const show = open ?? panel.hidden
  panel.hidden = !show
  document.getElementById('btn-queue').setAttribute('aria-pressed', String(show))
  if (show) fetchContext()
}

// ─────────────────────────────────────────
//  RECENTLY PLAYED
// ─────────────────────────────────────────

const recentList = document.getElementById('recent-list')

const PLAY_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"/></svg>'

function recentMessage(text) {
  recentList.innerHTML = ''
  const message = document.createElement('div')
  message.className = 'recent-empty'
  message.textContent = text
  recentList.appendChild(message)
}

function buildRecentItem(track) {
  const row = document.createElement('div')
  row.className = 'recent-item'
  if (track.track_id === currentTrackId) row.classList.add('playing')
  row.title = `Play ${track.song}`

  const thumb = document.createElement('div')
  thumb.className = 'recent-thumb'
  if (track.album_art) {
    const art = document.createElement('img')
    art.src = track.album_art
    art.alt = ''
    thumb.appendChild(art)
  }

  // song and artist are set with textContent, not innerHTML — they're names
  // that came from Spotify, and a track called <img onerror=...> is legal
  const info = document.createElement('div')
  info.className = 'recent-info'
  const song = document.createElement('div')
  song.className = 'recent-song'
  song.textContent = track.song
  const artist = document.createElement('div')
  artist.className = 'recent-artist'
  artist.textContent = track.artist
  info.append(song, artist)

  const play = document.createElement('div')
  play.className = 'recent-play'
  play.innerHTML = PLAY_ICON

  row.append(thumb, info, play)
  row.addEventListener('click', () => playTrack(track))
  return row
}

function renderRecent(tracks) {
  if (!tracks.length) {
    recentMessage('Nothing translated yet — play a song in another language on Spotify.')
    return
  }
  recentList.innerHTML = ''
  tracks.forEach(track => recentList.appendChild(buildRecentItem(track)))
}

async function playTrack(track) {
  location.hash = '#/now-playing'
  try {
    const result = await postPlayback({ action: 'play_track', track_id: track.track_id })
    if (!result.ok) {
      reportPlaybackProblem(result)
      return
    }
    setTimeout(fetchNowPlaying, 400)
  } catch (e) {
    console.error('Play track error:', e)
    showToast(UNREACHABLE)
  }
}

// Recently Translated lists songs heard with translations showing, so a song
// goes in once its translated lyrics are on screen
function recordListen(track, sourceLang) {
  fetch('/history', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      track_id: track.track_id,
      song: track.song,
      artist: track.artist,
      album_art: track.album_art || null,
      source_lang: sourceLang || null,
      target_lang: 'EN'
    })
  }).catch(e => console.warn('Recording history failed:', e))
}

async function loadRecent() {
  recentMessage('Loading…')
  try {
    const res = await fetch('/history')
    if (res.status === 401) {
      recentMessage('Connect Spotify to see your listening history.')
      return
    }
    if (!res.ok) throw new Error(`history: ${res.status}`)
    const data = await res.json()
    renderRecent(data.tracks || [])
  } catch (e) {
    console.error('Recently translated error:', e)
    recentMessage("Couldn't load your history — try again in a moment.")
  }
}

// ── settings modal ──
document.getElementById('sidebar-settings-btn').addEventListener('click', openSettings)
document.getElementById('settings-modal').addEventListener('click', function(e) {
  if (e.target === this) closeSettings()
})

function openSettings() {
  // populate account name if we have it
  fetch('/me')
    .then(r => r.json())
    .then(data => {
      const nameEl = document.getElementById('settings-account-name')
      if (nameEl && data.display_name) nameEl.textContent = data.display_name
      const emailEl = document.getElementById('settings-account-email')
      if (emailEl && data.email) emailEl.textContent = data.email
    })
    .catch(() => {})
  document.getElementById('settings-modal').style.display = 'flex'
}

function closeSettings() {
  document.getElementById('settings-modal').style.display = 'none'
}

async function disconnectSpotify() {
  try {
    await fetch('/logout', { method: 'POST' })
  } catch(e) {}
  closeSettings()
  signedOut()
}

// Back to the connect screen with nothing of the old session left behind —
// after Disconnect, or when the server says the session has gone.
function signedOut() {
  isLoggedIn = false
  accessProblem = null
  libraryItems = []
  libraryList.innerHTML = ''
  currentTrackId = null
  currentTrackData = null
  localRecent = []
  currentLyrics = []
  currentLyricsSynced = false
  currentLineIndex = -1
  lastKnownData = null
  isPlaying = false
  showWelcomeScreen()
}

// ─────────────────────────────────────────
//  PREFETCH NEXT TRACK
// ─────────────────────────────────────────

async function prefetchNextTrack() {
  if (isPrefetching) return
  try {
    const res = await fetch('/context')
    if (!res.ok) return
    const data = await res.json()

    const next = data.next?.[0]
    if (!next || !next.song || !next.artist || !next.track_id) return
    if (next.track_id === prefetchedTrackId) return  // already done
    if (next.track_id === currentTrackId) return     // same as current

    isPrefetching = true
    prefetchedTrackId = next.track_id
    console.log(`[prefetch] Starting: ${next.song} — ${next.artist}`)

    const url = `/translate?song=${encodeURIComponent(next.song)}&artist=${encodeURIComponent(next.artist)}&track_id=${encodeURIComponent(next.track_id)}&target_lang=EN`
    const r = await fetch(url)
    const d = await r.json()
    console.log(`[prefetch] Done: ${d.cached ? 'cache hit' : 'freshly translated'} — ${next.song}`)
  } catch (e) {
    console.warn('[prefetch] error:', e)
  } finally {
    isPrefetching = false
  }
}

// ─────────────────────────────────────────
//  SPOTIFY REFUSING ACCESS
// ─────────────────────────────────────────

// LyricSync runs in Spotify's development mode, where Spotify can refuse the
// app for reasons nothing on this page can fix. Say which, rather than
// leaving the connect screen up as if signing in had silently failed.
const ACCESS_PROBLEMS = {
  owner_premium_required: {
    title: 'Spotify access is paused',
    desc: "Spotify needs LyricSync's owner to have an active Premium subscription. " +
          'Once it\'s renewed, Spotify can take a few hours to let LyricSync back in — ' +
          'this page will pick it up by itself.',
    canReconnect: false
  },
  user_not_registered: {
    title: "This account isn't approved yet",
    desc: "LyricSync is in Spotify's development mode, so only approved accounts can use it. " +
          'Ask the app owner to add your Spotify email, or connect a different account.',
    canReconnect: true
  },
  forbidden: {
    title: 'Spotify refused access',
    desc: "Spotify isn't letting LyricSync read your playback right now. " +
          'This page will keep trying.',
    canReconnect: true
  }
}
let accessProblem = null   // reason currently on screen, so polls don't redraw it

function showAccessProblem(reason) {
  if (!Object.hasOwn(ACCESS_PROBLEMS, reason)) reason = 'forbidden'
  if (reason === accessProblem) return
  signedOut()
  accessProblem = reason
  const problem = ACCESS_PROBLEMS[reason]
  setWelcomeText(problem.title, '', problem.desc)
  welcomeLoginBtn.classList.toggle('hidden', !problem.canReconnect)
}

// ─────────────────────────────────────────
//  LYRICS RETRY
// ─────────────────────────────────────────

// Retrying on every 5s poll hammered LRCLIB and DeepL for as long as either
// was down. Back off instead, and stop after a few attempts.
const RETRY_BASE_MS = 5000
const RETRY_MAX_MS = 60000
const RETRY_ATTEMPTS = 5
let failedTrackId = null
let failedAttempts = 0
let retryAt = 0

function scheduleLyricsRetry(trackId) {
  failedAttempts = trackId === failedTrackId ? failedAttempts + 1 : 1
  failedTrackId = trackId
  // the next poll treats the track as new again, which is what retries it
  currentTrackId = null
  currentContentState = null

  if (failedAttempts >= RETRY_ATTEMPTS) {
    retryAt = Infinity   // until the track changes
    currentContentState = 'no-lyrics'
    showContent('message', {
      title: "We couldn't load the lyrics for this song.",
      subtitle: "The lyrics service isn't responding — try this song again later.",
      notes: true
    })
    return
  }

  retryAt = Date.now() + Math.min(RETRY_BASE_MS * 2 ** (failedAttempts - 1), RETRY_MAX_MS)
  showContent('message', {
    title: 'Fetching lyrics...',
    subtitle: 'Taking a little longer than usual, hang tight.'
  })
}

// ─────────────────────────────────────────
//  MAIN FETCH LOOP
// ─────────────────────────────────────────

async function fetchNowPlaying() {
  if (isFetching) return
  isFetching = true

  try {
    const response = await fetch('/now-playing')

    // Never signed in, or the session lapsed (e.g. Spotify refused the token
    // refresh). Only redraw on the change — the connect screen is already up
    // on first load, and restarting its animation every poll would stutter.
    if (response.status === 401) {
      if (isLoggedIn) signedOut()
      return
    }

    if (response.status === 403) {
      let reason = 'forbidden'
      try { reason = (await response.json()).reason || reason } catch (e) { /* no JSON body */ }
      showAccessProblem(reason)
      return
    }

    if (!response.ok) {
      console.warn('now-playing error:', response.status)
      return
    }

    if (!isLoggedIn) {
      accessProblem = null
      isLoggedIn = true
      loadPrefs()
      loadLibrary()
      showBars()
      fetchContext()
    }

    const data = await response.json()

    // ── PAUSED or NOTHING PLAYING ──
    // Freeze everything exactly as-is, for as long as it stays paused.
    if ((!data.is_playing && data.song) || (!data.playing && !data.song)) {
      isPlaying = false
      updatePlayPauseIcon(false)

      // freeze bars at current track
      if (data.song) {
        lastKnownData = data
        updateTopBar(data)
        updateBottomBar(data)
        updatePlayerState(data)
        if (Date.now() >= seekSettleUntil) {
          updateProgressBar(data.progress_ms, data.duration_ms)
        }
      } else if (lastKnownData) {
        updateTopBar(lastKnownData)
        updateBottomBar(lastKnownData)
      }

      // A pause used to fall back to the welcome screen after 60s, which read
      // as being disconnected and sent you to Spotify to start again. Stay put
      // instead. The exception is having nothing to stay on: with no track
      // known yet, the welcome screen is the only thing to show.
      if (!lastKnownData && welcomeScreen.style.display === 'none') {
        showWelcomeScreen()
      }

      // content panel stays frozen — don't touch it
      return
    }

    // ── PLAYING ──
    isPlaying = true
    lastKnownData = data
    durationMs = data.duration_ms

    // A seek we just issued may not be reflected by Spotify yet — adopting its
    // position here would snap the bar back to where we seeked from.
    if (Date.now() >= seekSettleUntil) {
      lastServerSync = Date.now()

      // ── dynamic drift correction ──
      // Compare where we predicted the song would be (via local tick)
      // vs where Spotify actually says it is — the gap is our drift.
      // We blend it in gradually (30% weight) to avoid jumpy corrections.
      if (lastPollTime > 0 && data.track_id === currentTrackId) {
        const expectedProgress = lastPollProgressMs + (Date.now() - lastPollTime)
        const actualProgress = data.progress_ms
        const measuredDrift = actualProgress - expectedProgress
        // only correct if drift is significant (>100ms) and not a seek/skip jump (>3s)
        if (Math.abs(measuredDrift) > 100 && Math.abs(measuredDrift) < 3000) {
          dynamicOffset = Math.round(dynamicOffset * 0.7 + measuredDrift * 0.3)
        }
      }
      lastPollProgressMs = data.progress_ms
      lastPollTime = Date.now()
      progressMs = data.progress_ms
    }

    updatePlayPauseIcon(true)
    updateProgressBar(progressMs, durationMs)
    updateTopBar(data)
    updateBottomBar(data)
    updatePlayerState(data)



    // welcome screen may be up (nothing had played yet) — restore the player
    if (!welcomeScreen.classList.contains('hidden') && welcomeScreen.style.display !== 'none') {
      hideWelcomeScreen(() => {
        topBar.style.display = 'flex'
        bottomBar.style.display = 'flex'
        // restore whichever content panel was showing before pause
        if (currentContentState === 'lyrics') {
          lyricsContainer.style.display = 'block'
          stateScreen.style.display = 'none'
          // re-sync to current position
          recentreLyrics()
        } else if (currentContentState) {
          // loading / no-lyrics / english — stateScreen was showing
          stateScreen.style.display = 'flex'
          lyricsContainer.style.display = 'none'
        }
      })
    }

    // same track — just sync line
    if (data.track_id === currentTrackId) {
      syncActiveLine(progressMs)
      return
    }

    // a failed lyrics load waits out its backoff before trying again
    if (data.track_id === failedTrackId && Date.now() < retryAt) return

    // ── NEW TRACK ──
    // Record the outgoing track ourselves rather than waiting on Spotify. This
    // reads currentTrackData rather than lastKnownData: the paused branch moves
    // lastKnownData onto the new track, so it can't tell us what we left.
    if (currentTrackData && currentTrackData.track_id !== data.track_id) {
      rememberRecent(currentTrackData)
    }
    if (data.track_id !== failedTrackId) {
      failedTrackId = null
      failedAttempts = 0
    }
    currentTrackId = data.track_id
    currentTrackData = data
    currentLyrics = []
    currentLyricsSynced = false
    currentLineIndex = -1
    currentContentState = 'loading'
    langBadge.style.display = 'none'
    dynamicOffset = 0           // reset drift for new track
    prefetchNextTrack()         // immediately prefetch next-in-queue in case of skip
    refreshContextSoon()        // don't make the sidebar wait for the 10s poll

    showContent('message', {
      title: 'Loading lyrics...',
      subtitle: `Fetching translation for ${data.song}`
    })

    let translateData
    try {
      const translateRes = await fetch(
        `/translate?song=${encodeURIComponent(data.song)}&artist=${encodeURIComponent(data.artist)}&track_id=${encodeURIComponent(data.track_id)}&target_lang=EN`
      )
      if (translateRes.status === 401) {
        signedOut()
        return
      }
      if (!translateRes.ok) {
        // server error (e.g. LRCLIB timeout) — retry later rather than give up
        scheduleLyricsRetry(data.track_id)
        return
      }
      translateData = await translateRes.json()
    } catch (e) {
      // network error — same retry
      scheduleLyricsRetry(data.track_id)
      return
    }
    failedTrackId = null
    failedAttempts = 0

    if (!translateData.translated) {
      currentContentState = 'no-lyrics'
      showContent('message', {
        title: "We couldn't find the lyric translations for this song yet. Check back soon — we're working on it!",
        notes: true,
        action: { label: 'Request this song!', onClick: () => requestSong(data) }
      })
      return
    }

    // Keep every line: Punjabi and Hindi songs often switch into English for a
    // hook, and dropping those lines left holes in the song.
    currentLyrics = translateData.lyrics.map(line => ({
      ...line,
      needsTranslation: needsTranslation(line)
    }))
    currentLyricsSynced = hasTimings(currentLyrics)

    if (!currentLyrics.some(line => line.needsTranslation)) {
      currentLyrics = []
      currentContentState = 'english'
      showContent('message', {
        title: 'Already in English',
        subtitle: 'No translation needed for this track.'
      })
      return
    }

    const lang = dominantLanguage(currentLyrics)
    if (lang) {
      langBadge.textContent = `${langLabel(lang)} → ENG`
      paintLangPill(langBadge, lang)
      langBadge.style.display = 'block'
      if (currentTrackId) translation_cache_js[currentTrackId] = `${lang} → EN`
    }

    renderLyrics(currentLyrics)
    if (translationEnabled) recordListen(data, lang)
    currentContentState = 'lyrics'
    showContent('lyrics')

    recentreLyrics()

  } catch (err) {
    console.error('Fetch error:', err)
  } finally {
    isFetching = false
  }
}

// ─────────────────────────────────────────
//  LOCAL PROGRESS TICK
// ─────────────────────────────────────────

let lastDisplayedSecond = -1

function tickProgress() {
  if (!isPlaying || durationMs === 0) return
  if (isScrubbing) return   // the drag owns the bar until it's released

  const elapsed = Date.now() - lastServerSync
  const estimated = progressMs + elapsed
  const capped = Math.min(estimated, durationMs)

  paintProgress(capped)

  // the clock only changes once a second — don't rewrite it on every tick
  const second = Math.floor(capped / 1000)
  if (second !== lastDisplayedSecond) {
    lastDisplayedSecond = second
    timeCurrent.textContent = formatTime(capped)
  }

  syncActiveLine(capped)
}

// ─────────────────────────────────────────
//  KICK OFF
// ─────────────────────────────────────────

route()

// Show welcome (login mode) immediately — fetchNowPlaying will replace it
showWelcomeScreen()

fetchNowPlaying()
setInterval(fetchNowPlaying, 5000)
setInterval(fetchContext, 10000)
setInterval(tickProgress, TICK_MS)