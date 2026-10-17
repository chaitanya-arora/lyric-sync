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

// What floats up the welcome screen: the word "music" in the languages
// LyricSync plays, in their own scripts, between drawn music notes.
const MUSIC_WORDS = [
  'संगीत', 'ਸੰਗੀਤ', '음악', '音楽', '音乐', 'موسيقى', 'música', 'musique',
  'musica', 'Musik', 'müzik', 'музыка', 'μουσική', 'muziek', 'musik', 'nhạc'
]
const NOTE_ICONS = [
  '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3z"/></svg>',
  '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21 3 9 5.5v9.06A3.5 3.5 0 1 0 11 18V9.3l8-1.66v5.42A3.5 3.5 0 1 0 21 16z"/></svg>'
]
const FLOAT_COLOURS = ['#ff5a5f', '#ff8a3d', '#ffb627', '#9be22d', '#22c3b1', '#5b8cff', '#9b5cff', '#d65cf5', '#ff4f9a']

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
  document.querySelectorAll('.welcome-float').forEach(el => el.remove())

  const count = 26
  for (let i = 0; i < count; i++) {
    const el = document.createElement('div')
    el.className = 'welcome-float'
    // mostly words, with a note every third float
    if (i % 3 === 2) {
      el.innerHTML = NOTE_ICONS[i % NOTE_ICONS.length]
      el.classList.add('note')
    } else {
      el.textContent = MUSIC_WORDS[i % MUSIC_WORDS.length]
    }

    const duration = 10 + Math.random() * 12   // seconds to float up
    el.style.left = `${Math.random() * 96}%`
    el.style.top = `${100 + Math.random() * 40}%`
    el.style.fontSize = `${15 + Math.random() * 14}px`
    el.style.color = FLOAT_COLOURS[i % FLOAT_COLOURS.length]
    el.style.setProperty('--float-opacity', (0.35 + Math.random() * 0.35).toFixed(2))
    el.style.animation = `floatUp ${duration}s ${-(Math.random() * duration)}s linear infinite`
    welcomeScreen.appendChild(el)
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

// The welcome card without the onboarding steps: "you're connected", or why
// Spotify said no. `canConnect` shows the Connect with Spotify button.
function showWelcomeMessage(title, tagline, desc, canConnect) {
  setWelcomeIcon('brand')
  setWelcomeText(title, tagline, desc)
  document.getElementById('onboard-progress').hidden = true
  for (const id of ONBOARD_PANELS) document.getElementById(id).hidden = true
  document.getElementById('onboard-next').hidden = true
  document.getElementById('onboard-back').hidden = true
  welcomeLoginBtn.classList.toggle('hidden', !canConnect)
  setWelcomeNote(canConnect ? 'Your Spotify password is never shared with us' : '')
}

function showWelcomeScreen() {
  topBar.style.display = 'none'
  bottomBar.style.display = 'none'
  stateScreen.style.display = 'none'
  lyricsContainer.style.display = 'none'

  welcomeScreen.classList.remove('fade-out', 'hidden')
  welcomeScreen.style.display = 'flex'
  welcomeScreen.style.opacity = '1'

  if (onboardingOpen) {
    renderOnboardingStep(4)
    stopWelcomeAnimation()
    resizeCanvas()
    isAnimating = true
    requestAnimationFrame(animateWelcome)
  } else if (isLoggedIn) {
    showWelcomeMessage("You're connected!", 'Play a song in Spotify to get started',
      'Your translated lyrics will appear here, line by line, as you listen.', false)
    // orbs run on connected screen too — just no floating flags/notes
    stopWelcomeAnimation()
    resizeCanvas()
    isAnimating = true
    requestAnimationFrame(animateWelcome)
  } else {
    renderOnboardingStep(onboardStep)
    startWelcomeAnimation()  // flags + notes + orbs
  }
}

function hideWelcomeScreen(callback) {
  welcomeScreen.classList.add('fade-out')
  setTimeout(() => {
    // the language step opened while this faded out — it stays up
    if (onboardingOpen) return
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
  // the timing nudge only means something for lyrics that follow the song
  document.getElementById('timing-nudge').hidden = !(type === 'lyrics' && currentLyricsSynced)
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

// For your own data (history, favourites, settings). A 503 means you're
// signed in but Spotify was too busy to say who you are — wait a moment and
// ask again rather than showing an empty page or "connect Spotify".
async function userFetch(url, options, attempts = 3) {
  for (let i = 1; ; i++) {
    const res = await fetch(url, options)
    if (res.status !== 503 || i >= attempts) return res
    await new Promise(resolve => setTimeout(resolve, 1500 * i))
  }
}

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
  updateActiveLine(getCurrentLineIndex(currentLyrics, ms + SYNC_OFFSET_BASE + dynamicOffset + timingNudge))
}

// ── lyric timing nudge ──
// LRCLIB's timings are sometimes a beat early or late for a recording. A
// nudge is kept per song, in this browser, so the fix sticks next time.
const NUDGE_STEP_MS = 250
const NUDGE_LIMIT_MS = 5000
let timingNudge = 0     // ms; positive shows lines sooner

function nudgeKey(trackId) { return `lyricsync:nudge:${trackId}` }

function loadTimingNudge(trackId) {
  timingNudge = 0
  try { timingNudge = Number(localStorage.getItem(nudgeKey(trackId))) || 0 } catch (e) { /* storage off */ }
  paintTimingNudge()
}

function nudgeTiming(direction) {
  if (!currentTrackId || !currentLyricsSynced) return
  // "later" means the lines arrive later, so the lead shrinks
  timingNudge = Math.max(-NUDGE_LIMIT_MS, Math.min(NUDGE_LIMIT_MS, timingNudge - direction * NUDGE_STEP_MS))
  try {
    if (timingNudge) localStorage.setItem(nudgeKey(currentTrackId), String(timingNudge))
    else localStorage.removeItem(nudgeKey(currentTrackId))
  } catch (e) { /* storage off: the nudge lasts for this visit */ }
  paintTimingNudge()
  currentLineIndex = -1
  syncActiveLine(isPlaying ? progressMs + (Date.now() - lastServerSync) : progressMs)
}

function paintTimingNudge() {
  const label = document.getElementById('timing-value')
  const seconds = String(Number(Math.abs(timingNudge / 1000).toFixed(2)))
  label.textContent = !timingNudge ? 'Lyrics in time'
    : timingNudge > 0 ? `${seconds}s earlier` : `${seconds}s later`
  document.getElementById('timing-nudge').classList.toggle('nudged', Boolean(timingNudge))
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

// Every language has one colour, used wherever that language appears: its
// pill, tile, pin, the lyric box and the translations. They're the Browse
// All colours from the Figma file at full strength, plus three more.
const SWATCHES = {
  rose: '#ff5a5f', tangerine: '#ff8a3d', mango: '#ffb627', lime: '#9be22d',
  seafoam: '#22c3b1', periwinkle: '#5b8cff', violet: '#9b5cff', orchid: '#d65cf5',
  bubblegum: '#ff4f9a', sky: '#2bb3ff', cherry: '#ef3b50', sunflower: '#ffd23f'
}

const LANG_SWATCH = {
  FR: 'rose', KO: 'tangerine', HI: 'mango', ES: 'lime', EN: 'seafoam', JA: 'periwinkle',
  ZH: 'violet', AR: 'orchid', IT: 'bubblegum', PA: 'sunflower', PT: 'sky', TR: 'cherry',
  UR: 'orchid', DE: 'periwinkle', RU: 'sky', ID: 'sunflower', TH: 'tangerine', VI: 'lime',
  TL: 'cherry', NL: 'tangerine', PL: 'rose', SV: 'sky', EL: 'periwinkle', HE: 'violet'
}

// LyricSync's own green, for when no language is in play
const BRAND_COLOR = '#1ed760'

function langColor(code) {
  const base = (code || '').split('-')[0]
  if (!base) return BRAND_COLOR
  let name = LANG_SWATCH[base]
  if (!name) {
    // anything unlisted still gets a colour, the same one every time
    const names = Object.keys(SWATCHES)
    let hash = 0
    for (const ch of base) hash = (hash * 31 + ch.charCodeAt(0)) % names.length
    name = names[hash]
  }
  return SWATCHES[name]
}

// Black or white, whichever reads better on the colour.
function inkFor(hex) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return luminance > 0.22 ? '#0b0c0f' : '#ffffff'
}

function paintColor(el, color) {
  el.style.setProperty('--lang-color', color)
  el.style.setProperty('--lang-ink', inkFor(color))
}

// The song's colour belongs to the song: Now Playing and the player take on
// the colour of the language being sung. Everywhere else stays LyricSync
// green, so browsing India while a French song plays isn't painted rose.
let accentLang = null
function setAccent(code) {
  if (code === accentLang) return
  accentLang = code
  const color = langColor(code)
  for (const id of ['view-now-playing', 'bottom-bar']) {
    const el = document.getElementById(id)
    el.style.setProperty('--accent', color)
    el.style.setProperty('--accent-ink', inkFor(color))
  }
}

function paintLangPill(el, code) {
  paintColor(el, langColor(code))
}

function normaliseLyric(text) {
  return text.toLowerCase().replace(/\s+/g, ' ').trim()
}

// A line DeepL left alone was already in the language we're translating
// into — there's nothing to show under it, but it still belongs in the song.
function needsTranslation(line) {
  if (line.detected_language === targetBase()) return false
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
function centreLine(line, instant = false) {
  const top = line.offsetTop - (lyricsContainer.clientHeight - line.offsetHeight) / 2
  lyricsContainer.scrollTo({ top: Math.max(top, 0), behavior: instant ? 'instant' : 'smooth' })
}

// A line can't be scrolled to while the lyrics are hidden (behind the welcome
// screen, or on another page). Forget which line is showing so the next sync
// scrolls to it, now that it can.
function recentreLyrics() {
  currentLineIndex = -1
  syncActiveLine(isPlaying ? progressMs + (Date.now() - lastServerSync) : progressMs)
  // arriving at the lyrics jumps to the line; only moving between lines glides
  const active = lyricsInner.querySelector('.lyric-line.active')
  if (active) centreLine(active, true)
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
  paintFavouriteButton(data.track_id)
  document.title = `${data.song} · ${data.artist} — LyricSync`
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
  for (const id of ['toggle-switch', 'settings-translate-toggle']) {
    const toggle = document.getElementById(id)
    toggle.classList.toggle('on', translationEnabled)
    toggle.setAttribute('aria-checked', String(translationEnabled))
  }
  document.querySelectorAll('.lyric-translation').forEach(el => {
    el.style.display = translationEnabled ? '' : 'none'
  })
}

function toggleTranslation() {
  applyTranslationEnabled(!translationEnabled)
  // remembered for next time, on any device — the switch works either way
  userFetch('/prefs', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ auto_translate: translationEnabled })
  }).catch(e => console.warn('Saving the translation setting failed:', e))
}

async function loadPrefs() {
  try {
    const res = await userFetch('/prefs')
    if (!res.ok) return
    const prefs = await res.json()
    applyTranslationEnabled(prefs.auto_translate !== false)
    if (prefs.target_lang && prefs.target_lang !== targetLang) {
      targetLang = prefs.target_lang
      targetSelect.value = targetLang
      reloadLyrics()   // anything already loaded was fetched in English
    }
    if (prefs.onboarded === false) openLanguageStep()
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

// ─────────────────────────────────────────
//  PLAYING IN THE BROWSER
// ─────────────────────────────────────────

// Spotify's Web Playback SDK makes this tab a Spotify device called
// "LyricSync". When nothing else is playing, songs started here play here;
// when a phone or speaker is already playing, they go there as before.
// It needs Premium and a desktop browser — anywhere else it stays quiet.
const PLAY_ACTIONS = new Set(['play', 'play_track', 'play_tracks', 'play_context'])
let webPlayer = null
let webPlayerId = null          // this tab's device id, once it's ready
let spotifyHasDevice = false    // whether Spotify reports an active device

function startWebPlayer() {
  if (webPlayer) {
    webPlayer.connect()   // signed in again after disconnecting
    return
  }
  if (document.getElementById('spotify-sdk')) return   // still loading
  window.onSpotifyWebPlaybackSDKReady = () => {
    webPlayer = new Spotify.Player({
      name: 'LyricSync',
      volume: 0.8,
      getOAuthToken: callback => {
        fetch('/player-token')
          .then(r => (r.ok ? r.json() : Promise.reject(r.status)))
          .then(data => callback(data.access_token))
          .catch(() => {})
      }
    })
    webPlayer.addListener('ready', ({ device_id }) => { webPlayerId = device_id })
    webPlayer.addListener('not_ready', () => { webPlayerId = null })
    // no Premium, an unsupported browser, or a session from before the
    // streaming permission: playback simply stays on other devices
    for (const event of ['initialization_error', 'authentication_error', 'account_error']) {
      webPlayer.addListener(event, () => { webPlayerId = null })
    }
    webPlayer.connect()
  }
  const script = document.createElement('script')
  script.id = 'spotify-sdk'
  script.src = 'https://sdk.scdn.co/spotify-player.js'
  document.head.appendChild(script)
}

function stopWebPlayer() {
  if (webPlayer) webPlayer.disconnect()
  webPlayerId = null
}

// Browsers only let a page start sound in response to a click. Called at
// the top of each click that plays something, before anything is awaited.
function unlockWebPlayer() {
  if (webPlayer && webPlayer.activateElement) webPlayer.activateElement()
}

async function postPlayback(body, { onWebPlayer = true } = {}) {
  if (onWebPlayer && !body.device_id && PLAY_ACTIONS.has(body.action) && !spotifyHasDevice && webPlayerId) {
    body = { ...body, device_id: webPlayerId }
  }
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
  unlockWebPlayer()
  if (!isPlaying && !spotifyHasDevice && lastKnownData) {
    await resumeLastSong()
    return
  }
  const action = isPlaying ? 'pause' : 'play'
  await sendPlayback(action)
}

// Paused long enough, Spotify drops the device and "play" has nothing to
// resume. Wake the device you were on if Spotify still lists it; if not,
// carry on in this tab from the same spot, so you don't need your phone.
async function resumeLastSong() {
  try {
    let result = await postPlayback({ action: 'play' }, { onWebPlayer: false })
    if (!result.ok && webPlayerId) {
      result = await postPlayback({
        action: 'play_track',
        track_id: lastKnownData.track_id,
        position_ms: Math.max(0, Math.floor(progressMs || 0)),
        device_id: webPlayerId
      })
    }
    if (result.ok) {
      setTimeout(fetchNowPlaying, 600)
      return
    }
    reportPlaybackProblem(result)
  } catch (e) {
    console.error('Resume error:', e)
    showToast(UNREACHABLE)
  }
}

// The song on screen, kept in this browser so a reloaded tab can carry on.
const LAST_SONG_KEY = 'lyricsync:last-song'
const PAUSED_KEEP_MS = 60 * 60 * 1000
let lastSeenSongAt = 0

function rememberLastSong(data) {
  try {
    localStorage.setItem(LAST_SONG_KEY, JSON.stringify({ data, savedAt: Date.now() }))
  } catch (e) { /* storage off: a reload starts fresh */ }
}

function savedLastSong() {
  try {
    const saved = JSON.parse(localStorage.getItem(LAST_SONG_KEY))
    if (saved && saved.data && saved.data.track_id && Date.now() - saved.savedAt < PAUSED_KEEP_MS) {
      return saved
    }
  } catch (e) { /* nothing usable saved */ }
  return null
}

function forgetLastSong() {
  try { localStorage.removeItem(LAST_SONG_KEY) } catch (e) { /* storage off */ }
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
  unlockWebPlayer()
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
//  FAVOURITES
// ─────────────────────────────────────────

let favourites = []           // newest first, as the server sends them
const favList = document.getElementById('fav-list')
const favButton = document.getElementById('fav-btn')

function isFavourite(trackId) {
  return favourites.some(track => track.track_id === trackId)
}

function paintFavouriteButton(trackId) {
  const saved = isFavourite(trackId)
  favButton.setAttribute('aria-pressed', String(saved))
  const label = saved ? 'Remove from Favourites' : 'Save to Favourites'
  favButton.setAttribute('aria-label', label)
  favButton.title = label
}

async function loadFavourites() {
  try {
    const res = await userFetch('/favourites')
    if (!res.ok) return
    favourites = (await res.json()).tracks || []
    paintFavouriteButton(playerTrackId())
    renderFavourites()
  } catch (e) {
    console.warn('Favourites error:', e)
  }
}

async function toggleFavourite() {
  const track = lastKnownData
  if (!track || !track.track_id) return
  const saving = !isFavourite(track.track_id)
  const before = favourites

  // show it straight away; put it back if the server says no
  if (saving) {
    favourites = [{
      track_id: track.track_id, song: track.song, artist: track.artist,
      album: track.album, album_art: track.album_art, duration_ms: track.duration_ms,
      source_lang: track.track_id === currentTrackId ? dominantLanguage(currentLyrics) || null : null
    }, ...favourites]
  } else {
    favourites = favourites.filter(t => t.track_id !== track.track_id)
  }
  paintFavouriteButton(track.track_id)
  renderFavourites()

  try {
    const url = `/favourites/${encodeURIComponent(track.track_id)}`
    const res = saving
      ? await fetch(url, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(favourites[0])
        })
      : await fetch(url, { method: 'DELETE' })
    if (!res.ok) throw new Error(`favourites: ${res.status}`)
    showToast(saving ? 'Saved to Favourites' : 'Removed from Favourites', 2500)
  } catch (e) {
    favourites = before
    paintFavouriteButton(track.track_id)
    renderFavourites()
    showToast("Couldn't update Favourites — try again in a moment.")
  }
}

async function removeFavourite(track) {
  const before = favourites
  favourites = favourites.filter(t => t.track_id !== track.track_id)
  paintFavouriteButton(playerTrackId())
  renderFavourites()
  try {
    const res = await userFetch(`/favourites/${encodeURIComponent(track.track_id)}`, { method: 'DELETE' })
    if (!res.ok) throw new Error(`favourites: ${res.status}`)
  } catch (e) {
    favourites = before
    paintFavouriteButton(playerTrackId())
    renderFavourites()
    showToast("Couldn't remove that — try again in a moment.")
  }
}

// Play the list from one song on, so it carries on through the rest.
async function playFavourites(index) {
  unlockWebPlayer()
  try {
    const result = await postPlayback({
      action: 'play_tracks',
      track_ids: favourites.slice(0, 100).map(t => t.track_id),
      offset: Math.min(index, 99)
    })
    if (!result.ok) {
      reportPlaybackProblem(result)
      return
    }
    setTimeout(fetchNowPlaying, 500)
  } catch (e) {
    showToast(UNREACHABLE)
  }
}

const HEART_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.5s-7.5-4.6-9.2-9.4C1.6 7.6 3.9 4 7.5 4c1.9 0 3.4 1 4.5 2.5C13.1 5 14.6 4 16.5 4c3.6 0 5.9 3.6 4.7 7.1-1.7 4.8-9.2 9.4-9.2 9.4z"/></svg>'

function renderFavourites() {
  const count = favourites.length
  document.getElementById('fav-count').textContent =
    count === 1 ? '1 song' : `${count} songs`
  document.getElementById('fav-play-all').hidden = count === 0
  document.getElementById('fav-table').classList.toggle('empty', count === 0)

  favList.innerHTML = ''
  if (!count) {
    const empty = document.createElement('div')
    empty.className = 'grid-empty'
    empty.innerHTML = '<p class="grid-empty-title">No favourites yet.</p>' +
      '<p class="grid-empty-sub">Tap the heart next to a song that\'s playing to save it here.</p>'
    favList.appendChild(empty)
    return
  }

  favourites.forEach((track, index) => {
    // names come from Spotify — textContent only
    const row = document.createElement('div')
    row.className = 'fav-row'
    row.setAttribute('role', 'row')
    if (track.track_id === playerTrackId()) row.classList.add('playing')

    const number = document.createElement('span')
    number.className = 'fav-num'
    number.textContent = index + 1

    const title = document.createElement('button')
    title.type = 'button'
    title.className = 'fav-title'
    title.title = `Play ${track.song}`
    const art = document.createElement('img')
    art.alt = ''
    art.loading = 'lazy'
    if (track.album_art) art.src = track.album_art
    const text = document.createElement('span')
    const song = document.createElement('span')
    song.className = 'fav-song'
    song.textContent = track.song
    const artist = document.createElement('span')
    artist.className = 'fav-artist'
    artist.textContent = track.artist
    text.append(song, artist)
    title.append(art, text)
    title.addEventListener('click', () => playFavourites(index))

    const album = document.createElement('span')
    album.className = 'fav-album'
    album.textContent = track.album || ''

    const lang = document.createElement('span')
    lang.className = 'fav-lang'
    if (track.source_lang) lang.appendChild(langPill(track.source_lang, targetLang))

    const time = document.createElement('span')
    time.className = 'fav-time'
    time.textContent = track.duration_ms ? formatTime(track.duration_ms) : ''

    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'fav-remove'
    remove.title = 'Remove from Favourites'
    remove.setAttribute('aria-label', `Remove ${track.song} from Favourites`)
    remove.innerHTML = HEART_ICON
    remove.addEventListener('click', () => removeFavourite(track))

    row.append(number, title, album, lang, time, remove)
    favList.appendChild(row)
  })
}

// ─────────────────────────────────────────
//  DISCOVER: charts, Home, Search, Explore
// ─────────────────────────────────────────

// The countries Explore offers — must match discover.COUNTRIES on the
// server. [name, language of most of its charts, latitude, longitude]
const COUNTRIES = {
  ar: ['Argentina', 'ES', -34.6, -63.6], au: ['Australia', 'EN', -25.3, 133.8],
  br: ['Brazil', 'PT', -10.8, -52.9], ca: ['Canada', 'EN', 56.1, -106.3],
  cl: ['Chile', 'ES', -35.7, -71.5], co: ['Colombia', 'ES', 4.6, -74.1],
  de: ['Germany', 'DE', 51.2, 10.4], eg: ['Egypt', 'AR', 26.8, 30.8],
  es: ['Spain', 'ES', 40.4, -3.7], fr: ['France', 'FR', 46.6, 2.4],
  gb: ['United Kingdom', 'EN', 54.0, -2.5], gh: ['Ghana', 'EN', 7.9, -1.0],
  gr: ['Greece', 'EL', 39.1, 21.8], hk: ['Hong Kong', 'ZH', 22.3, 114.2],
  id: ['Indonesia', 'ID', -2.5, 118.0], ie: ['Ireland', 'EN', 53.4, -8.2],
  il: ['Israel', 'HE', 31.0, 34.9], in: ['India', 'HI', 22.0, 79.0],
  it: ['Italy', 'IT', 42.8, 12.5], jp: ['Japan', 'JA', 36.2, 138.3],
  ke: ['Kenya', 'SW', 0.0, 37.9], kr: ['South Korea', 'KO', 36.5, 127.9],
  lk: ['Sri Lanka', 'SI', 7.9, 80.8], ma: ['Morocco', 'AR', 31.8, -7.1],
  mx: ['Mexico', 'ES', 23.6, -102.5], my: ['Malaysia', 'MS', 4.2, 102.0],
  ng: ['Nigeria', 'EN', 9.1, 8.7], nl: ['Netherlands', 'NL', 52.1, 5.3],
  np: ['Nepal', 'NE', 28.4, 84.1], nz: ['New Zealand', 'EN', -41.5, 172.8],
  pe: ['Peru', 'ES', -9.2, -75.0], ph: ['Philippines', 'TL', 12.9, 121.8],
  pk: ['Pakistan', 'UR', 30.4, 69.3], pl: ['Poland', 'PL', 51.9, 19.1],
  pt: ['Portugal', 'PT', 39.6, -8.0], ru: ['Russia', 'RU', 55.8, 37.6],
  sa: ['Saudi Arabia', 'AR', 23.9, 45.1], se: ['Sweden', 'SV', 60.1, 18.6],
  th: ['Thailand', 'TH', 15.9, 100.9], tr: ['Turkey', 'TR', 39.0, 35.2],
  tw: ['Taiwan', 'ZH', 23.7, 121.0], ua: ['Ukraine', 'UK', 48.4, 31.2],
  us: ['United States', 'EN', 37.1, -95.7], vn: ['Vietnam', 'VI', 14.1, 108.3],
  za: ['South Africa', 'EN', -30.6, 22.9]
}

// The language tiles: each opens one country's chart. Nine, as in the
// Figma's Browse All — the most common, with search for everything else.
// `native` is the language's own name, in its own script.
const LANGUAGE_TILES = [
  { country: 'fr', title: 'French', lang: 'FR', native: 'Français' },
  { country: 'kr', title: 'K-Pop', lang: 'KO', native: '한국어' },
  { country: 'in', title: 'Bollywood', lang: 'HI', native: 'हिन्दी' },
  { country: 'mx', title: 'Latin', lang: 'ES', native: 'Español' },
  { country: 'ng', title: 'Afrobeats', lang: 'EN', swatch: 'seafoam', native: 'Naijá' },
  { country: 'jp', title: 'J-Pop', lang: 'JA', native: '日本語' },
  { country: 'tw', title: 'C-Pop', lang: 'ZH', native: '中文' },
  { country: 'eg', title: 'Arabic Pop', lang: 'AR', native: 'العربية' },
  { country: 'it', title: 'Italian', lang: 'IT', native: 'Italiano' }
]

// Which chart Top Picks uses for each language you listen to.
const LANGUAGE_COUNTRY = {
  FR: 'fr', HI: 'in', PA: 'in', UR: 'pk', KO: 'kr', ES: 'mx', JA: 'jp', ZH: 'tw',
  AR: 'eg', IT: 'it', PT: 'br', TR: 'tr', ID: 'id', DE: 'de', RU: 'ru', NL: 'nl',
  PL: 'pl', SV: 'se', EL: 'gr', HE: 'il', TH: 'th', VI: 'vn', UK: 'ua', TL: 'ph'
}
const DEFAULT_PICKS = ['FR', 'HI', 'KO', 'ES', 'PA']

// Flags are icons (flag-icons, MIT), not emoji, which render as letters on
// some systems and look out of place on all of them.
function flagIcon(country, className = 'flag-icon') {
  const img = document.createElement('img')
  img.className = className
  img.alt = ''
  img.src = `https://cdn.jsdelivr.net/npm/flag-icons@7.6.0/flags/4x3/${country}.svg`
  return img
}

function setFlag(holderId, country) {
  const holder = document.getElementById(holderId)
  holder.replaceChildren(flagIcon(country))
}

const chartCache = {}

async function fetchChart(country) {
  if (chartCache[country]) return chartCache[country]
  const res = await fetch(`/discover/chart/${country}`)
  if (!res.ok) throw new Error(`chart ${country}: ${res.status}`)
  chartCache[country] = await res.json()
  return chartCache[country]
}

// Chart songs come from Apple: find each on Spotify when it's played.
async function playChartSong(song, country, button) {
  unlockWebPlayer()
  if (button) button.classList.add('busy')
  try {
    const res = await fetch('/discover/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ song: song.song, artist: song.artist, country })
    })
    if (res.status === 404) {
      showToast(`Couldn't find “${song.song}” on Spotify.`)
      return
    }
    if (!res.ok) throw new Error(`match: ${res.status}`)
    const { track_id } = await res.json()
    await playTrack({ track_id })
  } catch (e) {
    showToast(UNREACHABLE)
  } finally {
    if (button) button.classList.remove('busy')
  }
}

// A song row for charts and search results. `onPlay` starts it.
function songRow(song, index, onPlay) {
  const row = document.createElement('button')
  row.type = 'button'
  row.className = 'song-row'
  row.title = `Play ${song.song}`

  const num = document.createElement('span')
  num.className = 'song-row-num'
  num.textContent = index + 1

  const art = document.createElement('img')
  art.className = 'song-row-art'
  art.alt = ''
  art.loading = 'lazy'
  if (song.album_art) art.src = song.album_art

  const text = document.createElement('span')
  text.className = 'song-row-text'
  const title = document.createElement('span')
  title.className = 'song-row-title'
  title.textContent = song.song
  const artist = document.createElement('span')
  artist.className = 'song-row-artist'
  artist.textContent = song.artist
  text.append(title, artist)

  const play = document.createElement('span')
  play.className = 'song-row-play'
  play.innerHTML = PLAY_ICON

  row.append(num, art, text)
  if (song.duration_ms) {
    const time = document.createElement('span')
    time.className = 'song-row-time'
    time.textContent = formatTime(song.duration_ms)
    row.appendChild(time)
  }
  row.appendChild(play)
  row.addEventListener('click', () => onPlay(row))
  return row
}

const RETRY_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/></svg>'

// A quiet note in place of a list: why it's empty, and a way to try again.
function listMessage(list, text, { retry } = {}) {
  list.innerHTML = ''
  const message = document.createElement('div')
  message.className = 'list-message'
  const words = document.createElement('p')
  words.textContent = text
  message.appendChild(words)
  if (retry) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'btn-quiet'
    button.innerHTML = `${RETRY_ICON}<span>Try again</span>`
    button.addEventListener('click', retry)
    message.appendChild(button)
  }
  list.appendChild(message)
}

// Grey placeholders the shape of what's coming, while it loads.
function skeletonRows(list, count) {
  list.innerHTML = ''
  for (let i = 0; i < count; i++) {
    const row = document.createElement('div')
    row.className = 'skeleton-row'
    row.setAttribute('aria-hidden', 'true')
    row.innerHTML = '<span class="skeleton sk-art"></span><span class="sk-lines"><span class="skeleton sk-line"></span><span class="skeleton sk-line short"></span></span>'
    row.style.animationDelay = `${i * 60}ms`
    list.appendChild(row)
  }
}

function skeletonCards(row, count) {
  row.innerHTML = ''
  for (let i = 0; i < count; i++) {
    const card = document.createElement('div')
    card.className = 'skeleton-card'
    card.setAttribute('aria-hidden', 'true')
    card.innerHTML = '<span class="skeleton sk-cover"></span><span class="skeleton sk-line"></span><span class="skeleton sk-line short"></span>'
    row.appendChild(card)
  }
}

async function renderChartInto(list, country, limit) {
  skeletonRows(list, Math.min(limit, 8))
  try {
    const chart = await fetchChart(country)
    list.innerHTML = ''
    chart.songs.slice(0, limit).forEach((song, i) => {
      list.appendChild(songRow(song, i, row => playChartSong(song, country, row)))
    })
    if (!chart.songs.length) listMessage(list, 'No chart for here right now.')
    return chart
  } catch (e) {
    listMessage(list, "Couldn't reach the charts just now.", {
      retry: () => renderChartInto(list, country, limit)
    })
    return null
  }
}

function paintTile(tile, spec) {
  paintColor(tile, spec.swatch ? SWATCHES[spec.swatch] : langColor(spec.lang))
}

function languageTile(spec) {
  const tile = document.createElement('a')
  tile.className = 'lang-tile'
  tile.href = `#/chart/${spec.country}`
  tile.title = `Top songs in ${COUNTRIES[spec.country][0]}`
  paintTile(tile, spec)
  const title = document.createElement('span')
  title.className = 'lang-tile-title'
  title.textContent = spec.title
  const native = document.createElement('span')
  native.className = 'lang-tile-native'
  native.textContent = spec.native
  tile.append(title, native)
  return tile
}

// ── chart page ──
// Each place has a photo (PLACE_PHOTOS, in places.js, from Wikimedia
// Commons and credited as its licence asks). Without one, the hero is the
// language's colour on its own.
function paintPlacePhoto(country, name) {
  const photo = document.getElementById('chart-photo')
  const credit = document.getElementById('chart-credit')
  const place = (window.PLACE_PHOTOS || {})[country]
  photo.hidden = !place
  credit.hidden = !place
  if (!place) {
    photo.removeAttribute('src')
    return
  }
  photo.onerror = () => { photo.hidden = true; credit.hidden = true }
  photo.alt = `${place.caption}, ${name}`
  photo.src = place.src
  credit.href = place.page
  credit.textContent = `Photo: ${place.credit} · ${place.license}`
}

async function loadChartPage(country) {
  const [name, lang] = COUNTRIES[country]
  const tile = LANGUAGE_TILES.find(t => t.country === country)
  paintTile(document.getElementById('chart-hero'), tile || { lang })
  paintPlacePhoto(country, name)
  document.getElementById('chart-title').textContent = tile ? tile.title : name
  document.getElementById('chart-native').textContent = tile ? tile.native : ''
  document.getElementById('chart-native').lang = lang.toLowerCase()
  document.getElementById('chart-subtitle').textContent = `The most played songs in ${name} today`
  renderChartInto(document.getElementById('chart-list'), country, 25)
}

// ── home ──
let homeName = null

// Home says hello in the language you listen to most, with the English
// underneath. [morning, afternoon, evening]
const GREETINGS = {
  FR: ['Bonjour', 'Bon après-midi', 'Bonsoir'],
  ES: ['Buenos días', 'Buenas tardes', 'Buenas noches'],
  IT: ['Buongiorno', 'Buon pomeriggio', 'Buonasera'],
  PT: ['Bom dia', 'Boa tarde', 'Boa noite'],
  DE: ['Guten Morgen', 'Guten Tag', 'Guten Abend'],
  NL: ['Goedemorgen', 'Goedemiddag', 'Goedenavond'],
  SV: ['God morgon', 'God eftermiddag', 'God kväll'],
  PL: ['Dzień dobry', 'Dzień dobry', 'Dobry wieczór'],
  TR: ['Günaydın', 'İyi günler', 'İyi akşamlar'],
  RU: ['Доброе утро', 'Добрый день', 'Добрый вечер'],
  EL: ['Καλημέρα', 'Καλησπέρα', 'Καλησπέρα'],
  HI: ['सुप्रभात', 'नमस्ते', 'शुभ संध्या'],
  PA: ['ਸਤ ਸ੍ਰੀ ਅਕਾਲ', 'ਸਤ ਸ੍ਰੀ ਅਕਾਲ', 'ਸਤ ਸ੍ਰੀ ਅਕਾਲ'],
  UR: ['صبح بخیر', 'السلام علیکم', 'شام بخیر'],
  AR: ['صباح الخير', 'مساء الخير', 'مساء الخير'],
  KO: ['좋은 아침이에요', '안녕하세요', '좋은 저녁이에요'],
  JA: ['おはようございます', 'こんにちは', 'こんばんは'],
  ZH: ['早上好', '下午好', '晚上好'],
  ID: ['Selamat pagi', 'Selamat siang', 'Selamat malam'],
  TH: ['สวัสดีตอนเช้า', 'สวัสดีตอนบ่าย', 'สวัสดีตอนเย็น'],
  VI: ['Chào buổi sáng', 'Chào buổi chiều', 'Chào buổi tối']
}
const DAY_PARTS = ['morning', 'afternoon', 'evening']
let homeLanguage = null     // the language you listen to most

function paintGreeting() {
  const hour = new Date().getHours()
  const part = hour >= 5 && hour < 12 ? 0 : hour >= 12 && hour < 18 ? 1 : 2
  const english = `Good ${DAY_PARTS[part]}`
  const local = GREETINGS[homeLanguage]
  const title = document.getElementById('home-greeting')
  const subtitle = document.getElementById('home-subtitle')

  // <bdi> keeps an Arabic or Urdu greeting from swapping places with the name
  const phrase = document.createElement('bdi')
  phrase.textContent = local ? local[part] : english
  if (local) phrase.lang = homeLanguage.toLowerCase()
  title.replaceChildren(phrase, homeName ? `, ${homeName}` : '')
  subtitle.textContent = local
    ? `${english}, in ${langName(homeLanguage)} — your most-played language`
    : 'Every language has a song.'
}

let homeTilesBuilt = false
let picksLanguage = null

async function loadHome() {
  paintGreeting()
  if (!homeName) {
    userFetch('/me').then(r => r.ok ? r.json() : null).then(me => {
      if (me && me.display_name) {
        homeName = me.display_name.split(' ')[0]
        paintGreeting()
      }
    }).catch(() => {})
  }

  if (!homeTilesBuilt) {
    const row = document.getElementById('home-tiles')
    LANGUAGE_TILES.forEach(spec => row.appendChild(languageTile(spec)))
    homeTilesBuilt = true
  }

  // jump back in: the latest few from Recently Translated
  let languages = []
  try {
    const res = await userFetch('/history?limit=6')
    if (res.ok) {
      const data = await res.json()
      const counts = (data.languages || []).filter(l => l.lang !== 'EN')
      languages = counts.map(l => l.lang)
      homeLanguage = languages.find(lang => GREETINGS[lang]) || null
      paintGreeting()
      const shelf = document.getElementById('home-recent-shelf')
      const grid = document.getElementById('home-recent')
      shelf.hidden = !data.tracks.length
      grid.innerHTML = ''
      data.tracks.forEach(track => grid.appendChild(jumpCard(track)))
      renderPassport(counts)
    }
  } catch (e) { /* the shelves stay hidden */ }

  // top picks: the languages you actually listen to, or a few to start with
  const picks = [...new Set([...languages, ...DEFAULT_PICKS])]
    .filter(lang => LANGUAGE_COUNTRY[lang])
    .slice(0, 5)
  if (!picks.includes(picksLanguage)) picksLanguage = picks[0]
  const chips = document.getElementById('picks-chips')
  chips.innerHTML = ''
  picks.forEach(lang => {
    const chip = document.createElement('button')
    chip.type = 'button'
    chip.className = 'chip lang-chip'
    chip.textContent = langName(lang)
    chip.setAttribute('aria-pressed', String(lang === picksLanguage))
    paintLangPill(chip, lang)
    chip.addEventListener('click', () => {
      picksLanguage = lang
      chips.querySelectorAll('.chip').forEach(c => c.setAttribute('aria-pressed', String(c === chip)))
      renderPicks()
    })
    chips.appendChild(chip)
  })
  renderPicks()
}

function jumpCard(track) {
  const card = document.createElement('button')
  card.type = 'button'
  card.className = 'jump-card'
  card.title = `Play ${track.song}`
  const art = songArt(track)
  art.classList.add('jump-art')
  const text = document.createElement('span')
  text.className = 'jump-text'
  const title = document.createElement('span')
  title.className = 'jump-title'
  title.textContent = track.song
  text.appendChild(title)
  if (track.source_lang) text.appendChild(langPill(track.source_lang, track.target_lang))
  card.append(art, text)
  card.addEventListener('click', () => playTrack(track))
  return card
}

async function renderPicks() {
  const row = document.getElementById('home-picks')
  const country = LANGUAGE_COUNTRY[picksLanguage]
  skeletonCards(row, 6)
  try {
    const chart = await fetchChart(country)
    if (LANGUAGE_COUNTRY[picksLanguage] !== country) return   // chip changed meanwhile
    row.innerHTML = ''
    chart.songs.slice(0, 10).forEach(song => {
      const card = document.createElement('button')
      card.type = 'button'
      card.className = 'pick-card'
      card.title = `Play ${song.song}`
      const art = songArt({ album_art: song.album_art, source_lang: picksLanguage })
      const play = document.createElement('span')
      play.className = 'song-card-play'
      play.innerHTML = PLAY_ICON
      art.appendChild(play)
      const title = document.createElement('span')
      title.className = 'song-card-title'
      title.textContent = song.song
      const artist = document.createElement('span')
      artist.className = 'song-card-artist'
      artist.textContent = song.artist
      card.append(art, title, artist)
      card.addEventListener('click', () => playChartSong(song, country, card))
      row.appendChild(card)
    })
  } catch (e) {
    if (LANGUAGE_COUNTRY[picksLanguage] !== country) return
    listMessage(row, "Couldn't load these picks.", { retry: renderPicks })
  }
}

// ── search ──
let browseBuilt = false
let searchTimer = null
let searchSeq = 0
const searchInput = document.getElementById('search-input')

function openSearch() {
  if (!browseBuilt) {
    const grid = document.getElementById('browse-tiles')
    LANGUAGE_TILES.forEach(spec => grid.appendChild(languageTile(spec)))
    browseBuilt = true
  }
  setTimeout(() => searchInput.focus(), 50)
}

searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(runSearch, 300)
})

