// The shape of a card, in one place. The approved field list is in CLAUDE.md ("Card fields").

export const SCHEMA_VERSION = 1

// Make a new card. Optional fields start empty (null, or '' for text).
export function newCard({ kind, text = '' }) {
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    schemaVersion: SCHEMA_VERSION,
    kind, // 'text', 'photo' or 'audio'
    created: now,
    updated: now,
    text,
    gist: null,
    source: null,
    place: null,
    location: null, // { lat, lon, accuracy, at }, attached later when it arrives
    media: null, // { mimeType, size }; the blob itself lives in the 'media' store
    status: 'inbox', // 'inbox' or 'processed'
  }
}
