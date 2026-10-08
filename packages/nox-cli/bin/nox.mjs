#!/usr/bin/env node
// nox — NoX missions and knowledge bases from the terminal and from coding agents.
// No dependencies: Node 18+ (global fetch).

import { execFileSync, spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = process.env.NOX_CONFIG_DIR || join(homedir(), ".nox");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");
const tty = process.stdout.isTTY;
const c = (code) => (s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const dim = c(2), bold = c(1), green = c(32), yellow = c(33), red = c(31), cyan = c(36);

// ── config ────────────────────────────────────────────────────────────────
function readConfig() {
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, "utf8"));
  } catch {
    return {};
  }
}
function writeConfig(cfg) {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2) + "\n", { mode: 0o600 });
}
const cfg = readConfig();
const API = (process.env.NOX_API || cfg.api || "http://localhost:8010").replace(/\/$/, "");
const TOKEN = process.env.NOX_TOKEN || cfg.token;

// ── http ──────────────────────────────────────────────────────────────────
class NoxError extends Error {
  constructor(status, detail) {
    super(detail);
    this.status = status;
  }
}
async function http(path, { method = "GET", json, auth = true, role } = {}) {
  const headers = { Accept: "application/json" };
  if (json !== undefined) headers["Content-Type"] = "application/json";
  if (auth) {
    if (!TOKEN) throw new NoxError(401, "Not signed in. Run: nox login");
    headers.Authorization = `Bearer ${TOKEN}`;
    headers["X-Nox-Role"] = role || flags.role || "developer";
  }
  let res;
  try {
    res = await fetch(API + path, { method, headers, body: json === undefined ? undefined : JSON.stringify(json) });
  } catch (e) {
    throw new NoxError(0, `Can't reach NoX at ${API} (${e.cause?.code || e.message}). Set it with: nox config set api <url>`);
  }
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const detail = body && typeof body === "object" ? (typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail)) : text;
    throw new NoxError(res.status, res.status === 401 && auth ? `${detail || "Unauthorized"} — run: nox login` : detail || res.statusText);
  }
  return body;
}

// ── args ──────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flags = {};
const args = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith("--")) {
    const [k, v] = a.slice(2).split("=", 2);
    if (v !== undefined) flags[k] = v;
    else if (argv[i + 1] && !argv[i + 1].startsWith("--")) flags[k] = argv[++i];
    else flags[k] = true;
  } else args.push(a);
}
const [cmd = "help", ...rest] = args;