async function runSearch() {
  const query = searchInput.value.trim()
  const results = document.getElementById('search-results')
  const list = document.getElementById('search-list')
  document.getElementById('search-browse').hidden = Boolean(query)
  results.hidden = !query
  if (!query) return

  const seq = ++searchSeq   // only the latest search gets to paint
  listMessage(list, 'Searching…')
  try {
    const res = await fetch(`/search?q=${encodeURIComponent(query)}`)
    if (!res.ok) throw new Error(`search: ${res.status}`)
    const { tracks } = await res.json()
    if (seq !== searchSeq) return
    list.innerHTML = ''
    if (!tracks.length) {
      listMessage(list, `Nothing found for “${query}”.`)
      return
    }
    tracks.forEach((track, i) => list.appendChild(songRow(track, i, () => playTrack(track))))
  } catch (e) {
    if (seq === searchSeq) listMessage(list, "Couldn't search right now — try again in a moment.")
  }
}

// ── explore: spin the globe ──
const GLOBE_SCRIPT = 'https://cdn.jsdelivr.net/npm/globe.gl@2.46.2/dist/globe.gl.min.js'
const GLOBE_TEXTURE = 'https://cdn.jsdelivr.net/npm/three-globe@2/example/img/earth-night.jpg'

let globe = null
let globeLoading = null
let exploreCountry = null

