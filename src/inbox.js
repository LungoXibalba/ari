// The capture screen: write a text note or take a photo, see the inbox, edit and delete cards.

import { describeLocation, newCard } from './cards.js'
import { buildEditForm } from './edit-form.js'
import { getLocation } from './location.js'
import { attachLocationEnabled, setAttachLocationEnabled } from './settings.js'
import { deleteCard, getMedia, listCards, saveCard, saveCardWithMedia, updateCard } from './storage.js'

export function mountInbox(parent) {
  parent.innerHTML = `
    <section class="capture">
      <label for="note">New note</label>
      <textarea id="note" rows="4"></textarea>
      <label class="switch"><input id="location-switch" type="checkbox" /> Attach location when saving</label>
      <button id="save">Save note</button>
      <button id="photo">Take photo</button>
      <input id="photo-input" type="file" accept="image/*" capture="environment" hidden />
      <p id="message" role="status"></p>
    </section>
    <section>
      <h2>Inbox <span id="count"></span></h2>
      <ul id="cards"></ul>
    </section>
  `

  const note = parent.querySelector('#note')
  const locationSwitch = parent.querySelector('#location-switch')
  const photoInput = parent.querySelector('#photo-input')
  const message = parent.querySelector('#message')
  const count = parent.querySelector('#count')
  const list = parent.querySelector('#cards')

  locationSwitch.checked = attachLocationEnabled()
  locationSwitch.onchange = () => setAttachLocationEnabled(locationSwitch.checked)

  let photoUrls = [] // object URLs for the photos on screen; released on the next render
  let renderCount = 0
  let editing = null // { id, node } while a card's Edit form is open

  // The normal view of one card.
  function buildCardItem(card, blob) {
    const item = document.createElement('li')

    const time = document.createElement('time')
    time.dateTime = card.created
    time.textContent = new Date(card.created).toLocaleString()
    item.append(time)

    // textContent, never innerHTML: everything typed is user data and must not be read as page code
    if (card.gist) {
      const gist = document.createElement('p')
      gist.className = 'gist'
      gist.textContent = card.gist
      item.append(gist)
    }

    if (card.kind === 'photo' && blob) {
      const url = URL.createObjectURL(blob)
      photoUrls.push(url)
      const image = document.createElement('img')
      image.src = url
      image.alt = 'Photo'
      item.append(image)
    }

    if (card.text) {
      const text = document.createElement('p')
      text.textContent = card.text
      item.append(text)
    }

    const where = document.createElement('p')
    where.className = 'where'
    const parts = [card.place, card.location && describeLocation(card.location)].filter(Boolean)
    where.textContent = parts.length ? parts.join(' · ') : 'No location'
    item.append(where)

    if (card.source) {
      const source = document.createElement('p')
      source.className = 'where'
      source.textContent = `Source: ${card.source}`
      item.append(source)
    }

    const edit = document.createElement('button')
    edit.textContent = 'Edit'
    edit.className = 'small'
    edit.onclick = () => startEdit(card, item)

    const remove = document.createElement('button')
    remove.textContent = 'Delete'
    remove.className = 'small'
    remove.onclick = async () => {
      if (!confirm('Delete this card? This cannot be undone.')) return
      await deleteCard(card.id)
      await render()
    }
    item.append(edit, remove)
    return item
  }

  function startEdit(card, item) {
    if (editing) {
      message.textContent = 'Finish or cancel the open edit first.'
      return
    }
    const finish = async (note) => {
      editing = null
      if (note) message.textContent = note
      await render()
    }
    editing = { id: card.id, node: item }
    item.replaceChildren(
      buildEditForm(card, {
        onSave: async (values) => {
          const text = values.text.trim()
          if (card.kind === 'text' && !text) {
            message.textContent = 'A note needs text.'
            return
          }
          await updateCard(card.id, {
            text,
            gist: values.gist.trim() || null,
            place: values.place.trim() || null,
            source: values.source.trim() || null,
          })
          await finish('Changes saved.')
        },
        onCancel: () => finish(),
        onRemoveLocation: async () => {
          if (!confirm('Remove the coordinates from this card? This cannot be undone.')) return false
          await updateCard(card.id, { location: null })
          return true
        },
      }),
    )
  }

  async function render() {
    const thisRender = ++renderCount
    const cards = await listCards()
    const blobs = await Promise.all(cards.map((card) => (card.media ? getMedia(card.id) : null)))
    if (thisRender !== renderCount) return // a newer render has started; drop this one

    photoUrls.forEach((url) => URL.revokeObjectURL(url))
    photoUrls = []

    count.textContent = `(${cards.length})`
    // A card with its Edit form open keeps its existing element, so a refresh
    // (for example, a location arriving) never wipes what is being typed.
    const items = cards.map((card, index) =>
      editing && card.id === editing.id ? editing.node : buildCardItem(card, blobs[index]),
    )
    if (!cards.length) {
      const empty = document.createElement('li')
      empty.textContent = 'No cards yet.'
      items.push(empty)
    }

    const open = editing && items.indexOf(editing.node)
    if (editing && open !== -1 && editing.node.parentNode === list) {
      // Taking an element out of the page makes the browser drop its keyboard focus, so the card
      // being edited stays in place and only the cards around it are swapped.
      for (const child of [...list.children]) if (child !== editing.node) child.remove()
      items.slice(0, open).forEach((item) => list.insertBefore(item, editing.node))
      items.slice(open + 1).forEach((item) => list.append(item))
    } else {
      list.replaceChildren(...items)
    }
  }

  // The card is already saved. Now ask for the position once and attach it if it arrives.
  async function attachLocation(card) {
    const location = await getLocation()
    if (location) {
      await updateCard(card.id, { location })
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
      const card = newCard({ kind: 'text', text })
      await saveCard(card)
      note.value = ''
      message.textContent = wantsLocation ? 'Saved. Looking for location...' : 'Saved. Location is off.'
      await render()
      if (wantsLocation) await attachLocation(card)
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
      const card = newCard({ kind: 'photo' })
      card.media = { mimeType: file.type, size: file.size } // the type comes from the file, never assumed
      await saveCardWithMedia(card, file)
      message.textContent = wantsLocation ? 'Photo saved. Looking for location...' : 'Photo saved. Location is off.'
      await render()
      if (wantsLocation) await attachLocation(card)
    } catch (error) {
      message.textContent = `Could not save the photo: ${error.name}`
    }
  }

  render().catch((error) => {
    message.textContent = `Could not open storage: ${error.name}`
  })
}
