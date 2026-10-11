// THROWAWAY test session (M1 step 1). Delete this file, and its two lines in main.js,
// once the answers are logged in CLAUDE.md under "Test results".

const LOG_KEY = 'ari-spike-log'
const LOG_MAX = 80

let logEl

// Write a timestamped line on the page and keep it in localStorage, so the log
// survives if iOS closes the app (for example during the lock-screen test).
function log(message) {
  const line = `${new Date().toLocaleTimeString()}  ${message}`
  logEl.textContent += line + '\n'
  logEl.scrollTop = logEl.scrollHeight
  try {
    const lines = JSON.parse(localStorage.getItem(LOG_KEY) || '[]')
    lines.push(line)
    localStorage.setItem(LOG_KEY, JSON.stringify(lines.slice(-LOG_MAX)))
  } catch {
    // storage unavailable: the on-page log still works
  }
}

function loadSavedLog() {
  try {
    const lines = JSON.parse(localStorage.getItem(LOG_KEY) || '[]')
    if (lines.length) logEl.textContent = lines.join('\n') + '\n--- app (re)started ---\n'
  } catch {
    // ignore
  }
}

// ---- a. Share a file to OneDrive through the iOS share sheet ----

async function shareFile(file) {
  if (!navigator.canShare || !navigator.canShare({ files: [file] })) {
    log(`share: this browser says it cannot share ${file.name} (${file.type})`)
    return
  }
  try {
    await navigator.share({ files: [file], title: 'ARI test file' })
    log(`share: sheet closed without error (${file.name}, ${file.size} bytes)`)
  } catch (error) {
    // AbortError means you cancelled the sheet; anything else is a real failure
    log(`share: ${error.name}: ${error.message}`)
  }
}

function testShare() {
  const text = `ARI share test\nmade ${new Date().toISOString()}\n${navigator.userAgent}\n`
  shareFile(new File([text], 'ari-share-test.txt', { type: 'text/plain' }))
}

// ---- b. Location permission ----

async function showPermissionState() {
  if (!navigator.permissions) {
    log('permissions: Permissions API not available here')
    return
  }
  for (const name of ['geolocation', 'microphone']) {
    try {
      const status = await navigator.permissions.query({ name })
      log(`permission at launch: ${name} = ${status.state}`)
      status.onchange = () => log(`permission changed: ${name} = ${status.state}`)
    } catch (error) {
      log(`permission query for ${name} failed: ${error.name}`)
    }
  }
}

function testLocation() {
  log('location: asking...')
  const askedAt = Date.now()
  const seconds = () => ((Date.now() - askedAt) / 1000).toFixed(1)
  navigator.geolocation.getCurrentPosition(
    (position) => {
      const { latitude, longitude, accuracy } = position.coords
      log(`location: ${latitude.toFixed(5)}, ${longitude.toFixed(5)}, accuracy ${Math.round(accuracy)} m, arrived after ${seconds()} s`)
    },
    (error) => log(`location: error code ${error.code}: ${error.message} (after ${seconds()} s)`), // 1 denied, 2 unavailable, 3 timeout
    { enableHighAccuracy: true, timeout: 20000 },
  )
}

// ---- c. Record audio ----

let recorder
let stream
let chunks = []
let startedAt
let ticker

const elapsed = () => ((Date.now() - startedAt) / 1000).toFixed(1)

async function startRecording(ui) {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  } catch (error) {
    log(`record: microphone refused: ${error.name}: ${error.message}`)
    return
  }
  chunks = []
  ui.result.hidden = true
  recorder = new MediaRecorder(stream) // no format forced: we want to see what iOS picks
  log(`record: recorder.mimeType = "${recorder.mimeType}"`)

  recorder.ondataavailable = (event) => {
    if (event.data.size) chunks.push(event.data)
    log(`record: chunk ${event.data.size} bytes at ${elapsed()} s`)
  }
  recorder.onerror = (event) => log(`record: recorder error: ${event.error?.name}`)
  recorder.onpause = () => log('record: recorder paused (by the system?)')
  recorder.onresume = () => log('record: recorder resumed')
  stream.getAudioTracks().forEach((track) => {
    track.onmute = () => log('record: audio track muted (system took the mic?)')
    track.onunmute = () => log('record: audio track unmuted')
    track.onended = () => log('record: audio track ended')
  })
  recorder.onstop = () => finishRecording(ui)

  startedAt = Date.now()
  recorder.start(1000) // one chunk per second, so a gap in the log shows when recording stopped
  ui.record.textContent = 'Stop recording'
  ticker = setInterval(() => {
    ui.record.textContent = `Stop recording (${elapsed()} s)`
  }, 200)
}

function stopRecording() {
  clearInterval(ticker)
  if (recorder && recorder.state !== 'inactive') recorder.stop()
  stream?.getTracks().forEach((track) => track.stop())
}

