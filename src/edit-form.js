// The Edit form for one card: text, place, gist, source, and removing the coordinates.
// It only builds the form; the caller decides what saving, cancelling and removing do.

import { describeLocation } from './cards.js'

function addField(form, labelText, control) {
  const label = document.createElement('label')
  label.textContent = labelText
  label.append(control)
  form.append(label)
}

function textInput(value) {
  const input = document.createElement('input')
  input.type = 'text'
  input.value = value ?? ''
  return input
}

// onSave({ text, place, gist, source }) gets the typed values.
// onRemoveLocation() asks the caller to remove the coordinates and returns true if it did.
export function buildEditForm(card, { onSave, onCancel, onRemoveLocation }) {
  const form = document.createElement('form')
  form.className = 'edit'

  const text = document.createElement('textarea')
  text.rows = 4
  text.value = card.text
  const gist = textInput(card.gist)
  const place = textInput(card.place)
  const source = textInput(card.source)

  addField(form, card.kind === 'text' ? 'Note' : 'Caption or note', text)
  addField(form, 'Gist (one line, your own words)', gist)
  addField(form, 'Place (for example, Malmö University library, 3rd floor)', place)
  addField(form, 'Source', source)

  if (card.location) {
    const row = document.createElement('p')
    row.className = 'where'
    row.textContent = `Coordinates: ${describeLocation(card.location)} `

    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'small'
    remove.textContent = 'Remove coordinates'
    remove.onclick = async () => {
      if (await onRemoveLocation()) row.textContent = 'Coordinates removed.'
    }
    row.append(remove)
    form.append(row)
  }

  const save = document.createElement('button')
  save.type = 'submit'
  save.textContent = 'Save changes'
  const cancel = document.createElement('button')
  cancel.type = 'button'
  cancel.className = 'small'
  cancel.textContent = 'Cancel'
  cancel.onclick = onCancel
  form.append(save, cancel)

  form.onsubmit = (event) => {
    event.preventDefault()
    onSave({ text: text.value, place: place.value, gist: gist.value, source: source.value })
  }
  return form
}
