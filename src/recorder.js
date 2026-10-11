// Records audio from the microphone. Starts on call, stops when stop() is called or when the system
// ends the recording itself (for example, the microphone is taken away). Never assumes a format.

// Returns { stop, finished }.
//  - stop() ends the recording.
//  - finished resolves with the recorded Blob (or null if nothing was recorded) once recording has ended
//    for any reason, so the caller can save it either way.
// Throws if the microphone is refused or recording is not supported.
export async function startRecording() {
  if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    throw new Error('Recording is not supported here')
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  const recorder = new MediaRecorder(stream) // no format forced: the browser picks the one it supports
  const chunks = []

  recorder.ondataavailable = (event) => {
    if (event.data.size) chunks.push(event.data)
  }

  const finished = new Promise((resolve) => {
    recorder.onstop = () => {
      stream.getTracks().forEach((track) => track.stop()) // turns the microphone indicator off
      // On iOS, recorder.mimeType is empty at the start; the real format is on the recorded data.
      const type = chunks[0]?.type || recorder.mimeType || ''
      resolve(chunks.length ? new Blob(chunks, { type }) : null)
    }
  })

  const stop = () => {
    if (recorder.state !== 'inactive') recorder.stop()
  }
  // If the system ends the microphone, stop and keep what was recorded so far.
  stream.getAudioTracks().forEach((track) => {
    track.onended = stop
  })

  recorder.start(1000) // a chunk every second, so a long recording is not one big piece at the end
  return { stop, finished }
}
