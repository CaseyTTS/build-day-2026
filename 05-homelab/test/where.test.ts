import { test } from "node:test";
import assert from "node:assert/strict";
import { detectPlace, report } from "../src/where.js";

test("codespaces wins when its variable is set", () => {
  assert.equal(detectPlace({ CODESPACES: "true" }, true), "codespaces");
});

test("dev container is detected from its marker variable", () => {
  assert.equal(detectPlace({ DEVCONTAINER: "true" }, true), "dev-container");
});

test("plain container falls back to /.dockerenv", () => {
  assert.equal(detectPlace({}, true), "container");
});

test("otherwise it is the host", () => {
  assert.equal(detectPlace({}, false), "host");
});

test("report names the node version", () => {
  assert.match(report({}), /^node v\d+/);
});