function loadGlobeLibrary() {
  if (window.Globe) return Promise.resolve()
  globeLoading = globeLoading || new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = GLOBE_SCRIPT
    script.onload = resolve
    script.onerror = reject
    document.head.appendChild(script)
  })
  return globeLoading
}

function sizeGlobe() {
  if (!globe) return
  const box = document.getElementById('globe')
  globe.width(box.clientWidth).height(box.clientHeight)
}

window.addEventListener('resize', sizeGlobe)

const PIN_ICON = '<svg viewBox="0 0 24 30" aria-hidden="true"><path d="M12 1C6.2 1 1.5 5.6 1.5 11.3 1.5 19 12 29 12 29s10.5-10 10.5-17.7C22.5 5.6 17.8 1 12 1z"/><circle cx="12" cy="11.3" r="3.6"/></svg>'
const pinsByCode = {}

// A flat map pin in the country's language colour, tip on the country.
function pinElement(d) {
  const pin = document.createElement('button')
  pin.type = 'button'
  pin.className = 'globe-pin'
  paintColor(pin, langColor(d.lang))
  pin.title = d.name
  pin.setAttribute('aria-label', `Explore ${d.name}`)
  pin.innerHTML = PIN_ICON
  pin.style.pointerEvents = 'auto'   // the globe's overlay ignores the pointer otherwise
  pin.addEventListener('click', () => flyTo(d.code))
  pinsByCode[d.code] = pin
  return pin
}

