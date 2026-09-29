import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const bin = fileURLToPath(new URL("../bin/nox.mjs", import.meta.url));
const env = { ...process.env, NOX_CONFIG_DIR: mkdtempSync(join(tmpdir(), "noxcfg-")), NOX_API: "http://127.0.0.1:9", NOX_TOKEN: "" };
const nox = (...a) => spawnSync(process.execPath, [bin, ...a], { env, encoding: "utf8" });

test("help lists the commands", () => {
  const r = nox("help");
  assert.equal(r.status, 0);
  for (const c of ["login", "context", "search", "pr", "complete", "init"]) assert.match(r.stdout, new RegExp(`nox ${c}`));
});

test("bad mission keys are usage errors", () => {
  const r = nox("context", "nope");
  assert.equal(r.status, 2);
  assert.match(r.stderr, /mission key/);
});

test("commands needing auth say how to sign in", () => {
  const r = nox("missions");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /nox login/);
});

test("unknown commands fail", () => {
  assert.equal(nox("frobnicate").status, 2);
});
