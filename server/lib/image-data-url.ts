import { ValidationError } from "./validation.js";

const IMAGE_MIME_TYPES = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export const MAX_IMAGE_DATA_URL_LENGTH = 6 * 1024 * 1024;

export function ensureImageDataUrl(
  dataUrl: string,
  mimeType: string,
  key = "dataUrl",
) {
  if (!IMAGE_MIME_TYPES.has(mimeType)) {
    throw new ValidationError("Images must be PNG, JPEG, WebP, or GIF files.");
  }

  if (dataUrl.length > MAX_IMAGE_DATA_URL_LENGTH) {
    throw new ValidationError("Images must be 6 MB or smaller.");
  }

  const expectedPrefix = `data:${mimeType};base64,`;
  if (!dataUrl.startsWith(expectedPrefix)) {
    throw new ValidationError(`${key} must be a matching image data URL.`);
  }

  const base64 = dataUrl.slice(expectedPrefix.length);
  if (!base64 || !/^[a-zA-Z0-9+/]+={0,2}$/.test(base64)) {
    throw new ValidationError(`${key} must contain base64 image data.`);
  }

  return dataUrl;
}