async function openExplore() {
  if (globe) {
    sizeGlobe()
    return
  }
  try {
    await loadGlobeLibrary()
  } catch (e) {
    showToast("Couldn't load the globe — check your connection.")
    return
  }
  const pins = Object.entries(COUNTRIES).map(([code, [name, lang, lat, lng]]) =>
    ({ code, name, lang, lat, lng }))

  globe = Globe()(document.getElementById('globe'))
    .backgroundColor('rgba(0,0,0,0)')
    .globeImageUrl(GLOBE_TEXTURE)
    .showAtmosphere(true)
    .atmosphereColor('#1ed760')
    .atmosphereAltitude(0.18)
    .htmlElementsData(pins)
    .htmlLat('lat')
    .htmlLng('lng')
    .htmlAltitude(0.005)
    .htmlElement(pinElement)
  globe.controls().autoRotate = true
  globe.controls().autoRotateSpeed = 0.5
  globe.pointOfView({ lat: 20, lng: 60, altitude: 2.3 })
  sizeGlobe()
}

const LANDED_ALTITUDE = 1.7
let spinning = false

// Clicking a pin: glide over to it.
function flyTo(code) {
  if (spinning) return
  const [, , lat, lng] = COUNTRIES[code]
  globe.controls().autoRotate = false
  globe.pointOfView({ lat, lng, altitude: LANDED_ALTITUDE }, 1400)
  showCountry(code)
}

