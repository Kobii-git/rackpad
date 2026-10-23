import assert from "node:assert/strict";
import test from "node:test";
import { serviceNavigationUrl } from "./service-url.js";
test("service navigation permits explicit web links without inferring endpoints", () => {
  for (const value of [
    null,
    "",
    "/admin",
    "//example.test",
    "example.test",
    "javascript:alert(1)",
    "data:text/html,test",
    "file:///tmp/test",
    "https://",
    "https://user:password@example.test",
  ])
    assert.equal(serviceNavigationUrl(value), null);
  assert.equal(
    serviceNavigationUrl(" https://host.example:8443/path?q=1#x "),
    "https://host.example:8443/path?q=1#x",
  );
  assert.equal(
    serviceNavigationUrl("http://192.168.1.2:3000"),
    "http://192.168.1.2:3000/",
  );
  assert.equal(serviceNavigationUrl("https://[fd00::1]"), "https://[fd00::1]/");
});