function finishRecording(ui) {
  const type = chunks[0]?.type || recorder.mimeType
  const blob = new Blob(chunks, { type })
  const wallClock = elapsed()
  log(`record: stopped. ${chunks.length} chunks, ${blob.size} bytes, type "${type}", wall clock ${wallClock} s`)

  const extension = type.includes('mp4') ? 'm4a' : type.includes('webm') ? 'webm' : type.includes('ogg') ? 'ogg' : 'audio'
  const file = new File([blob], `ari-audio-test.${extension}`, { type })

  ui.audio.src = URL.createObjectURL(blob)
  ui.audio.onloadedmetadata = () => log(`record: playback says duration ${ui.audio.duration} s`)
  ui.shareAudio.onclick = () => shareFile(file)
  ui.result.hidden = false
  ui.record.textContent = 'Start recording'
}

// ---- d. Dictation text box ----

const NOTE_KEY = 'ari-spike-note'

// The box is plain on purpose: the iPhone keyboard's own dictation (microphone) key types into it.
// Every change is saved at once, so closing the app and reopening it shows whether the text survived.
function setUpNoteBox(box) {
  try {
    const saved = localStorage.getItem(NOTE_KEY)
    if (saved) {
      box.value = saved
      log(`note: restored ${saved.length} characters from the last session`)
    } else {
      log('note: nothing saved from an earlier session')
    }
  } catch {
    log('note: localStorage unavailable')
  }
  box.addEventListener('input', () => {
    try {
      localStorage.setItem(NOTE_KEY, box.value)
    } catch {
      // the log line below still tells you the box changed
    }
    log(`note: ${box.value.length} characters`)
  })
}

async function copyLog() {
  try {
    await navigator.clipboard.writeText(logEl.textContent)
    log('copy: log copied to the clipboard')
  } catch (error) {
    // Older route: select the text in a temporary box and use the legacy copy command
    const box = document.createElement('textarea')
    box.value = logEl.textContent
    document.body.appendChild(box)
    box.select()
    const worked = document.execCommand('copy')
    box.remove()
    log(worked ? 'copy: log copied (fallback route)' : `copy: failed: ${error.name}: ${error.message}`)
  }
}

// Show what the browser says it can record, before we try
function logSupportedFormats() {
  if (typeof MediaRecorder === 'undefined') {
    log('record: MediaRecorder not available')
    return
  }
  const candidates = ['audio/mp4', 'audio/webm', 'audio/webm;codecs=opus', 'audio/ogg', 'audio/wav']
  log('record: isTypeSupported -> ' + candidates.map((t) => `${t}=${MediaRecorder.isTypeSupported(t)}`).join(', '))
}

// Log when the page is hidden/shown: this is what a screen lock looks like to the page
document.addEventListener('visibilitychange', () => {
  if (logEl) log(`page is now ${document.visibilityState}`)
})

export function mountSpike(parent) {
  parent.insertAdjacentHTML(
    'beforeend',
    `
    <section class="spike">
      <h2>Test session</h2>
      <button id="spike-share">a. Share test file</button>
      <button id="spike-location">b. Get my location</button>
      <button id="spike-record">c. Start recording</button>
      <div id="spike-result" hidden>
        <audio id="spike-audio" controls></audio>
        <button id="spike-share-audio">Share the recording</button>
      </div>
      <label for="spike-note">d. Dictation box (use the keyboard's microphone key)</label>
      <textarea id="spike-note" rows="5"></textarea>
      <pre id="spike-log"></pre>
      <button id="spike-copy" class="small">Copy log</button>
      <button id="spike-clear" class="small">Clear log</button>
    </section>
  `,
  )

  logEl = parent.querySelector('#spike-log')
  const ui = {
    record: parent.querySelector('#spike-record'),
    result: parent.querySelector('#spike-result'),
    audio: parent.querySelector('#spike-audio'),
    shareAudio: parent.querySelector('#spike-share-audio'),
  }

  parent.querySelector('#spike-share').onclick = testShare
  parent.querySelector('#spike-location').onclick = testLocation
  ui.record.onclick = () => (recorder && recorder.state === 'recording' ? stopRecording() : startRecording(ui))
  parent.querySelector('#spike-copy').onclick = copyLog
  parent.querySelector('#spike-clear').onclick = () => {
    logEl.textContent = ''
    try {
      localStorage.removeItem(LOG_KEY)
    } catch {
      // ignore
    }
  }

  loadSavedLog()
  log(`launch: ${navigator.standalone || matchMedia('(display-mode: standalone)').matches ? 'installed app' : 'browser'}`)
  setUpNoteBox(parent.querySelector('#spike-note'))
  showPermissionState()
  logSupportedFormats()
}