const missionKey = (k) => {
  if (!k || !/^nox-\d+$/i.test(k)) throw new NoxError(2, "Give a mission key, like NOX-12");
  return k.toUpperCase();
};
const git = (...a) => {
  try {
    return execFileSync("git", a, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function openBrowser(url) {
  const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const a = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    spawn(opener, a, { stdio: "ignore", detached: true }).unref();
  } catch {
    /* the URL is printed anyway */
  }
}

// Where each agent keeps MCP servers, and the shape of NoX's entry (Streamable HTTP + headers).
function mcpConfigs(url, headers) {
  return {
    antigravity: { label: "Antigravity", path: join(homedir(), ".gemini", "config", "mcp_config.json"), entry: { serverUrl: url, headers } },
    gemini: { label: "Gemini CLI", path: join(homedir(), ".gemini", "settings.json"), entry: { httpUrl: url, headers } },
    claude: { label: "Claude Code", path: join(homedir(), ".claude.json"), entry: { type: "http", url, headers } },
    cursor: { label: "Cursor", path: join(homedir(), ".cursor", "mcp.json"), entry: { url, headers } },
  };
}

// Gemini CLI extension: NoX's MCP server, the workflow as context, and /nox. Written under ~/.nox with this
// user's API and token filled in, then linked into Gemini CLI so a later `nox init gemini` updates it in place.
function installGeminiExtension(src) {
  const dir = join(CONFIG_DIR, "gemini", "nox");
  mkdirSync(join(dir, "commands"), { recursive: true });
  const manifest = JSON.parse(readFileSync(src("gemini/gemini-extension.json"), "utf8"));
  if (TOKEN) {
    const role = String(flags.role || "developer");
    manifest.mcpServers.nox.httpUrl = `${API}/mcp`;
    manifest.mcpServers.nox.headers = { Authorization: `Bearer ${TOKEN}`, "X-Nox-Role": role };
  } else {
    delete manifest.mcpServers;
    console.log(yellow("!"), "Not signed in: /nox is installed without NoX's MCP tools. Run nox login, then nox init gemini again.");
  }
  writeFileSync(join(dir, "gemini-extension.json"), JSON.stringify(manifest, null, 2) + "\n", { mode: 0o600 });
  copyFileSync(src("gemini/GEMINI.md"), join(dir, "GEMINI.md"));
  copyFileSync(src("gemini/commands/nox.toml"), join(dir, "commands", "nox.toml"));
  console.log(green("✓"), `Gemini CLI extension: ${dir}`);

  const settingsPath = join(homedir(), ".gemini", "settings.json");
  try {
    if (JSON.parse(readFileSync(settingsPath, "utf8")).mcpServers?.nox) {
      console.log(dim(`  ${settingsPath} also has a "nox" MCP server (from nox mcp install gemini). Gemini CLI uses that one; both reach the same NoX.`));
    }
  } catch {
    /* no settings yet */
  }
  if (flags["no-link"] || process.env.NOX_NO_LINK) return console.log(dim(`  Link it yourself: gemini extensions link ${dir}`));
  if (existsSync(join(homedir(), ".gemini", "extensions", "nox"))) return console.log(dim("  Already linked: Gemini CLI picks up the new files on its next start."));
  try {
    execFileSync("gemini", ["extensions", "link", dir, "--consent"], { stdio: ["ignore", "ignore", "pipe"] });
    console.log(green("✓"), "Linked into Gemini CLI. Start gemini in a repo and run /nox NOX-<n>.");
  } catch {
    console.log(yellow("!"), `Couldn't run gemini. Install Gemini CLI, then: gemini extensions link ${dir}`);
  }
}

// ── commands ──────────────────────────────────────────────────────────────
const commands = {
  async login() {
    if (flags.api) {
      cfg.api = String(flags.api).replace(/\/$/, "");
      writeConfig(cfg);
    }
    const api = cfg.api || API;
    if (flags.token) {
      writeConfig({ ...cfg, api, token: String(flags.token) });
      console.log(green("✓"), "Token saved to", CONFIG_FILE);
      return;
    }
    const res = await fetch(`${api}/api/v1/cli/device`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: `nox CLI on ${hostname().split(".")[0]}` }) }).catch((e) => {
      throw new NoxError(0, `Can't reach NoX at ${api} (${e.cause?.code || e.message})`);
    });
    if (!res.ok) throw new NoxError(res.status, "Couldn't start sign-in");
    const d = await res.json();
    console.log(`\n  Open ${cyan(d.verifyUrl)}\n  and check it shows ${bold(d.userCode)}\n`);
    if (!flags["no-browser"]) openBrowser(d.verifyUrl);
    const until = Date.now() + d.expiresIn * 1000;
    while (Date.now() < until) {
      await sleep(d.interval * 1000);
      const r = await fetch(`${api}/api/v1/cli/device/token`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deviceCode: d.deviceCode }) });
      if (r.status === 428) continue;
      if (!r.ok) throw new NoxError(r.status, "The code expired. Run nox login again.");
      const t = await r.json();
      writeConfig({ ...cfg, api, token: t.token, email: t.email });
      console.log(green("✓"), `Signed in as ${t.email}`);
      return;
    }
    throw new NoxError(1, "Timed out waiting for approval");
  },

  async logout() {
    delete cfg.token;
    delete cfg.email;
    writeConfig(cfg);
    console.log(green("✓"), "Signed out (the token still exists; revoke it in NoX if this machine is lost)");
  },

  async whoami() {
    const me = await http("/api/v1/me");
    console.log(`${me.email}  ${dim(`· ${API}`)}`);
    console.log(dim(`orgs: ${me.orgs.map((o) => o.name).join(", ") || "—"}`));
  },

  async config() {
    const [action, key, value] = rest;
    if (action === "set" && key === "api" && value) {
      writeConfig({ ...cfg, api: value.replace(/\/$/, "") });
      console.log(green("✓"), `api = ${value}`);
    } else if (action === "get" || !action) {
      console.log(JSON.stringify({ api: API, signedIn: Boolean(TOKEN), email: cfg.email ?? null, file: CONFIG_FILE }, null, 2));
    } else throw new NoxError(2, "Usage: nox config [get] | nox config set api <url>");
  },

  async missions() {
    const view = flags.view || "all";
    const list = await http(`/api/v1/missions?view=${encodeURIComponent(view)}`);
    if (flags.json) return console.log(JSON.stringify(list, null, 2));
    if (!list.length) return console.log(dim("No missions in this view."));
    for (const m of list) {
      const apps = m.apps.map((a) => a.name).join(", ");
      console.log(`${bold(m.key.padEnd(8))} ${m.stage.padEnd(11)} ${m.title}  ${dim(apps)}`);
    }
  },

  async context() {
    const key = missionKey(rest[0]);
    const ctx = await http(`/api/v1/cli/missions/${key}/context`);
    if (flags.save) {
      const root = git("rev-parse", "--show-toplevel") || process.cwd();
      const out = join(root, ".nox", "missions", `${key}.md`);
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, ctx.markdown + "\n");
      console.error(green("✓"), `Saved ${out}`);
    }
    if (flags.json) console.log(JSON.stringify(ctx, null, 2));
    else if (!flags.save || flags.print) console.log(ctx.markdown);
  },

  async discover() {
    const remote = flags.repo || git("remote", "get-url", "origin");
    if (!remote) throw new NoxError(2, "No git remote here. Pass --repo <url>.");
    const r = await http(`/api/v1/cli/kb/discover?repo_url=${encodeURIComponent(remote)}`);
    if (flags.json) return console.log(JSON.stringify(r, null, 2));
    if (r.found) {
      console.log(green("✓"), `This repo is ${bold(r.app_name)} in ${r.org_name ?? "?"}  ${dim(r.kb_repo_url ?? "")}`);
      if (r.linked_kbs?.length) console.log(dim(`  also in the org: ${r.linked_kbs.map((k) => k.app_name).join(", ")}`));
    } else {
      console.log(yellow("!"), "No knowledge base matches this repo's remote.");
      for (const s of r.suggestions ?? []) console.log(`  • ${s.app_name} ${dim(s.org_name ?? "")}`);
    }
  },

  async kbs() {
    const list = await http("/api/v1/cli/kb/list");
    if (flags.json) return console.log(JSON.stringify(list, null, 2));
    if (!list.length) return console.log(dim("No knowledge bases you can see yet."));
    for (const k of list) console.log(`${bold(k.app_name.padEnd(32))} ${k.status.padEnd(12)} ${dim(k.org_name ?? "")}`);
  },

  async search() {
    const q = rest.join(" ").trim();
    if (!q) throw new NoxError(2, "Usage: nox search <words> [--app <name>]");
    const hits = await http(`/api/v1/cli/kb/search?q=${encodeURIComponent(q)}${flags.app ? `&app=${encodeURIComponent(flags.app)}` : ""}`);
    if (flags.json) return console.log(JSON.stringify(hits, null, 2));
    if (!hits.length) return console.log(dim("No matching pages."));
    for (const h of hits) console.log(`${cyan(h.ref)}\n  ${dim(h.snippet.replace(/\s+/g, " ").slice(0, 220))}\n`);
    console.log(dim("Read one with: nox read <app/path>"));
  },

  async read() {
    const ref = rest[0];
    if (!ref) throw new NoxError(2, "Usage: nox read <app/path>  (as in [[kb:app/path]])");
    const page = await http(`/api/v1/cli/kb/read?ref=${encodeURIComponent(ref)}`);
    console.log(page.markdown);
  },

  async pr() {
    const key = missionKey(rest[0]);
    let url = rest[1];
    if (!url) {
      try {
        url = execFileSync("gh", ["pr", "view", "--json", "url", "-q", ".url"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      } catch {
        /* no gh or no PR for this branch */
      }
    }
    if (!url) throw new NoxError(2, "Usage: nox pr NOX-12 <pull request url>");
    await http(`/api/v1/cli/missions/${key}/prs`, { method: "POST", json: { url } });
    console.log(green("✓"), `${url} linked to ${key}; NoX's guard comment follows on the PR`);
  },

  async complete() {
    const key = missionKey(rest[0]);
    await http(`/api/v1/missions/${key}/complete`, { method: "POST", role: "developer" });
    console.log(green("✓"), `${key} marked as completed — the verification checklists open in NoX, yours first`);
  },

  async init() {
    const agent = rest[0];
    const root = git("rev-parse", "--show-toplevel") || process.cwd();
    const src = (p) => join(HERE, "..", "integrations", p);
    const put = (from, to, { append = false } = {}) => {
      mkdirSync(dirname(to), { recursive: true });
      const body = readFileSync(src(from), "utf8");
      if (append && existsSync(to)) {
        const cur = readFileSync(to, "utf8");
        if (cur.includes("<!-- nox -->")) return console.log(dim(`= ${to} already has the NoX section`));
        writeFileSync(to, cur.trimEnd() + "\n\n" + body);
      } else copyFileSync(src(from), to);
      console.log(green("✓"), to);
    };
    const targets = {
      antigravity: () => put("antigravity/SKILL.md", join(homedir(), ".gemini", "config", "skills", "nox", "SKILL.md")),
      cursor: () => put("cursor/nox.mdc", join(root, ".cursor", "rules", "nox.mdc")),
      codex: () => put("codex/AGENTS.md", join(root, "AGENTS.md"), { append: true }),
      copilot: () => put("copilot/copilot-instructions.md", join(root, ".github", "copilot-instructions.md"), { append: true }),
      gemini: () => installGeminiExtension(src),
      claude: () => {
        put("claude/nox-command.md", join(root, ".claude", "commands", "nox.md"));
        put("claude/SKILL.md", join(root, ".claude", "skills", "nox", "SKILL.md"));
      },
    };
    if (agent === "all") return Object.values(targets).forEach((f) => f());
    if (!targets[agent]) throw new NoxError(2, `Usage: nox init <${Object.keys(targets).join("|")}|all>`);
    targets[agent]();
    console.log(dim(`Now ask your agent: /nox NOX-<n>  (or "work on NOX-<n>")`));
  },

  // ── NoX Local: build and maintain a knowledge base on this machine with Gemma ──
  async kb() {
    const sub = rest[0] || "status";
    const root = git("rev-parse", "--show-toplevel") || process.cwd();
    const kbDir = join(root, ".nox", "kb");
    const manifestPath = join(kbDir, "nox-kb.json");
    const model = String(flags.model || process.env.NOX_LOCAL_MODEL || "gemma4:12b").replace(/^ollama(_chat)?\//, "");
    const engine = process.env.NOX_ENGINE_DIR || resolve(HERE, "..", "..", "..", "apps", "api");

    const ensureOllama = async () => {
      const base = process.env.OLLAMA_HOST || "http://localhost:11434";
      let tags;
      try {
        tags = await (await fetch(`${base}/api/tags`)).json();
      } catch {
        throw new NoxError(1, `Ollama isn't running at ${base}. Install it from ollama.com, then run: ollama serve`);
      }
      const have = (tags.models || []).some((m) => m.name === model || m.name === `${model}:latest`);
      if (!have) {
        if (flags["no-pull"]) throw new NoxError(1, `${model} isn't pulled. Run: ollama pull ${model}`);
        console.error(dim(`Pulling ${model} (first run only)…`));
        execFileSync("ollama", ["pull", model], { stdio: "inherit" });
      }
    };

    const engineRun = (args) =>
      new Promise((ok, fail) => {
        if (!existsSync(join(engine, "pyproject.toml"))) return fail(new NoxError(1, `NoX's engine isn't at ${engine}. Set NOX_ENGINE_DIR.`));
        const child = spawn("uv", ["run", "--quiet", "--directory", engine, "--extra", "local", "python", "-m", "nox_api.local", ...args], {
          stdio: ["ignore", "pipe", flags.quiet ? "ignore" : "inherit"],
          env: { ...process.env, NOX_LOCAL_MODEL: `ollama_chat/${model}`, PYTHONWARNINGS: "ignore" },
        });
        let out = "";
        child.stdout.on("data", (d) => (out += d));
        child.on("error", (e) => fail(new NoxError(1, e.code === "ENOENT" ? "NoX Local needs uv (docs.astral.sh/uv)" : e.message)));
        child.on("close", () => {
          const last = out.trim().split("\n").filter(Boolean).pop() || "{}";
          try {
            const r = JSON.parse(last);
            r.ok ? ok(r) : fail(new NoxError(1, r.error || "NoX Local failed"));
          } catch {
            fail(new NoxError(1, out.slice(-400) || "NoX Local failed"));
          }
        });
      });

    const appName = async () => {
      if (flags.app) return String(flags.app);
      if (existsSync(manifestPath)) return JSON.parse(readFileSync(manifestPath, "utf8")).app;
      try {
        const remote = git("remote", "get-url", "origin");
        if (remote && TOKEN) {
          const r = await http(`/api/v1/cli/kb/discover?repo_url=${encodeURIComponent(remote)}`);
          if (r.found) return r.app_name;
        }
      } catch {
        /* fall through */
      }
      return root.split("/").pop();
    };

    const readKb = () => {
      const files = {};
      const walk = (dir) => {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
          const p = join(dir, e.name);
          if (e.isDirectory()) walk(p);
          else if (e.name.endsWith(".md")) files[relative(kbDir, p).split("\\").join("/")] = readFileSync(p, "utf8");
        }
      };
      if (existsSync(kbDir)) walk(kbDir);
      return files;
    };

    const push = async (only) => {
      const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : {};
      let files = readKb();
      if (only) files = Object.fromEntries(Object.entries(files).filter(([p]) => only.includes(p)));
      if (!Object.keys(files).length) throw new NoxError(1, "Nothing to push. Run: nox kb build");
      const r = await http("/api/v1/cli/kb/push", {
        method: "POST",
        json: { app: manifest.app || (await appName()), files, meta: { ...manifest, mode: only ? "sync" : "build" } },
      });
      console.log(green("✓"), `Pushed ${r.pages} pages (${r.contracts} contracts). Review: ${cyan(r.pr_url)}`);
    };

    if (sub === "build") {
      await ensureOllama();
      const app = await appName();
      console.error(dim(`Building ${app}'s knowledge base with ${model}. Your code stays on this machine.`));
      const r = await engineRun(["build", "--path", root, "--app", app]);
      console.log(green("✓"), `${r.pages} pages in ${relative(process.cwd(), r.kb_dir) || r.kb_dir} ${dim(`(${r.files_read} files · ${r.usage} · ${r.seconds}s)`)}`);
      if (flags.push) await push();
      else console.log(dim("  Review them, then: nox kb push"));
    } else if (sub === "sync") {
      await ensureOllama();
      const r = await engineRun(["sync", "--path", root, ...(flags.since ? ["--since", String(flags.since)] : [])]);
      if (r.decision === "significant") {
        console.log(green("✓"), `Updated ${r.changed.length} page(s): ${r.changed.join(", ")} ${dim(`(${r.reason})`)}`);
        if (flags.push && r.changed.length) await push(r.changed);
      } else console.log(dim(`No knowledge-base change needed${r.reason ? `: ${r.reason}` : ""}.`));
    } else if (sub === "push") {
      await push();
    } else if (sub === "watch") {
      const hook = join(root, ".git", "hooks", "post-commit");
      const marker = "# nox kb watch";
      const line = `${marker}\n(nox kb sync --push --quiet >> "$(git rev-parse --show-toplevel)/.nox/watch.log" 2>&1 &)\n`;
      const current = existsSync(hook) ? readFileSync(hook, "utf8") : "#!/bin/sh\n";
      if (flags.off) {
        writeFileSync(hook, current.replace(new RegExp(`${marker}\\n[^\\n]*\\n`), ""));
        return console.log(green("✓"), "Stopped watching commits.");
      }
      if (!current.includes(marker)) writeFileSync(hook, current.trimEnd() + "\n" + line, { mode: 0o755 });
      chmodSync(hook, 0o755);
      console.log(green("✓"), `Watching commits: after each one, Gemma updates the knowledge base here and NoX opens a KB PR. ${dim("(nox kb watch --off to stop · log: .nox/watch.log)")}`);
    } else if (sub === "status") {
      if (!existsSync(manifestPath)) return console.log(dim("No local knowledge base yet. Run: nox kb build"));
      const m = JSON.parse(readFileSync(manifestPath, "utf8"));
      console.log(`${bold(m.app)}  ${m.pages?.length ?? 0} pages · built with ${m.model} · at ${m.commit?.slice(0, 7)} ${dim(m.synced_at || m.built_at || "")}`);
    } else throw new NoxError(2, "Usage: nox kb <build|sync|push|watch|status> [--app x] [--model gemma4:12b] [--push]");
  },

  // ── Agents calling NoX over MCP ──
  async mcp() {
    const sub = rest[0] || "show";
    if (!TOKEN) throw new NoxError(1, "Not signed in. Run: nox login  (the MCP settings carry your NoX token)");
    const url = `${API}/mcp`;
    const role = String(flags.role || "developer");
    const headers = { Authorization: `Bearer ${TOKEN}`, "X-Nox-Role": role };
    const configs = mcpConfigs(url, headers);
    if (sub === "show" || sub === "config") {
      if (flags.json) return console.log(JSON.stringify(Object.fromEntries(Object.entries(configs).map(([k, v]) => [k, v.entry])), null, 2));
      console.log(`\n  NoX MCP server: ${cyan(url)}  ${dim(`(seat: ${role}; change with --role)`)}\n`);
      for (const [name, c] of Object.entries(configs)) {
        console.log(`${bold(c.label)}  ${dim(c.path)}`);
        console.log(JSON.stringify({ mcpServers: { nox: c.entry } }, null, 2) + "\n");
      }
      console.log(dim(`Or let nox write it: nox mcp install <${Object.keys(configs).join("|")}>`));
      return;
    }
    if (sub === "install") {
      const target = rest[1];
      const names = target === "all" ? Object.keys(configs) : [target];
      if (!names.every((n) => configs[n])) throw new NoxError(2, `Usage: nox mcp install <${Object.keys(configs).join("|")}|all> [--role developer]`);
      for (const n of names) {
        const { path, entry } = configs[n];
        let current = {};
        if (existsSync(path)) {
          try {
            current = JSON.parse(readFileSync(path, "utf8") || "{}");
          } catch {
            throw new NoxError(1, `${path} isn't valid JSON; fix it or add the settings by hand (nox mcp).`);
          }
        }
        // Merge: other servers and settings in the file are left exactly as they were.
        const next = { ...current, mcpServers: { ...(current.mcpServers || {}), nox: entry } };
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, JSON.stringify(next, null, 2) + "\n", { mode: 0o600 });
        console.log(green("✓"), `${configs[n].label}: ${path}`);
      }
      console.log(dim("Restart the agent (or reload its MCP servers) to pick up NoX's tools."));
      return;
    }
    throw new NoxError(2, "Usage: nox mcp [--role <seat>] | nox mcp install <antigravity|gemini|claude|cursor|all>");
  },

  help() {
    console.log(`
${bold("nox")} — NoX missions and knowledge bases, in your terminal and your coding agent

  ${bold("nox login")} [--api <url>]        Sign in through the browser (or --token nox_…)
  ${bold("nox whoami")}                      Who you are and which NoX you talk to
  ${bold("nox missions")} [--view waiting|flight|back|mine]
  ${bold("nox context")} NOX-12 [--save]     Spec files + knowledge base for a mission (for agents)
  ${bold("nox search")} <words> [--app x]    Search the knowledge bases you can see
  ${bold("nox read")} <app/path>             Print one knowledge base page ([[kb:app/path]])
  ${bold("nox discover")}                    Which app is this repo?
  ${bold("nox kbs")}                         Knowledge bases you can see
  ${bold("nox pr")} NOX-12 [<pr url>]        Link a pull request (NoX posts a guard comment)
  ${bold("nox complete")} NOX-12             Mark as completed → verification checklists open
  ${bold("nox init")} <antigravity|gemini|cursor|codex|copilot|claude|all>   Install /nox for an agent
  ${bold("nox kb build")} [--push]            Build this repo's knowledge base locally with Gemma (code stays here)
  ${bold("nox kb sync")} [--push]             Update pages for new commits;  ${bold("nox kb watch")} does it on every commit
  ${bold("nox kb push")}                     Send the local pages to NoX (a KB pull request); ${bold("nox kb status")}
  ${bold("nox mcp")} [--role developer]      MCP settings for Antigravity, Gemini CLI, Claude Code, Cursor
  ${bold("nox mcp install")} <agent|all>     Write them into the agent's MCP settings (other servers kept)
  ${bold("nox config")} [set api <url>]

${dim(`api: ${API}   config: ${CONFIG_FILE}   --json on most commands`)}
`);
  },
};

const run = commands[cmd] || commands[{ ls: "missions", m: "missions", ctx: "context", s: "search", cat: "read", done: "complete", "--help": "help", "-h": "help" }[cmd]];
if (cmd === "--version" || cmd === "-v" || cmd === "version") {
  console.log(JSON.parse(readFileSync(resolve(HERE, "..", "package.json"), "utf8")).version);
} else if (!run) {
  console.error(red("✗"), `Unknown command: ${cmd}. Run nox help`);
  process.exit(2);
} else {
  Promise.resolve(run()).catch((e) => {
    console.error(red("✗"), e.message);
    process.exit(e instanceof NoxError && e.status === 2 ? 2 : 1);
  });
}
