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
  ["Face", new Set(["Visage", "Faccia", "Cara", "Yüz"])],
  [
    "Storage attention",
    new Set([
      "Achtung bei der Lagerung",
      "Attention au stockage",
      "Opslag aandacht",
      "Atención de almacenamiento",
      "Atenção de armazenamento",
      "Attenzione allo stoccaggio",
      "Uwaga dotycząca przechowywania",
      "储存注意事项",
      "儲存注意事項",
      "保管上の注意",
      "보관상의 주의",
      "भण्डारण का ध्यान",
      "স্টোরেজ মনোযোগ",
      "ความสนใจในการจัดเก็บ",
      "توجه به ذخیره سازی",
      "الاهتمام بالتخزين",
      "Внимание к хранению",
      "Увага до зберігання",
      "Depolamaya dikkat",
      "Lưu ý lưu trữ",
      "Perhatian penyimpanan",
      "Berging aandag",
    ]),
  ],
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
  ["New drive", new Set(["perjalanan baru", "Nuova guida", "Nuwe aandrywing"])],
  ["Save drive", new Set(["Simpan perjalanan", "Stoor ry"])],
  ["Create drive", new Set(["Buat penggerak", "Skep ry"])],
  [
    "No drives documented yet.",
    new Set([
      "Es sind noch keine Fahrten dokumentiert.",
      "কোন ড্রাইভ এখনো নথিভুক্ত করা হয়েছে.",
    ]),
  ],
  [
    "Drives",
    new Set([
      "Antriebe",
      "Aandrijvingen",
      "चलाती है",
      "ড্রাইভ করে",
      "berkendara",
      "Ry",
    ]),
  ],
  [
    "Logical pools",
    new Set(["حمامات منطقية", "בריכות לוגיות", "استخرهای منطقی"]),
  ],
  ["Unknown drive", new Set(["Onbekende rit", "Onbekende ry"])],
  [
    "Drive details",
    new Set([
      "Antriebsdetails",
      "Rijgegevens",
      "Detalhes da viagem",
      "Dettagli della guida",
      "تفاصيل القيادة",
      "Detail berkendara",
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
