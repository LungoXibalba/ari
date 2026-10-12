// The shape of a capture (one photo, voice memo or text note as it arrived), in one place.
// The approved field list is in CLAUDE.md ("Capture fields").

export const SCHEMA_VERSION = 2

// Make a new capture. Optional fields start empty (null, or '' for text).
export function newCapture({ kind, text = '' }) {
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    schemaVersion: SCHEMA_VERSION,
    kind, // 'text', 'photo' or 'audio'
    created: now,
    updated: now,
    text,
    title: null,
    source: null,
    place: null,
    location: null, // { lat, lon, accuracy, at }, attached later when it arrives
    media: null, // { mimeType, size }; the blob itself lives in the 'media' store
    deleted: null, // time it was moved to the trash, or null; trashed captures can be restored
  }
}

// Bring a capture saved under an earlier schema up to the current one. Version 1 had `gist`
// (now `title`) and `status` (dropped: nothing used it), and no `deleted`.
export function upgradeCapture(old) {
  if (old.schemaVersion >= SCHEMA_VERSION) return old
  const { gist, status, ...rest } = old
  return { ...rest, schemaVersion: SCHEMA_VERSION, title: gist ?? null, deleted: null }
}

// Coordinates as readable text, e.g. "55.58231, 12.99992 (within 20 m)".
export function describeLocation(location) {
  return `${location.lat.toFixed(5)}, ${location.lon.toFixed(5)} (within ${location.accuracy} m)`
}
