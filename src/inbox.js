// The capture screen: write a text note or take a photo, see the inbox, delete cards.

import { newCard } from './cards.js'
import { getLocation } from './location.js'
import { deleteCard, getMedia, listCards, saveCardWithMedia, saveCard, updateCard } from './storage.js'

export function mountInbox(parent) {
  parent.innerHTML = `
    <section class="capture">
      <label for="note">New note</label>
      <textarea id="note" rows="4"></textarea>
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
  const photoInput = parent.querySelector('#photo-input')
  const message = parent.querySelector('#message')
  const count = parent.querySelector('#count')
  const list = parent.querySelector('#cards')

  let photoUrls = [] // object URLs for the photos on screen; released on the next render
  let renderCount = 0

  async function render() {
    const thisRender = ++renderCount
    const cards = await listCards()
    const blobs = await Promise.all(cards.map((card) => (card.media ? getMedia(card.id) : null)))
    if (thisRender !== renderCount) return // a newer render has started; drop this one

    photoUrls.forEach((url) => URL.revokeObjectURL(url))
    photoUrls = []

    count.textContent = `(${cards.length})`
    list.replaceChildren(
      ...cards.map((card, index) => {
        const item = document.createElement('li')

        const time = document.createElement('time')
        time.dateTime = card.created
        time.textContent = new Date(card.created).toLocaleString()
        item.append(time)

        if (card.kind === 'photo' && blobs[index]) {
          const url = URL.createObjectURL(blobs[index])
          photoUrls.push(url)
          const image = document.createElement('img')
          image.src = url
          image.alt = 'Photo'
          item.append(image)
        }

        // textContent, never innerHTML: notes are user data and must not be read as page code
        if (card.text) {
          const text = document.createElement('p')
          text.textContent = card.text
          item.append(text)
        }

        const where = document.createElement('p')
        where.className = 'where'
        where.textContent = card.location
          ? `${card.location.lat.toFixed(5)}, ${card.location.lon.toFixed(5)} (within ${card.location.accuracy} m)`
          : 'No location'
        item.append(where)

        const remove = document.createElement('button')
        remove.textContent = 'Delete'
        remove.className = 'small'
        remove.onclick = async () => {
          if (!confirm('Delete this card? This cannot be undone.')) return
          await deleteCard(card.id)
          await render()
        }
        item.append(remove)
        return item
      }),
    )
    if (!cards.length) {
      const empty = document.createElement('li')
      empty.textContent = 'No cards yet.'
      list.append(empty)
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
      const card = newCard({ kind: 'text', text })
      await saveCard(card)
      note.value = ''
      message.textContent = 'Saved. Looking for location...'
      await render()
      await attachLocation(card)
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
      const card = newCard({ kind: 'photo' })
      card.media = { mimeType: file.type, size: file.size } // the type comes from the file, never assumed
      await saveCardWithMedia(card, file)
      message.textContent = 'Photo saved. Looking for location...'
      await render()
      await attachLocation(card)
    } catch (error) {
      message.textContent = `Could not save the photo: ${error.name}`
    }
  }

  render().catch((error) => {
    message.textContent = `Could not open storage: ${error.name}`
  })
}
