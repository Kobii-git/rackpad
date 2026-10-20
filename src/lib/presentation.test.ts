import assert from "node:assert/strict";
import test from "node:test";
import { headerColorStyle } from "./presentation";

test("header colors preserve theme defaults and reject arbitrary CSS", () => {
  for (const color of [
    undefined,
    null,
    "",
    "red",
    "#fff",
    "url(https://example.com)",
    "#000000;opacity:0",
  ])
    assert.equal(headerColorStyle(color), undefined);
});

test("header text meets WCAG AA contrast for a range of hue and brightness", () => {
  for (let r = 0; r <= 255; r += 17)
    for (let g = 0; g <= 255; g += 17)
      for (let b = 0; b <= 255; b += 17) {
        const color =
          "#" +
          [r, g, b]
            .map((value) => value.toString(16).padStart(2, "0"))
            .join("");
        const style = headerColorStyle(color)!;
        const linear = [r, g, b]
          .map((channel) => channel / 255)
          .map((channel) =>
            channel <= 0.04045
              ? channel / 12.92
              : ((channel + 0.055) / 1.055) ** 2.4,
          );
        const l = linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
        assert.ok(
          (style.color === "#000000" ? (l + 0.05) / 0.05 : 1.05 / (l + 0.05)) >=
            4.5,
          color,
        );
        assert.equal(style.backgroundColor, color);
      }
});
