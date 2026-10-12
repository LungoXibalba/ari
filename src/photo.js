// Shrinks a photo before it is stored: a phone photo is about 6 MB, far more than this app needs for now.
// The shrunken copy is the only copy the app keeps. Change the two numbers below to keep more detail later;
// photos already stored are not changed.

export const MAX_PHOTO_SIDE = 2048 // pixels on the longer side
export const PHOTO_QUALITY = 0.8 // JPEG quality, 0 to 1

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => resolve({ image, url })
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('The photo could not be decoded'))
    }
    image.src = url
  })
}

// Returns a smaller JPEG Blob, or the original file if shrinking is not possible or would not help.
// The browser applies the photo's rotation when it decodes the image, so the result is upright.
export async function shrinkPhoto(file) {
  if (!file.type.startsWith('image/')) return file
  let loaded
  try {
    loaded = await loadImage(file)
    const { image } = loaded
    const scale = Math.min(1, MAX_PHOTO_SIDE / Math.max(image.naturalWidth, image.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(image.naturalWidth * scale)
    canvas.height = Math.round(image.naturalHeight * scale)
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', PHOTO_QUALITY))
    // Keep the original if the result is missing or not smaller (for example, an already small photo).
    return blob && blob.size < file.size ? blob : file
  } catch {
    return file
  } finally {
    if (loaded) URL.revokeObjectURL(loaded.url)
  }
}
