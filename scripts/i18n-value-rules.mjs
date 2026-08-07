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

const storagePoolKeys = new Set([
  "Pool",
  "No pool",
  "Missing pool members",
  "Degraded or offline pools",
  "Logical pools",
  "New pool",
  "Pool name",
  "RAID / pool type",
  "Pool status",
  "Pool members",
  "Save pool",
  "Create pool",
  "Delete pool",
  "Delete this storage pool?",
  "No storage pools documented yet.",
  "A new pool member must be installed in a slot.",
  "Pool member is physically missing",
  "Pool owner",
]);

const rejectedPoolFragments = [
  "swembad",
  "حمام سباحة",
  "مسبح",
  "piscina",
  "piscine",
  "בריכה",
  "kolam",
  "수영장",
  "zwembad",
  "basen",
  "бассейн",
  "สระว่ายน้ำ",
  "สระน้ำ",
  "басейн",
  "bể bơi",
  "hồ bơi",
  "泳池",
];

const rejectedStorageValues = new Map([
  [
    "Storage inventory",
    new Set([
      "保管在庫",
      "仓储库存",
      "倉儲庫存",
      "موجودی انبار",
      "สินค้าคงคลังที่จัดเก็บ",
    ]),
  ],
  [
    "Drive inventory",
    new Set([
      "Bestuur voorraad",
      "قيادة المخزون",
      "Lagerbestand steigern",
      "Impulsar el inventario",
      "موجودی را هدایت کنید",
      "Piloter l'inventaire",
      "הגדל את המלאי",
      "इन्वेंटरी चलाएँ",
      "Dorong inventaris",
      "Promuovi l'inventario",
      "在庫を増やす",
      "재고 유도",
      "Napędzaj zasoby",
      "Gerar inventário",
      "Увеличьте запасы",
      "ขับเคลื่อนสินค้าคงคลัง",
      "Envanteri artırın",
      "Спрямуйте запаси",
      "Thúc đẩy khoảng không quảng cáo",
      "推动库存",
      "推動庫存",
    ]),
  ],
  [
    "Pull drive",
    new Set([
      "Trek ry",
      "محرك السحب",
      "ড্রাইভ টানুন",
      "Antrieb ziehen",
      "Tirar de la unidad",
      "درایو را بکش",
      "Entraînement par traction",
      "משוך כונן",
      "ड्राइव खींचो",
      "Tarik penggerak",
      "Tirare l'azionamento",
      "プルドライブ",
      "드라이브를 당겨",
      "Trek aandrijving",
      "Pociągnij napęd",
      "Puxar unidade",
      "Тяговый привод",
      "ดึงไดรฟ์",
      "Çekme tahriki",
      "Тягнути привід",
      "Kéo ổ",
      "拉动驱动",
      "拉動驅動",
    ]),
  ],
  [
    "Storage enclosure",
    new Set([
      "Aufbewahrungsgehäuse",
      "Recinto de almacenamiento",
      "Enceinte de stockage",
      "Kandang penyimpanan",
      "Custodia di stoccaggio",
      "Opbergbehuizing",
      "Obudowa do przechowywania",
      "Bao vây lưu trữ",
      "存储柜",
      "儲存櫃",
    ]),
  ],
]);

export function isRejectedStorageTranslation(_locale, key, value) {
  const normalized = value.toLocaleLowerCase();
  if (
    storagePoolKeys.has(key) &&
    rejectedPoolFragments.some((fragment) => normalized.includes(fragment))
  ) {
    return true;
  }
  return rejectedStorageValues.get(key)?.has(value) ?? false;
}
