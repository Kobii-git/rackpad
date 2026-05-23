const SUPPORTED_IMAGE_TYPES = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const MAX_IMAGE_SIZE_BYTES = 6 * 1024 * 1024;

export function imageTypeAllowed(type: string) {
  return SUPPORTED_IMAGE_TYPES.has(type);
}

export function imageSizeLimitLabel() {
  return "6 MB";
}

export async function readImageFileAsDataUrl(file: File): Promise<string> {
  if (!imageTypeAllowed(file.type)) {
    throw new Error("Images must be PNG, JPEG, WebP, or GIF files.");
  }
  if (file.size > MAX_IMAGE_SIZE_BYTES) {
    throw new Error(`Images must be ${imageSizeLimitLabel()} or smaller.`);
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("Unable to read that image."));
    });
    reader.addEventListener("error", () => {
      reject(new Error("Unable to read that image."));
    });
    reader.readAsDataURL(file);
  });
}

export function defaultImageLabel(fileName: string) {
  return fileName
    .replace(/\.[^.]+$/, "")
    .replace(/[-_]+/g, " ")
    .trim();
}
