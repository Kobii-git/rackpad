type ImageAsset = {
  dataUrl: string;
  label: string;
  fileName?: string | null;
  mimeType?: string | null;
};

const SAFE_EMBEDDED_IMAGE =
  /^data:image\/(?:gif|jpeg|png|webp)(?:;base64)?,/i;

export function resolveSafeImageSource(
  source: string,
  baseUrl = window.location.href,
) {
  const trimmed = source.trim();
  if (SAFE_EMBEDDED_IMAGE.test(trimmed)) return trimmed;

  try {
    const url = new URL(trimmed, baseUrl);
    if (
      url.protocol === "http:" ||
      url.protocol === "https:" ||
      url.protocol === "blob:"
    ) {
      return url.href;
    }
  } catch {
    // Invalid and unsafe sources are deliberately inert.
  }
  return null;
}

export function openImageSource(source: string) {
  const safeSource = resolveSafeImageSource(source);
  if (!safeSource) return false;

  const objectUrl = safeSource.startsWith("data:")
    ? URL.createObjectURL(dataUrlToBlob(safeSource))
    : null;
  const opened = window.open(
    objectUrl ?? safeSource,
    "_blank",
    "noopener,noreferrer",
  );
  if (objectUrl) {
    window.setTimeout(
      () => URL.revokeObjectURL(objectUrl),
      opened ? 60_000 : 1_000,
    );
  }
  return Boolean(opened);
}

export function openImageAsset(image: ImageAsset) {
  openImageSource(image.dataUrl);
}

export function downloadImageAsset(image: ImageAsset) {
  const url = imageDataUrlToObjectUrl(image);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = image.fileName || `${image.label}.image`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function imageDataUrlToObjectUrl(image: ImageAsset) {
  return URL.createObjectURL(dataUrlToBlob(image.dataUrl, image.mimeType));
}

function dataUrlToBlob(dataUrl: string, fallbackType?: string | null) {
  const match = dataUrl.match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
  if (!match) {
    throw new Error("Image data is not a valid data URL.");
  }

  const mimeType = match[1] || fallbackType || "application/octet-stream";
  const isBase64 = Boolean(match[2]);
  const payload = match[3] ?? "";
  const binary = isBase64 ? window.atob(payload) : decodeURIComponent(payload);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mimeType });
}