// The spin: a few full turns, fast and then slowing, settling on the
// country. Its songs appear once it has landed.
function spinTo(code) {
  const [, , lat, lng] = COUNTRIES[code]
  const start = globe.pointOfView()
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
  const turns = reduceMotion ? 0 : 3
  // always travel eastward, through whole turns, ending on the country
  const delta = (((lng - start.lng) % 360) + 360) % 360 + 360 * turns
  const duration = reduceMotion ? 600 : 3600
  const began = performance.now()

  spinning = true
  globe.controls().autoRotate = false
  document.getElementById('spin-btn').disabled = true
  for (const pin of Object.values(pinsByCode)) pin.classList.remove('selected')

  function frame(now) {
    const t = Math.min((now - began) / duration, 1)
    const eased = 1 - Math.pow(1 - t, 4)   // quick off the mark, a long slow settle
    globe.pointOfView({
      lat: start.lat + (lat - start.lat) * eased,
      lng: start.lng + delta * eased,
      altitude: start.altitude + (LANDED_ALTITUDE - start.altitude) * eased
    }, 0)
    if (t < 1) {
      requestAnimationFrame(frame)
      return
    }
    spinning = false
    document.getElementById('spin-btn').disabled = false
    // a last short glide puts it exactly on the country, whatever the
    // turns accumulated along the way
    globe.pointOfView({ lat, lng, altitude: LANDED_ALTITUDE }, 400)
    showCountry(code)
  }
  requestAnimationFrame(frame)
}

function showCountry(code) {
  exploreCountry = code
  const [name, lang] = COUNTRIES[code]
  for (const [c, pin] of Object.entries(pinsByCode)) pin.classList.toggle('selected', c === code)

  document.getElementById('explore-intro').classList.add('docked')
  document.getElementById('view-explore').classList.add('has-panel')
  const panel = document.getElementById('explore-panel')
  panel.hidden = false
  setTimeout(sizeGlobe, 420)   // once the globe has moved over for the panel
  paintTile(panel, { lang })
  setFlag('explore-flag', code)
  document.getElementById('explore-name').textContent = name
  document.getElementById('explore-lang').textContent = 'Most played right now'
  renderChartInto(document.getElementById('explore-list'), code, 15)
}

document.getElementById('spin-btn').addEventListener('click', () => {
  if (!globe || spinning) return
  const codes = Object.keys(COUNTRIES).filter(c => c !== exploreCountry)
  spinTo(codes[Math.floor(Math.random() * codes.length)])
})

// ─────────────────────────────────────────
//  PAGES
// ─────────────────────────────────────────

// Hash routes, so the back button and a refresh keep you on the same page.
// A chart page carries its country: #/chart/fr.
const VIEWS = ['now-playing', 'recent', 'settings', 'favourites', 'home', 'search', 'explore', 'chart']

