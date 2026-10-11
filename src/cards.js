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

// Coordinates as readable text, e.g. "55.58231, 12.99992 (within 20 m)".
export function describeLocation(location) {
  return `${location.lat.toFixed(5)}, ${location.lon.toFixed(5)} (within ${location.accuracy} m)`
}
