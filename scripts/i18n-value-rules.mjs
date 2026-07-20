function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function containsStandaloneBrand(value, brand) {
  const escapedBrand = escapeRegExp(brand);
  return new RegExp(
    `(?<![\\p{L}\\p{M}\\p{N}\\p{Pc}\\u200C\\u200D])${escapedBrand}(?![\\p{L}\\p{M}\\p{N}\\p{Pc}\\u200C\\u200D])`,
    "u",
  ).test(value);
}

export function isUntranslatedVisibleValue(value, englishValue) {
  return /[\p{L}]/u.test(value) && value === englishValue;
}

export function isStaleSameAsEnglishAllowance(value, englishValue) {
  return value !== englishValue;
}