function currentRoute() {
  const [name, param] = location.hash.replace(/^#\/?/, '').split('/')
  if (name === 'chart' && !(param in COUNTRIES)) return { view: 'home' }
  return VIEWS.includes(name) ? { view: name, param } : { view: 'now-playing' }
}

function currentView() {
  return currentRoute().view
}

function route() {
  const { view, param } = currentRoute()
  for (const name of VIEWS) {
    document.getElementById(`view-${name}`).hidden = name !== view
  }

  // a chart page lights up the nav item it was reached from
  const navView = view === 'chart' ? 'home' : view
  document.querySelectorAll('.nav-link').forEach(link => {
    const active = link.dataset.view === navView
    link.classList.toggle('active', active)
    if (active) link.setAttribute('aria-current', 'page')
    else link.removeAttribute('aria-current')
  })
  document.getElementById('btn-lyrics').classList.toggle('on', view === 'now-playing')

  if (view === 'recent') loadRecent()
  if (view === 'settings') loadSettings()
  if (view === 'favourites') loadFavourites()
  if (view === 'home') loadHome()
  if (view === 'search') openSearch()
  if (view === 'chart') loadChartPage(param)
  if (view === 'explore') openExplore()
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
    const res = await userFetch('/song-requests', {
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

const HISTORY_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-label="Played"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/></svg>'

// Built with textContent rather than an HTML string: song and artist names
// come from Spotify, and a track called <img onerror=...> is legal there.
function buildQueueItem(track, direction, num) {
  const div = document.createElement('div')
  div.className = `queue-item${direction === 'prev' ? ' queue-item-prev' : ''}`

  const number = document.createElement('div')
  number.className = 'queue-num'
  if (direction === 'next') number.textContent = num
  else number.innerHTML = HISTORY_ICON

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

// Language names for chips and labels, by DeepL's base code.
const LANG_NAMES = {
  AR: 'Arabic', BN: 'Bengali', DE: 'German', EL: 'Greek', EN: 'English', ES: 'Spanish',
  FR: 'French', HI: 'Hindi', ID: 'Indonesian', IT: 'Italian', JA: 'Japanese', KO: 'Korean',
  NL: 'Dutch', PA: 'Punjabi', PL: 'Polish', PT: 'Portuguese', RU: 'Russian', SV: 'Swedish',
  TA: 'Tamil', TE: 'Telugu', TH: 'Thai', TR: 'Turkish', UK: 'Ukrainian', UR: 'Urdu',
  VI: 'Vietnamese', ZH: 'Chinese'
}

function langName(code) {
  const base = (code || '').split('-')[0]
  return LANG_NAMES[base] || base
}

const RECENT_PAGE = 24
let recentFilter = null     // a source language, or null for all
let recentShowAll = false

function recentMessage(text, sub) {
  recentList.innerHTML = ''
  const message = document.createElement('div')
  message.className = 'grid-empty'
  const title = document.createElement('p')
  title.className = 'grid-empty-title'
  title.textContent = text
  message.appendChild(title)
  if (sub) {
    const detail = document.createElement('p')
    detail.className = 'grid-empty-sub'
    detail.textContent = sub
    message.appendChild(detail)
  }
  recentList.appendChild(message)
}

function langPill(source, target) {
  const pill = document.createElement('span')
  pill.className = 'lang-pill'
  pill.textContent = `${langLabel(source)} → ${langLabel(target || 'EN')}`
  paintLangPill(pill, source)
  return pill
}

// Artwork, or a tile in the song's language colour when there's none.
function songArt(track) {
  const art = document.createElement('div')
  art.className = 'song-card-art'
  paintLangPill(art, track.source_lang)
  const noArt = () => {
    art.classList.add('no-art')
    art.insertAdjacentHTML('afterbegin', NOTE_ICONS[0])
  }
  if (track.album_art) {
    const img = document.createElement('img')
    img.alt = ''
    img.loading = 'lazy'
    // artwork that won't load falls back to the colour tile, not a blank
    img.addEventListener('error', () => { img.remove(); noArt() }, { once: true })
    img.src = track.album_art
    art.appendChild(img)
  } else {
    noArt()
  }
  return art
}

// Song names come from Spotify, so everything here is textContent.
function buildRecentItem(track) {
  const card = document.createElement('button')
  card.type = 'button'
  card.className = 'song-card'
  if (track.track_id === currentTrackId) card.classList.add('playing')
  card.title = `Play ${track.song}`

  const art = songArt(track)
  const play = document.createElement('span')
  play.className = 'song-card-play'
  play.innerHTML = PLAY_ICON
  art.appendChild(play)

  const title = document.createElement('span')
  title.className = 'song-card-title'
  title.textContent = track.song
  const artist = document.createElement('span')
  artist.className = 'song-card-artist'
  artist.textContent = track.artist

  card.append(art, title, artist)
  if (track.source_lang) card.appendChild(langPill(track.source_lang, track.target_lang))
  card.addEventListener('click', () => playTrack(track))
  return card
}

function renderRecentChips(languages, total) {
  const chips = document.getElementById('recent-chips')
  chips.innerHTML = ''
  if (!languages.length) return
  const all = [{ lang: null, count: total }, ...languages]
  all.forEach(({ lang, count }) => {
    const chip = document.createElement('button')
    chip.type = 'button'
    chip.className = 'chip lang-chip'
    chip.setAttribute('aria-pressed', String(recentFilter === lang))
    chip.textContent = lang ? langName(lang) : 'All'
    const n = document.createElement('span')
    n.className = 'chip-count'
    n.textContent = count
    chip.appendChild(n)
    if (lang) paintLangPill(chip, lang)
    chip.addEventListener('click', () => {
      recentFilter = lang
      recentShowAll = false
      loadRecent()
    })
    chips.appendChild(chip)
  })
}

function renderRecent(tracks) {
  if (!tracks.length) {
    recentMessage('Nothing translated yet.',
      "Play a song in another language and it'll appear here.")
    return
  }
  recentList.innerHTML = ''
  tracks.forEach(track => recentList.appendChild(buildRecentItem(track)))
}

async function playTrack(track) {
  unlockWebPlayer()
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
let recordedTrackId = null

function recordListen(track, sourceLang) {
  recordedTrackId = track.track_id
  userFetch('/history', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      track_id: track.track_id,
      song: track.song,
      artist: track.artist,
      album_art: track.album_art || null,
      source_lang: sourceLang || null,
      target_lang: targetLang
    })
  }).catch(e => console.warn('Recording history failed:', e))
}

async function loadRecent() {
  const params = new URLSearchParams({ limit: recentShowAll ? 200 : RECENT_PAGE })
  if (recentFilter) params.set('lang', recentFilter)
  try {
    const res = await userFetch(`/history?${params}`)
    if (res.status === 401) {
      recentMessage('Connect Spotify to see your listening history.')
      return
    }
    if (res.status === 503) {
      recentMessage("Spotify's busy right now.", 'Your history is safe — give it a few seconds and try again.')
      return
    }
    if (!res.ok) throw new Error(`history: ${res.status}`)
    const data = await res.json()
    const tracks = data.tracks || []
    renderRecentChips(data.languages || [], data.total || 0)
    renderRecent(tracks)

    // how many the current filter holds, to know whether there's more
    const inFilter = recentFilter
      ? ((data.languages || []).find(l => l.lang === recentFilter) || {}).count || 0
      : data.total || 0
    const more = document.getElementById('recent-more')
    more.hidden = recentShowAll || inFilter <= tracks.length
    more.textContent = `Show all ${inFilter} songs`
  } catch (e) {
    console.error('Recently translated error:', e)
    recentMessage("Couldn't load your history.", 'Try again in a moment.')
  }
}

document.getElementById('recent-more').addEventListener('click', () => {
  recentShowAll = true
  loadRecent()
})

// ─────────────────────────────────────────
//  SETTINGS
// ─────────────────────────────────────────

// The languages offered in "Translate into" — DeepL target codes.
const TARGET_CHOICES = [
  ['EN', 'English'], ['AR', 'Arabic'], ['BN', 'Bengali'], ['ZH-HANS', 'Chinese (Simplified)'],
  ['NL', 'Dutch'], ['FR', 'French'], ['DE', 'German'], ['EL', 'Greek'], ['HI', 'Hindi'],
  ['ID', 'Indonesian'], ['IT', 'Italian'], ['JA', 'Japanese'], ['KO', 'Korean'],
  ['PL', 'Polish'], ['PT-BR', 'Portuguese (Brazil)'], ['PA', 'Punjabi'], ['RU', 'Russian'],
  ['ES', 'Spanish'], ['SV', 'Swedish'], ['TA', 'Tamil'], ['TH', 'Thai'], ['TR', 'Turkish'],
  ['UK', 'Ukrainian'], ['UR', 'Urdu'], ['VI', 'Vietnamese']
]

let targetLang = 'EN'
const targetSelect = document.getElementById('target-lang')

TARGET_CHOICES.forEach(([code, name]) => {
  const option = document.createElement('option')
  option.value = code
  option.textContent = name
  targetSelect.appendChild(option)
})

function targetBase() {
  return targetLang.split('-')[0]
}

function targetName() {
  const choice = TARGET_CHOICES.find(([code]) => code === targetLang)
  return choice ? choice[1] : targetLang
}

targetSelect.addEventListener('change', async () => {
  const previous = targetLang
  targetLang = targetSelect.value
  try {
    const res = await userFetch('/prefs', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target_lang: targetLang })
    })
    if (!res.ok) throw new Error(`prefs: ${res.status}`)
    showToast(`Lyrics will now be translated into ${targetName()}`, 3000)
    reloadLyrics()
  } catch (e) {
    targetLang = previous
    targetSelect.value = previous
    showToast("Couldn't save that — try again in a moment.")
  }
})

// Fetch the playing song's lyrics again, e.g. in a new target language.
function reloadLyrics() {
  currentTrackId = null
  prefetchedTrackId = null
  fetchNowPlaying()
}

async function loadSettings() {
  try {
    const res = await userFetch('/me')
    if (!res.ok) throw new Error(`me: ${res.status}`)
    paintProfile(await res.json())
  } catch (e) { /* keeps the generic labels */ }
  refreshHistoryCount()
}

// Settings shows who's signed in: your Spotify picture (or initial), name
// and email, so it's plain which account LyricSync is using.
function paintProfile(me) {
  const name = me.display_name || homeName || 'Spotify user'
  if (me.display_name && !homeName) homeName = me.display_name.split(' ')[0]
  document.getElementById('profile-name').textContent = name
  const avatar = document.getElementById('profile-avatar')
  avatar.replaceChildren()
  if (me.image) {
    const img = document.createElement('img')
    img.src = me.image
    img.alt = ''
    img.referrerPolicy = 'no-referrer'
    img.addEventListener('error', () => { avatar.textContent = initial(name) })
    avatar.appendChild(img)
  } else {
    avatar.textContent = initial(name)
  }
  document.getElementById('settings-email').textContent = me.email
    ? `Signed in as ${me.email}`
    : `Signed in as ${name}`
}

function initial(name) {
  return (Array.from(name.trim())[0] || '?').toUpperCase()
}

async function refreshHistoryCount() {
  try {
    const res = await userFetch('/history?limit=1')
    if (!res.ok) return
    const total = (await res.json()).total
    document.getElementById('settings-history-count').textContent =
      total === 1 ? '1 song in Recently Translated' : `${total} songs in Recently Translated`
  } catch (e) { /* leaves the last count up */ }
}

// Clearing asks twice instead of popping a browser dialog: the first click
// arms the button for a few seconds, the second does it.
let clearArmedUntil = 0
async function clearHistory() {
  const button = document.getElementById('clear-history-btn')
  if (Date.now() > clearArmedUntil) {
    clearArmedUntil = Date.now() + 3000
    button.textContent = 'Click again to clear'
    button.classList.add('armed')
    setTimeout(() => {
      if (Date.now() >= clearArmedUntil) {
        button.textContent = 'Clear'
        button.classList.remove('armed')
      }
    }, 3100)
    return
  }
  clearArmedUntil = 0
  button.textContent = 'Clear'
  button.classList.remove('armed')
  try {
    const res = await userFetch('/history', { method: 'DELETE' })
    if (!res.ok) throw new Error(`history: ${res.status}`)
    showToast('Listening history cleared', 3000)
    refreshHistoryCount()
  } catch (e) {
    showToast("Couldn't clear your history — try again in a moment.")
  }
}

