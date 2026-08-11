import assert from "node:assert/strict";
import test from "node:test";
import { canonicalMacAddress, matchesMacAwareSearch } from "./network-labels";

const CANONICAL_MAC = "00:11:22:33:44:55";

test("canonicalMacAddress accepts common full MAC address notations", () => {
  for (const value of [
    CANONICAL_MAC,
    "00-11-22-33-44-55",
    "0011.2233.4455",
    "001122334455",
    "  00-11-22-33-44-55  ",
  ]) {
    assert.equal(canonicalMacAddress(value), CANONICAL_MAC, value);
  }
});

test("canonicalMacAddress rejects partial and non-MAC search queries", () => {
  for (const value of ["00:11:22", "switch-01", "10.0.0.1", "00112233445g"]) {
    assert.equal(canonicalMacAddress(value), null, value);
  }
});

test("matchesMacAwareSearch matches alternate full MAC formats", () => {
  const haystack = `switch-01 ${CANONICAL_MAC} online`;
  for (const query of ["00-11-22-33-44-55", "0011.2233.4455", "001122334455"]) {
    assert.equal(matchesMacAwareSearch(haystack, query), true, query);
  }
});

test("matchesMacAwareSearch preserves existing substring matching", () => {
  const haystack = `switch-01 ${CANONICAL_MAC} 10.0.0.1`;
  assert.equal(matchesMacAwareSearch(haystack, "00:11:22"), true);
  assert.equal(matchesMacAwareSearch(haystack, "switch-01"), true);
  assert.equal(matchesMacAwareSearch(haystack, "10.0.0.1"), true);
  assert.equal(matchesMacAwareSearch(haystack, "aa-bb-cc-dd-ee-ff"), false);
});
