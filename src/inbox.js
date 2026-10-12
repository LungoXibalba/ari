// The capture screen: write a text note, take a photo or record a voice memo, see the inbox, edit captures,
// move them to the trash and take them back out.

import { describeLocation, newCapture } from './captures.js'
import { buildEditForm } from './edit-form.js'
import { formatBytes } from './format.js'
import { getLocation } from './location.js'
import { shrinkPhoto } from './photo.js'
import { startRecording } from './recorder.js'
import { attachLocationEnabled, setAttachLocationEnabled } from './settings.js'
import {
  getMedia,
  listCaptures,
  restoreCapture,
  saveCapture,
  saveCaptureWithMedia,
  trashCapture,
  updateCapture,
} from './storage.js'

const KIND_NAMES = { text: 'Note', photo: 'Photo', audio: 'Voice memo' }

export function mountInbox(parent) {
  parent.innerHTML = `
    <section class="capture">
      <label for="note">New note</label>
      <textarea id="note" rows="4"></textarea>
      <label class="switch"><input id="location-switch" type="checkbox" /> Attach location when saving</label>
      <button id="save">Save note</button>
      <button id="photo">Take photo</button>
      <button id="record">Record voice memo</button>
      <input id="photo-input" type="file" accept="image/*" capture="environment" hidden />
      <p id="message" role="status"></p>
      <p id="notice" role="alert" hidden></p>
    </section>
    <section>
      <h2>Inbox <span id="count"></span></h2>
      <ul id="captures"></ul>
    </section>
    <details id="trash">
      <summary>Trash <span id="trash-count"></span></summary>
      <p>Moved here instead of being deleted. Restore brings a capture back to the inbox.</p>
      <ul id="trashed"></ul>
    </details>
  `

  const note = parent.querySelector('#note')
  const locationSwitch = parent.querySelector('#location-switch')
  const photoInput = parent.querySelector('#photo-input')
  const recordButton = parent.querySelector('#record')
  const message = parent.querySelector('#message')
  const notice = parent.querySelector('#notice')
  const count = parent.querySelector('#count')
  const list = parent.querySelector('#captures')
  const trashCount = parent.querySelector('#trash-count')
  const trashList = parent.querySelector('#trashed')

  locationSwitch.checked = attachLocationEnabled()
  locationSwitch.onchange = () => setAttachLocationEnabled(locationSwitch.checked)

  let mediaUrls = [] // object URLs for the photos and recordings on screen; released on the next render
  let renderCount = 0
  let editing = null // { id, node } while a capture's Edit form is open

  // The normal view of one capture.
  function buildCaptureItem(capture, blob) {
    const item = document.createElement('li')

    const time = document.createElement('time')
    time.dateTime = capture.created
    time.textContent = new Date(capture.created).toLocaleString()
    item.append(time)

    // textContent, never innerHTML: everything typed is user data and must not be read as page code
    if (capture.title) {
      const title = document.createElement('p')
      title.className = 'title'
      title.textContent = capture.title
      item.append(title)
    }

    if (blob) {
      const url = URL.createObjectURL(blob)
      mediaUrls.push(url)
      if (capture.kind === 'photo') {
        const image = document.createElement('img')
        image.src = url
        image.alt = 'Photo'
        item.append(image)
      } else if (capture.kind === 'audio') {
        const audio = document.createElement('audio')
        audio.controls = true
        audio.preload = 'metadata'
        audio.src = url
        item.append(audio)
      }
    }

    if (capture.text) {
      const text = document.createElement('p')
      text.textContent = capture.text
      item.append(text)
    }

    const where = document.createElement('p')
    where.className = 'where'
    const parts = [capture.place, capture.location && describeLocation(capture.location)].filter(Boolean)
    where.textContent = parts.length ? parts.join(' · ') : 'No location'
    item.append(where)

    if (capture.media && !blob) {
      const missing = document.createElement('p')
      missing.className = 'where'
      missing.textContent = 'The photo or recording file is missing. Import this capture again with its file selected.'
      item.append(missing)
    }

    if (capture.source) {
      const source = document.createElement('p')
      source.className = 'where'
      source.textContent = `Source: ${capture.source}`
      item.append(source)
    }

    const edit = document.createElement('button')
    edit.textContent = 'Edit'
    edit.className = 'small'
    edit.onclick = () => startEdit(capture, item)

    const remove = document.createElement('button')
    remove.textContent = 'Move to trash'
    remove.className = 'small'
    remove.onclick = async () => {
      await trashCapture(capture.id)
      message.textContent = 'Moved to the trash. Restore it from Trash below.'
      await render()
    }
    item.append(edit, remove)
    return item
  }

  // A trashed capture: one short line and a Restore button. Its photo or recording is not loaded.
  function buildTrashItem(capture) {
    const item = document.createElement('li')

    const time = document.createElement('time')
    time.dateTime = capture.created
    time.textContent = new Date(capture.created).toLocaleString()
    item.append(time)

    const summary = document.createElement('p')
    const firstLine = (capture.title || capture.text).split('\n')[0].slice(0, 80)
    summary.textContent = firstLine ? `${KIND_NAMES[capture.kind]}: ${firstLine}` : KIND_NAMES[capture.kind]
    item.append(summary)

    const restore = document.createElement('button')
    restore.textContent = 'Restore'
    restore.className = 'small'
    restore.onclick = async () => {
      await restoreCapture(capture.id)
      message.textContent = 'Restored to the inbox.'
      await render()
    }
    item.append(restore)
    return item
  }

  function startEdit(capture, item) {
    if (editing) {
      message.textContent = 'Finish or cancel the open edit first.'
      return
    }
    const finish = async (text) => {
      editing = null
      if (text) message.textContent = text
      await render()
    }
    editing = { id: capture.id, node: item }
    item.replaceChildren(
      buildEditForm(capture, {
        onSave: async (values) => {
          const text = values.text.trim()
          if (capture.kind === 'text' && !text) {
            message.textContent = 'A note needs text.'
            return
          }
          await updateCapture(capture.id, {
            text,
            title: values.title.trim() || null,
            place: values.place.trim() || null,
            source: values.source.trim() || null,
          })
          await finish('Changes saved.')
        },
        onCancel: () => finish(),
        onRemoveLocation: async () => {
          if (!confirm('Remove the coordinates from this capture? This cannot be undone.')) return false
          await updateCapture(capture.id, { location: null })
          return true
        },
      }),
    )
  }

  async function render() {
    const thisRender = ++renderCount
    const captures = await listCaptures('active')
    const trashed = await listCaptures('trashed')
    const blobs = await Promise.all(captures.map((capture) => (capture.media ? getMedia(capture.id) : null)))
    if (thisRender !== renderCount) return // a newer render has started; drop this one

    mediaUrls.forEach((url) => URL.revokeObjectURL(url))
    mediaUrls = []

    count.textContent = `(${captures.length})`
    trashCount.textContent = trashed.length ? `(${trashed.length})` : ''
    trashList.replaceChildren(...trashed.map(buildTrashItem))

    // A capture with its Edit form open keeps its existing element, so a refresh
    // (for example, a location arriving) never wipes what is being typed.
    const items = captures.map((capture, index) =>
      editing && capture.id === editing.id ? editing.node : buildCaptureItem(capture, blobs[index]),
    )
    if (!captures.length) {
      const empty = document.createElement('li')
      empty.textContent = 'No captures yet.'
      items.push(empty)
    }

    const open = editing && items.indexOf(editing.node)
    if (editing && open !== -1 && editing.node.parentNode === list) {
      // Taking an element out of the page makes the browser drop its keyboard focus, so the capture
      // being edited stays in place and only the captures around it are swapped.
      for (const child of [...list.children]) if (child !== editing.node) child.remove()
      items.slice(0, open).forEach((item) => list.insertBefore(item, editing.node))
      items.slice(open + 1).forEach((item) => list.append(item))
    } else {
      list.replaceChildren(...items)
    }
    window.dispatchEvent(new Event('captures-changed')) // lets the backup section update its counts
  }

  // The capture is already saved. Now ask for the position once and attach it if it arrives.
  async function attachLocation(capture) {
    const location = await getLocation()
    if (location) {
      await updateCapture(capture.id, { location })
      message.textContent = 'Saved with location.'
    } else {
      message.textContent = 'Saved. No location (denied, no signal, or too slow).'
    }
    await render()
  }

  parent.querySelector('#save').onclick = async () => {
    const text = note.value.trim()
    if (!text) {
      message.textContent = 'Nothing to save.'
      return
    }
    try {
      const wantsLocation = locationSwitch.checked
      const capture = newCapture({ kind: 'text', text })
      await saveCapture(capture)
      note.value = ''
      message.textContent = wantsLocation ? 'Saved. Looking for location...' : 'Saved. Location is off.'
      await render()
      if (wantsLocation) await attachLocation(capture)
    } catch (error) {
      message.textContent = `Could not save: ${error.name}`
    }
  }

  parent.querySelector('#photo').onclick = () => photoInput.click()

  photoInput.onchange = async () => {
    const file = photoInput.files[0]
    photoInput.value = '' // so taking the same photo again still triggers a change
    if (!file) return // the camera was cancelled
    try {
      const wantsLocation = locationSwitch.checked
      message.textContent = 'Shrinking the photo...'
      const photo = await shrinkPhoto(file)
      const capture = newCapture({ kind: 'photo' })
      capture.media = { mimeType: photo.type || file.type, size: photo.size } // the type comes from the data, never assumed
      await saveCaptureWithMedia(capture, photo)
      const sizes = `${formatBytes(file.size)} to ${formatBytes(photo.size)}`
      message.textContent = wantsLocation
        ? `Photo saved (${sizes}). Looking for location...`
        : `Photo saved (${sizes}). Location is off.`
      await render()
      if (wantsLocation) await attachLocation(capture)
    } catch (error) {
      message.textContent = `Could not save the photo: ${error.name}`
    }
  }

  // Voice memo: tap to start, tap again to stop. The capture is saved when the recording ends,
  // whether you stopped it or the system did.
  let recording = null

  async function saveRecording(blob) {
    if (!blob) {
      message.textContent = 'Nothing was recorded.'
      return
    }
    const wantsLocation = locationSwitch.checked
    const capture = newCapture({ kind: 'audio' })
    capture.media = { mimeType: blob.type, size: blob.size } // the type comes from the recording, never assumed
    await saveCaptureWithMedia(capture, blob)
    message.textContent = wantsLocation ? 'Recording saved. Looking for location...' : 'Recording saved. Location is off.'
    await render()
    if (wantsLocation) await attachLocation(capture)
  }

  recordButton.onclick = async () => {
    if (recording) {
      recording.stop()
      return
    }
    try {
      recording = await startRecording()
    } catch (error) {
      message.textContent = `Could not record: ${error.name === 'NotAllowedError' ? 'microphone not allowed' : error.message}`
      return
    }
    notice.hidden = true
    const startedAt = Date.now()

    // iOS stops the microphone when the app leaves the screen. Stop and save at once, while the page
    // can still run, instead of waiting to be told the microphone ended.
    let leftScreen = false
    const onVisibility = () => {
      if (document.visibilityState === 'hidden' && recording) {
        leftScreen = true
        recording.stop()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)

    const timer = setInterval(() => {
      recordButton.textContent = `Stop recording (${Math.floor((Date.now() - startedAt) / 1000)} s)`
    }, 250)
    recordButton.classList.add('recording')
    recordButton.textContent = 'Stop recording (0 s)'
    message.textContent = 'Recording. Keep the app open on screen.'

    const blob = await recording.finished
    clearInterval(timer)
    document.removeEventListener('visibilitychange', onVisibility)
    recording = null
    recordButton.classList.remove('recording')
    recordButton.textContent = 'Record voice memo'
    try {
      await saveRecording(blob)
    } catch (error) {
      message.textContent = `Could not save the recording: ${error.name}`
      return
    }
    // Stays on screen until the next recording starts, so it is seen even after the location message.
    if (leftScreen) {
      notice.textContent = blob
        ? 'The recording stopped because the app left the screen. What was recorded up to that moment is saved as a capture.'
        : 'The recording stopped because the app left the screen, and nothing had been recorded.'
      notice.hidden = false
    }
  }

  render().catch((error) => {
    message.textContent = `Could not open storage: ${error.name}`
  })

  return { render }
}
