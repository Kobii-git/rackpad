/** Accept only opaque hex colors, including when displaying imported inventory. */
export function headerColorStyle(color?: string | null) {
  if (!color || !/^#[0-9a-f]{6}$/i.test(color)) return undefined;
  const channels = [1, 3, 5].map((offset) => {
    const value = parseInt(color.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance =
    channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  return {
    backgroundColor: color,
    color: luminance > 0.179 ? "#000000" : "#ffffff",
  };
}
