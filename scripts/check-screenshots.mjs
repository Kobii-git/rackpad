import { chromium } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const MAX_CHANGED_PIXEL_RATIO = 0.0001;
const MAX_CHANNEL_DELTA = 8;
const projectRoot = process.cwd();
const scratchRoot = await mkdtemp(
  resolve(tmpdir(), "rackpad-screenshot-check-"),
);
const firstDir = resolve(scratchRoot, "first");
const secondDir = resolve(scratchRoot, "second");
const playwrightCli = resolve(
  projectRoot,
  "node_modules/@playwright/test/cli.js",
);

try {
  capture(firstDir);
  capture(secondDir);
  await compareSuites(firstDir, secondDir);
} finally {
  await rm(scratchRoot, { force: true, recursive: true });
}

function capture(outputDir) {
  const result = spawnSync(
    process.execPath,
    [playwrightCli, "test", "--config=playwright.screenshots.config.ts"],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        RACKPAD_SCREENSHOT_OUTPUT_DIR: outputDir,
      },
      stdio: "inherit",
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Screenshot capture failed with exit code ${result.status}.`);
  }
}

async function compareSuites(first, second) {
  const firstFiles = await pngFiles(first);
  const secondFiles = await pngFiles(second);
  if (JSON.stringify(firstFiles) !== JSON.stringify(secondFiles)) {
    throw new Error(
      `Screenshot manifests differ.\nFirst: ${firstFiles.join(", ")}\nSecond: ${secondFiles.join(", ")}`,
    );
  }

  const browser = await chromium.launch({
    args: [
      "--disable-gpu",
      "--disable-lcd-text",
      "--disable-font-subpixel-positioning",
      "--force-color-profile=srgb",
    ],
  });
  try {
    const page = await browser.newPage();
    for (const filename of firstFiles) {
      const [firstPng, secondPng] = await Promise.all([
        readFile(resolve(first, filename), "base64"),
        readFile(resolve(second, filename), "base64"),
      ]);
      const result = await page.evaluate(
        async ({ firstImage, secondImage }) => {
          const load = async (base64) => {
            const image = new globalThis.Image();
            image.src = `data:image/png;base64,${base64}`;
            await image.decode();
            const canvas = globalThis.document.createElement("canvas");
            canvas.width = image.naturalWidth;
            canvas.height = image.naturalHeight;
            const context = canvas.getContext("2d", {
              willReadFrequently: true,
            });
            if (!context) throw new Error("Canvas 2D context is unavailable.");
            context.drawImage(image, 0, 0);
            return {
              width: canvas.width,
              height: canvas.height,
              pixels: context.getImageData(0, 0, canvas.width, canvas.height)
                .data,
            };
          };
          const left = await load(firstImage);
          const right = await load(secondImage);
          if (left.width !== right.width || left.height !== right.height) {
            return {
              width: left.width,
              height: left.height,
              dimensionsMatch: false,
              changedPixels: Number.POSITIVE_INFINITY,
              maxChannelDelta: Number.POSITIVE_INFINITY,
            };
          }
          let changedPixels = 0;
          let maxChannelDelta = 0;
          for (let index = 0; index < left.pixels.length; index += 4) {
            let changed = false;
            for (let channel = 0; channel < 4; channel += 1) {
              const delta = Math.abs(
                left.pixels[index + channel] - right.pixels[index + channel],
              );
              if (delta > 0) changed = true;
              if (delta > maxChannelDelta) maxChannelDelta = delta;
            }
            if (changed) changedPixels += 1;
          }
          return {
            width: left.width,
            height: left.height,
            dimensionsMatch: true,
            changedPixels,
            maxChannelDelta,
          };
        },
        { firstImage: firstPng, secondImage: secondPng },
      );
      const pixelCount = result.width * result.height;
      const changedRatio = result.changedPixels / pixelCount;
      if (
        !result.dimensionsMatch ||
        changedRatio > MAX_CHANGED_PIXEL_RATIO ||
        result.maxChannelDelta > MAX_CHANNEL_DELTA
      ) {
        throw new Error(
          `${filename} is not deterministic: ${result.changedPixels} changed pixels ` +
            `(${(changedRatio * 100).toFixed(5)}%), maximum channel delta ` +
            `${result.maxChannelDelta}.`,
        );
      }
      console.log(
        `${filename}: ${result.changedPixels} changed pixels, max delta ${result.maxChannelDelta}`,
      );
    }
  } finally {
    await browser.close();
  }
}

async function pngFiles(directory) {
  return (await readdir(directory))
    .filter((entry) => entry.endsWith(".png"))
    .sort();
}
