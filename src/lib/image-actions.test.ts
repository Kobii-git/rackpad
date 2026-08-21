import assert from "node:assert/strict";
import test from "node:test";
import { resolveSafeImageSource } from "./image-actions";

const BASE_URL = "https://rackpad.example/documentation";

test("documentation image sources allow safe web, same-origin, blob, and embedded images", () => {
  assert.equal(
    resolveSafeImageSource("/api/images/example.png", BASE_URL),
    "https://rackpad.example/api/images/example.png",
  );
  assert.equal(
    resolveSafeImageSource("https://cdn.example/image.webp", BASE_URL),
    "https://cdn.example/image.webp",
  );
  assert.equal(
    resolveSafeImageSource("blob:https://rackpad.example/asset-id", BASE_URL),
    "blob:https://rackpad.example/asset-id",
  );
  assert.equal(
    resolveSafeImageSource("data:image/png;base64,AA==", BASE_URL),
    "data:image/png;base64,AA==",
  );
});

test("documentation image sources reject executable and unsupported schemes", () => {
  assert.equal(resolveSafeImageSource("javascript:alert(1)", BASE_URL), null);
  assert.equal(
    resolveSafeImageSource("data:image/svg+xml,<svg></svg>", BASE_URL),
    null,
  );
  assert.equal(resolveSafeImageSource("file:///tmp/image.png", BASE_URL), null);
});
