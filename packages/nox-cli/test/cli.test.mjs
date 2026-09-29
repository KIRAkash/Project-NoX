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

test("nox mcp prints settings and install merges without touching other servers", async () => {
  const { mkdirSync, readFileSync, writeFileSync } = await import("node:fs");
  const home = mkdtempSync(join(tmpdir(), "noxhome-"));
  const e = { ...env, HOME: home, NOX_TOKEN: "nox_test", NOX_API: "https://nox.example.com" };
  const run = (...a) => spawnSync(process.execPath, [bin, ...a], { env: e, encoding: "utf8" });
  const shown = JSON.parse(run("mcp", "--json").stdout);
  assert.equal(shown.antigravity.serverUrl, "https://nox.example.com/mcp");
  assert.equal(shown.claude.headers.Authorization, "Bearer nox_test");
  mkdirSync(join(home, ".cursor"), { recursive: true });
  writeFileSync(join(home, ".cursor", "mcp.json"), JSON.stringify({ mcpServers: { other: { url: "x" } }, theme: "dark" }));
  assert.equal(run("mcp", "install", "cursor", "--role", "engineering").status, 0);
  const file = JSON.parse(readFileSync(join(home, ".cursor", "mcp.json"), "utf8"));
  assert.deepEqual(file.mcpServers.other, { url: "x" });
  assert.equal(file.theme, "dark");
  assert.equal(file.mcpServers.nox.headers["X-Nox-Role"], "engineering");
  assert.equal(run("mcp", "install", "nope").status, 2);
});
