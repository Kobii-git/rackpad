type ImageAsset = {
  dataUrl: string;
  label: string;
  fileName?: string | null;
  mimeType?: string | null;
};

export function openImageAsset(image: ImageAsset) {
  const url = imageDataUrlToObjectUrl(image);
  const opened = window.open(url, "_blank", "noopener,noreferrer");
  window.setTimeout(() => URL.revokeObjectURL(url), opened ? 60_000 : 1_000);
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
