// The screen for step 4: write a text note, save it, see the inbox, delete cards.

import { newCard } from './cards.js'
import { deleteCard, listCards, saveCard } from './storage.js'

export function mountInbox(parent) {
  parent.innerHTML = `
    <section class="capture">
      <label for="note">New note</label>
      <textarea id="note" rows="4"></textarea>
      <button id="save">Save note</button>
      <p id="message" role="status"></p>
    </section>
    <section>
      <h2>Inbox <span id="count"></span></h2>
      <ul id="cards"></ul>
    </section>
  `

  const note = parent.querySelector('#note')
  const message = parent.querySelector('#message')
  const count = parent.querySelector('#count')
  const list = parent.querySelector('#cards')

  async function render() {
    const cards = await listCards()
    count.textContent = `(${cards.length})`
    list.replaceChildren(
      ...cards.map((card) => {
        const item = document.createElement('li')

        const time = document.createElement('time')
        time.dateTime = card.created
        time.textContent = new Date(card.created).toLocaleString()

        // textContent, never innerHTML: notes are user data and must not be read as page code
        const text = document.createElement('p')
        text.textContent = card.text

        const remove = document.createElement('button')
        remove.textContent = 'Delete'
        remove.className = 'small'
        remove.onclick = async () => {
          if (!confirm('Delete this card? This cannot be undone.')) return
          await deleteCard(card.id)
          await render()
        }

        item.append(time, text, remove)
        return item
      }),
    )
    if (!cards.length) {
      const empty = document.createElement('li')
      empty.textContent = 'No cards yet.'
      list.append(empty)
    }
  }

  parent.querySelector('#save').onclick = async () => {
    const text = note.value.trim()
    if (!text) {
      message.textContent = 'Nothing to save.'
      return
    }
    try {
      await saveCard(newCard({ kind: 'text', text }))
      note.value = ''
      message.textContent = 'Saved.'
      await render()
    } catch (error) {
      message.textContent = `Could not save: ${error.name}`
    }
  }

  render().catch((error) => {
    message.textContent = `Could not open storage: ${error.name}`
  })
}
