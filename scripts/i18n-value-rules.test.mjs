import assert from "node:assert/strict";
import test from "node:test";
import {
  containsStandaloneBrand,
  isStaleSameAsEnglishAllowance,
  isUntranslatedVisibleValue,
} from "./i18n-value-rules.mjs";

test("notification brands remain exact standalone product names", () => {
  assert.equal(containsStandaloneBrand("URL du webhook Discord", "Discord"), true);
  assert.equal(containsStandaloneBrand("Discord-webhaak-URL", "Discord"), true);
  assert.equal(containsStandaloneBrand("fooDiscordbar webhook", "Discord"), false);
  assert.equal(containsStandaloneBrand("TelegramBot token", "Telegram"), false);
  assert.equal(containsStandaloneBrand("Discord\u0301 webhook", "Discord"), false);
  assert.equal(containsStandaloneBrand("\u0301Discord webhook", "Discord"), false);
  assert.equal(containsStandaloneBrand("Discord\u203Fwebhook", "Discord"), false);
  assert.equal(containsStandaloneBrand("Discord\u200D webhook", "Discord"), false);
  assert.equal(containsStandaloneBrand("Telegram\u200C bot", "Telegram"), false);
});

test("sample import product names remain exact standalone tokens", () => {
  assert.equal(
    containsStandaloneBrand("Charger un exemple Proxmox", "Proxmox"),
    true,
  );
  assert.equal(
    containsStandaloneBrand("Hyper-V-Beispiel laden", "Hyper-V"),
    true,
  );
  assert.equal(containsStandaloneBrand("Proxmox\u0301 sample", "Proxmox"), false);
  assert.equal(containsStandaloneBrand("MyHyper-VLab", "Hyper-V"), false);
});

test("wholly English visible labels are detected", () => {
  assert.equal(
    isUntranslatedVisibleValue("Discord webhook URL", "Discord webhook URL"),
    true,
  );
  assert.equal(
    isUntranslatedVisibleValue("URL du webhook Discord", "Discord webhook URL"),
    false,
  );
});

test("stale same-as-English allowances are detected", () => {
  assert.equal(isStaleSameAsEnglishAllowance("Rackpad", "Rackpad"), false);
  assert.equal(
    isStaleSameAsEnglishAllowance("Discord-webhaak-URL", "Discord webhook URL"),
    true,
  );
});