// ─────────────────────────────────────────
//  ONBOARDING
// ─────────────────────────────────────────

// Steps 1–3 introduce LyricSync before signing in; step 4 picks a language
// once signed in, for anyone who hasn't yet.
const ONBOARD_STEPS = {
  1: {
    icon: 'brand',
    title: 'Welcome to LyricSync',
    tagline: 'Music, understood.',
    desc: 'Your music companion with real-time lyric translation. Listen to songs from around the world and understand every word.',
    next: 'Continue'
  },
  2: {
    icon: 'translate',
    title: 'Auto-translate lyrics',
    tagline: 'Break the language barrier',
    desc: "Whatever's playing, LyricSync finds the lyrics, works out the language and translates every line — side by side, in time with the song.",
    panel: 'onboard-demo',
    next: 'Continue',
    back: 'Back'
  },
  3: {
    icon: 'spotify',
    title: 'How LyricSync works',
    tagline: 'Connect your Spotify to get started',
    desc: 'LyricSync follows what you play on Spotify and shows translated lyrics alongside the original.',
    panel: 'onboard-permissions',
    connect: true,
    back: 'Back',
    note: 'Your Spotify password is never shared with us'
  },
  4: {
    icon: 'globe',
    title: 'Choose your language',
    tagline: "You're almost ready",
    desc: 'Pick the language lyrics are translated into. You can change it any time in Settings.',
    panel: 'onboard-language',
    next: 'Enable auto-translate',
    back: 'Skip for now'
  }
}

const ONBOARD_PANELS = ['onboard-demo', 'onboard-permissions', 'onboard-language']

const WELCOME_ICONS = {
  brand: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M21 3 9 5.5v9.06A3.5 3.5 0 1 0 11 18V9.3l8-1.66v5.42A3.5 3.5 0 1 0 21 16z"/></svg>',
  translate: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12.87 15.07l-2.54-2.51.03-.03A17.52 17.52 0 0 0 14.07 6H17V4h-7V2H8v2H1v1.99h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7 1.62-4.33L19.12 17h-3.24z"/></svg>',
  spotify: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm4.59 14.42a.62.62 0 0 1-.86.21c-2.35-1.44-5.3-1.76-8.79-.96a.62.62 0 1 1-.28-1.22c3.81-.87 7.08-.5 9.72 1.12.29.18.39.56.21.85zm1.22-2.72a.78.78 0 0 1-1.07.26c-2.69-1.65-6.79-2.13-9.97-1.17a.78.78 0 1 1-.45-1.49c3.63-1.1 8.15-.57 11.23 1.33.37.23.48.71.26 1.07zm.11-2.83C14.69 8.95 9.38 8.77 6.3 9.71a.94.94 0 1 1-.54-1.79c3.53-1.07 9.4-.87 13.11 1.34a.94.94 0 0 1-.96 1.61z"/></svg>',
  globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9.5"/><path d="M2.5 12h19M12 2.5c2.6 2.6 3.9 5.8 3.9 9.5s-1.3 6.9-3.9 9.5c-2.6-2.6-3.9-5.8-3.9-9.5s1.3-6.9 3.9-9.5z"/></svg>'
}

let onboardStep = 1
let onboardingOpen = false    // step 4 is up; the welcome screen stays until it's done

function setWelcomeIcon(name) {
  document.getElementById('welcome-icon').innerHTML = WELCOME_ICONS[name]
}

function setWelcomeNote(text, link) {
  const note = document.getElementById('welcome-note')
  note.textContent = text
  if (link) {
    const a = document.createElement('a')
    a.href = link.href
    a.textContent = link.label
    note.append(' ', a)
  }
}

function renderOnboardingStep(step) {
  const config = ONBOARD_STEPS[step]
  setWelcomeIcon(config.icon)
  setWelcomeText(config.title, config.tagline, config.desc)

  const progress = document.getElementById('onboard-progress')
  progress.hidden = false
  ;[...progress.children].forEach((dot, i) => dot.classList.toggle('active', i + 1 === step))

  for (const id of ONBOARD_PANELS) document.getElementById(id).hidden = id !== config.panel

  const next = document.getElementById('onboard-next')
  next.hidden = !config.next
  next.textContent = config.next || ''
  const back = document.getElementById('onboard-back')
  back.hidden = !config.back
  back.textContent = config.back || ''
  welcomeLoginBtn.classList.toggle('hidden', !config.connect)

  if (step === 1) {
    setWelcomeNote('Already set up?', { href: '/login', label: 'Connect with Spotify' })
  } else {
    setWelcomeNote(config.note || '')
  }
}

function goToStep(step) {
  onboardStep = step
  renderOnboardingStep(step)
}

document.getElementById('onboard-next').addEventListener('click', () => {
  if (onboardingOpen) finishOnboarding(true)
  else goToStep(Math.min(onboardStep + 1, 3))
})

document.getElementById('onboard-back').addEventListener('click', () => {
  if (onboardingOpen) finishOnboarding(false)
  else goToStep(Math.max(onboardStep - 1, 1))
})

// step 2's demo: the lines take turns, the way lyrics do
const demoLines = document.querySelectorAll('.demo-line')
demoLines.forEach(line => paintLangPill(line.querySelector('.lang-pill'), line.dataset.lang))
let demoIndex = 0
demoLines[0].classList.add('active')
setInterval(() => {
  if (document.getElementById('onboard-demo').hidden) return
  demoLines[demoIndex].classList.remove('active')
  demoIndex = (demoIndex + 1) % demoLines.length
  demoLines[demoIndex].classList.add('active')
}, 2400)

const onboardTarget = document.getElementById('onboard-target')
TARGET_CHOICES.forEach(([code, name]) => {
  const option = document.createElement('option')
  option.value = code
  option.textContent = name
  onboardTarget.appendChild(option)
})

function openLanguageStep() {
  onboardingOpen = true
  onboardTarget.value = targetLang
  showWelcomeScreen()
}

// Enable saves the language and turns translation on; Skip just stops
// asking. Either way the welcome screen goes and the player comes back.
async function finishOnboarding(enable) {
  const changes = { onboarded: true }
  if (enable) {
    changes.target_lang = onboardTarget.value
    changes.auto_translate = true
  }
  try {
    const res = await userFetch('/prefs', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(changes)
    })
    if (!res.ok) throw new Error(`prefs: ${res.status}`)
  } catch (e) {
    showToast("Couldn't save that — try again in a moment.")
    return
  }

  onboardingOpen = false
  if (enable) {
    applyTranslationEnabled(true)
    if (changes.target_lang !== targetLang) {
      targetLang = changes.target_lang
      targetSelect.value = targetLang
      reloadLyrics()
    }
  }
  if (lastKnownData) {
    hideWelcomeScreen(restorePlayerView)
  } else {
    showWelcomeScreen()   // nothing playing yet: "you're connected"
  }
}

async function disconnectSpotify() {
  try {
    await fetch('/logout', { method: 'POST' })
  } catch(e) {}
  location.hash = '#/now-playing'
  signedOut()
}

// Back to the connect screen with nothing of the old session left behind —
// after Disconnect, or when the server says the session has gone.
function signedOut() {
  isLoggedIn = false
  setAccent(null)
  stopWebPlayer()
  accessProblem = null
  libraryItems = []
  libraryList.innerHTML = ''
  favourites = []
  currentTrackId = null
  currentTrackData = null
  localRecent = []
  currentLyrics = []
  currentLyricsSynced = false
  currentLineIndex = -1
  lastKnownData = null
  isPlaying = false
  knownLanguages = null
  forgetLastSong()
  document.title = 'LyricSync'
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

    const url = `/translate?song=${encodeURIComponent(next.song)}&artist=${encodeURIComponent(next.artist)}&track_id=${encodeURIComponent(next.track_id)}&target_lang=${encodeURIComponent(targetLang)}`
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
  showWelcomeMessage(problem.title, '', problem.desc, problem.canReconnect)
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

// Bring the player back once the welcome screen goes, with whichever panel
// was showing before it came up.
function restorePlayerView() {
  topBar.style.display = 'flex'
  bottomBar.style.display = 'flex'
  if (currentContentState === 'lyrics') {
    lyricsContainer.style.display = 'block'
    stateScreen.style.display = 'none'
    recentreLyrics()
  } else if (currentContentState) {
    // loading / no-lyrics / english — stateScreen was showing
    stateScreen.style.display = 'flex'
    lyricsContainer.style.display = 'none'
  }
}

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
      loadKnownLanguages()
      loadFavourites()
      startWebPlayer()
      loadLibrary()
      showBars()
      fetchContext()
    }

    let data = await response.json()
    // with no active device Spotify answers "nothing playing" (204)
    spotifyHasDevice = Boolean(data.playing && data.device && data.device.id)

    if (data.song) {
      lastSeenSongAt = Date.now()
      rememberLastSong(data)
    } else if (!lastKnownData) {
      // Spotify forgets a song left paused for a few minutes. If this tab
      // was reloaded meanwhile (a browser unloads background tabs), pick up
      // the song from before rather than starting over.
      const saved = savedLastSong()
      if (saved) {
        data = { ...saved.data, is_playing: false, device: null }
        lastSeenSongAt = saved.savedAt
      }
    }

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

      // Paused, the song stays up — play carries on from here, even once
      // Spotify itself has let go of it. Only after an hour of nothing does
      // LyricSync go back to the welcome screen.
      const idleTooLong = Date.now() - lastSeenSongAt > PAUSED_KEEP_MS
      if ((!lastKnownData || idleTooLong) && !data.song) {
        if (welcomeScreen.style.display === 'none') showWelcomeScreen()
        return
      }

      // a song we haven't shown yet (just opened, paused): load its lyrics
      // too, and put it on screen in place of the welcome
      if (!data.song || data.track_id === currentTrackId) return
      progressMs = data.progress_ms
      durationMs = data.duration_ms
      lastServerSync = Date.now()
      if (!onboardingOpen && !welcomeScreen.classList.contains('hidden')
          && welcomeScreen.style.display !== 'none') {
        hideWelcomeScreen(restorePlayerView)
      }
    } else {

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
      if (!onboardingOpen && !welcomeScreen.classList.contains('hidden')
          && welcomeScreen.style.display !== 'none') {
        hideWelcomeScreen(restorePlayerView)
      }

      // same track — just sync line
      if (data.track_id === currentTrackId) {
        if (recordedTrackId !== currentTrackId && translationEnabled
            && currentContentState === 'lyrics') {
          recordListen(data, dominantLanguage(currentLyrics))
          celebrateIfNew(dominantLanguage(currentLyrics))
        }
        syncActiveLine(progressMs)
        return
      }
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
    loadTimingNudge(data.track_id)
    prefetchNextTrack()         // immediately prefetch next-in-queue in case of skip
    refreshContextSoon()        // don't make the sidebar wait for the 10s poll

    showContent('message', {
      title: 'Loading lyrics...',
      subtitle: `Fetching translation for ${data.song}`
    })

    let translateData
    try {
      const translateRes = await fetch(
        `/translate?song=${encodeURIComponent(data.song)}&artist=${encodeURIComponent(data.artist)}&track_id=${encodeURIComponent(data.track_id)}&target_lang=${encodeURIComponent(targetLang)}`
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
      setAccent(null)
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
      setAccent(null)
      currentLyrics = []
      currentContentState = 'english'
      showContent('message', {
        title: `Already in ${targetName()}`,
        subtitle: 'No translation needed for this one — just enjoy it.'
      })
      return
    }

    const lang = dominantLanguage(currentLyrics)
    setAccent(lang || null)
    if (lang) {
      langBadge.textContent = `${langLabel(lang)} → ${langLabel(targetLang)}`
      paintLangPill(langBadge, lang)
      langBadge.style.display = 'block'
      if (currentTrackId) translation_cache_js[currentTrackId] = `${lang} → EN`
    }

    renderLyrics(currentLyrics)
    // a song opened paused goes in once it's actually played
    if (translationEnabled && isPlaying) {
      recordListen(data, lang)
      celebrateIfNew(lang)
    }
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
//  PASSPORT, FIRST-SONG CELEBRATIONS, SHORTCUTS
// ─────────────────────────────────────────

// Each language's name for itself, for passport stamps and celebrations.
const LANG_NATIVE = {
  AR: 'العربية', BN: 'বাংলা', DE: 'Deutsch', EL: 'Ελληνικά', EN: 'English', ES: 'Español',
  FA: 'فارسی', FR: 'Français', HE: 'עברית', HI: 'हिन्दी', ID: 'Bahasa Indonesia',
  IT: 'Italiano', JA: '日本語', KO: '한국어', NL: 'Nederlands', PA: 'ਪੰਜਾਬੀ', PL: 'Polski',
  PT: 'Português', RU: 'Русский', SV: 'Svenska', TA: 'தமிழ்', TE: 'తెలుగు', TH: 'ไทย',
  TR: 'Türkçe', UK: 'Українська', UR: 'اردو', VI: 'Tiếng Việt', ZH: '中文'
}

function nativeName(code) {
  const base = (code || '').split('-')[0]
  return LANG_NATIVE[base] || langName(base)
}

// The passport: a stamp for every language you've listened in, most played
// first. A stamp opens Recently Translated filtered to that language.
function renderPassport(counts) {
  const shelf = document.getElementById('passport-shelf')
  const passport = document.getElementById('passport')
  shelf.hidden = !counts.length
  passport.innerHTML = ''
  document.getElementById('passport-count').textContent =
    counts.length === 1 ? '1 language' : `${counts.length} languages`
  counts.forEach(({ lang, count }, i) => {
    const stamp = document.createElement('a')
    stamp.className = 'stamp'
    stamp.href = '#/recent'
    stamp.style.setProperty('--tilt', `${[-3, 2, -1.5, 3, -2.5, 1][i % 6]}deg`)
    paintColor(stamp, langColor(lang))
    const native = document.createElement('bdi')
    native.className = 'stamp-native'
    native.lang = lang.toLowerCase()
    native.textContent = nativeName(lang)
    const name = document.createElement('span')
    name.className = 'stamp-name'
    name.textContent = langName(lang)
    const songs = document.createElement('span')
    songs.className = 'stamp-count'
    songs.textContent = count === 1 ? '1 song' : `${count} songs`
    stamp.append(native, name, songs)
    stamp.addEventListener('click', () => { recentFilter = lang })
    passport.appendChild(stamp)
  })
}

// The first time you hear a language, LyricSync makes a small fuss.
let knownLanguages = null   // languages already in your history

async function loadKnownLanguages() {
  try {
    const res = await userFetch('/history?limit=1')
    if (!res.ok) return
    const data = await res.json()
    knownLanguages = new Set((data.languages || []).map(l => l.lang))
  } catch (e) { /* no fuss this visit */ }
}

function celebrateIfNew(lang) {
  if (!lang || lang === 'EN' || !knownLanguages || knownLanguages.has(lang)) return
  knownLanguages.add(lang)
  celebrate(lang)
}

const CONFETTI_SHAPES = ['dot', 'bar', 'ring', 'note']
const NOTE_PATH = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v10.6A4 4 0 1 0 14 17V7h4V3z"/></svg>'

function celebrate(lang) {
  document.getElementById('celebration')?.remove()
  const color = langColor(lang)
  const holder = document.createElement('div')
  holder.id = 'celebration'
  holder.setAttribute('role', 'status')

  const card = document.createElement('div')
  card.className = 'celebration-card'
  paintColor(card, color)
  const eyebrow = document.createElement('span')
  eyebrow.className = 'celebration-eyebrow'
  eyebrow.textContent = 'Your first song in'
  const native = document.createElement('bdi')
  native.className = 'celebration-native'
  native.lang = lang.toLowerCase()
  native.textContent = nativeName(lang)
  const note = document.createElement('span')
  note.className = 'celebration-note'
  note.textContent = `${langName(lang)} — stamped in your passport`
  card.append(eyebrow, native, note)
  holder.appendChild(card)

  // a burst of the palette, not just this language's colour
  const colours = Object.values(SWATCHES)
  for (let i = 0; i < 34; i++) {
    const bit = document.createElement('span')
    const shape = CONFETTI_SHAPES[i % CONFETTI_SHAPES.length]
    bit.className = `confetti ${shape}`
    if (shape === 'note') bit.innerHTML = NOTE_PATH
    const angle = (i / 34) * Math.PI * 2 + Math.random() * 0.4
    const distance = 140 + Math.random() * 160
    bit.style.setProperty('--dx', `${Math.cos(angle) * distance}px`)
    bit.style.setProperty('--dy', `${Math.sin(angle) * distance * 0.7 + 60}px`)
    bit.style.setProperty('--spin', `${Math.round(Math.random() * 540 - 270)}deg`)
    bit.style.setProperty('--c', colours[i % colours.length])
    bit.style.animationDelay = `${Math.random() * 120}ms`
    holder.appendChild(bit)
  }

  const dismiss = () => {
    holder.classList.add('leaving')
    setTimeout(() => holder.remove(), 400)
  }
  holder.addEventListener('click', dismiss)
  setTimeout(dismiss, 5200)
  document.body.appendChild(holder)
}

// ── keyboard shortcuts ──
// Only when you're not typing, and never over the browser's own shortcuts.
document.addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return
  const target = e.target instanceof Element ? e.target : document.body
  if (target.closest('input, textarea, select, [contenteditable="true"]')) return
  if (!isLoggedIn) return

  // space on a focused button presses that button, as it should
  const onControl = target.closest('button, a, [role="switch"]')
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key

  if (key === ' ' && !onControl) {
    e.preventDefault()
    togglePlayPause()
  } else if (key === 'ArrowRight' && !target.closest('#globe')) {
    e.preventDefault()
    sendPlayback('next')
  } else if (key === 'ArrowLeft' && !target.closest('#globe')) {
    e.preventDefault()
    sendPlayback('previous')
  } else if (key === 'l' && currentTrackId) {
    toggleFavourite()
  } else if (key === 't') {
    toggleTranslation()
    showToast(translationEnabled ? 'Translations on' : 'Translations off', 1600)
  } else if (key === '[' || key === ']') {
    nudgeTiming(key === ']' ? 1 : -1)
  } else if (key === '/') {
    e.preventDefault()
    if (location.hash === '#/search') searchInput.focus()
    else location.hash = '#/search'
  }
})

// ─────────────────────────────────────────
//  KICK OFF
// ─────────────────────────────────────────

route()

// Show welcome (login mode) immediately — fetchNowPlaying will replace it
showWelcomeScreen()

// Spotify rate-limits each app, and every poll counts against it. Ask
// often while a song plays in front of you, less while paused or in a
// background tab, and catch up the moment you come back.
const POLL_EVERY_MS = { playing: 5000, paused: 15000, hidden: 30000 }
const CONTEXT_EVERY_MS = { playing: 10000, paused: 60000, hidden: 120000 }
let lastPollAt = 0
let lastContextAt = 0

function pollMode() {
  if (document.hidden) return 'hidden'
  return isPlaying ? 'playing' : 'paused'
}

function pollSpotify() {
  const now = Date.now()
  if (now - lastPollAt >= POLL_EVERY_MS[pollMode()] - 250) {
    lastPollAt = now
    fetchNowPlaying()
  }
  if (now - lastContextAt >= CONTEXT_EVERY_MS[pollMode()] - 250) {
    lastContextAt = now
    fetchContext()
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) return
  lastPollAt = 0
  lastContextAt = 0
  pollSpotify()
})

lastPollAt = Date.now()
fetchNowPlaying()
setInterval(pollSpotify, 1000)
setInterval(tickProgress, TICK_MS)