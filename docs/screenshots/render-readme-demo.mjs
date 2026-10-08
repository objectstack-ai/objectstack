#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// render-readme-demo — record the README's demo GIF from a really running app,
// then assemble it into the committed `docs/screenshots/readme-demo.gif`.
//
//   node docs/screenshots/render-readme-demo.mjs              # write the committed GIF
//   node docs/screenshots/render-readme-demo.mjs --out <dir>  # preview: GIF + every frame into <dir>, touch nothing committed
//
// Prerequisites are the ones `pnpm dev` itself has, and it checks them itself:
// a built workspace (`pnpm build`) and a built Console (`pnpm objectui:build`).
// Plus `ffmpeg` on PATH, which assembles the GIF.
//
// ## What it records — three beats and a closing frame
//
//   1. The app runs. The Team object exactly as `examples/app-showcase` defines
//      it (comment lines omitted, and the frame says so), then
//      `pnpm dev:showcase -- --fresh -p <port>` booting it, then the Console's
//      Team list.
//   2. An agent creates a record over MCP. A JSON-RPC `tools/call` of
//      `create_record` against the running app's `/api/v1/mcp`, sent with an
//      API key minted for the seeded dev admin; then the Console list showing
//      the new row, and the record page's "Created by".
//   3. A read-only identity is refused. The byte-identical call sent with a key
//      minted for the showcase's Auditor persona (it reads every Team row and
//      holds no create grant); then the Console list, unchanged.
//   Closing frame: the slogan and the four promises, verbatim from README.md.
//
// How: boot the showcase on an ephemeral state root (`--fresh`: a temp OS_HOME
// and database, deleted on exit), sign in through the real auth API, mint both
// keys through the documented `POST /api/v1/keys` (content/docs/ai/connect-mcp.mdx),
// make the two MCP calls with `fetch`, screenshot the real Console with the
// preinstalled Chromium, render every frame as an HTML page and screenshot it,
// and hand the frames to ffmpeg (palettegen + paletteuse).
//
// Only packages the repository already holds are used, resolved from the
// packages that declare them: Playwright's `chromium` from
// `examples/app-showcase` (`@playwright/test`) and `sharp` from the docs app's
// Next dependency. The browser binary is the preinstalled one under
// `PLAYWRIGHT_BROWSERS_PATH` (default `/opt/pw-browsers`); this script never
// runs `playwright install`. ffmpeg is the system binary.
//
// Typography: the frames this script draws (code, terminal, MCP panels,
// captions, the closing frame) use Inter and IBM Plex Mono from Google Fonts,
// the hero cover's pair (`hero-cover-dark.html`); the Console screenshots carry
// the Console's own fonts. No font file is committed for this.
//
// ## Honesty rules this script enforces rather than trusts
//
//   - Every browser frame is a screenshot of the real Console against the app
//     this run booted. The outline drawn around the new row and around the
//     record count is the only thing added on top of a screenshot.
//   - The request panel shows the bytes that were sent (the body is sent
//     pretty-printed, exactly as shown; the API key is masked after its public
//     prefix). The response panel shows the bytes that came back, with one
//     re-layout for legibility: the escapes inside `result.content[0].text`
//     (backslash-n, backslash-quote) are drawn as the characters they encode.
//   - Terminal output is lines this run's dev server printed, picked by pattern
//     in their original order; a dim ellipsis marks every gap. A pattern that
//     no longer matches is a refusal, never a stand-in line.
//   - No assistant chat transcript, no model identifier, no record the run did
//     not create. The caller is "an agent" / "any MCP client".
//
// ## Refusals — each one loud, because a demo that lies ships to every visitor
//
//   exit 2  no preinstalled Chromium, or no ffmpeg on PATH;
//   exit 3  the web fonts (Inter, IBM Plex Mono — the hero cover's) did not
//           load: the committed GIF is not written, `--out` previews the
//           system fallback (Liberation Sans / DejaVu Sans Mono);
//   exit 4  the dev server did not come up, or a sign-in or key mint failed;
//   exit 5  the story is not what this run observed: the admin's call did not
//           create the row, the read-only identity cannot read the object (so
//           "read-only" would mislabel it), its create was NOT refused, a pinned
//           terminal line is missing, or the record count moved on the refusal;
//   exit 6  the GIF is out of spec: not 1200 px wide, outside 20-35 s, or over
//           the 4,000,000-byte hard cap (over 3,000,000 bytes only warns).
//
// Byte-identity across runs is not a goal (ids, timestamps and the port
// differ); the beats are. The showcase's own external datasource file under
// `examples/app-showcase/.objectstack/` (gitignored) outlives the run, as
// `--fresh` documents for any app-relative path.

import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const GIF = join(HERE, 'readme-demo.gif');
const OBJECT_SOURCE = join(REPO, 'examples', 'app-showcase', 'src', 'data', 'objects', 'team.object.ts');
const OBJECT_SOURCE_LABEL = 'examples/app-showcase/src/data/objects/team.object.ts';

const W = 1200;
const H = 675;
const MIN_SECONDS = 20;
const MAX_SECONDS = 35;
const SOFT_BYTES = 3_000_000;
const HARD_BYTES = 4_000_000;

const APP_ID = 'com.example.showcase';
const OBJECT = 'showcase_team';
// The dev admin `--fresh` seeds (packages/cli `dev --seed-admin`) and the
// showcase's Auditor persona (examples/app-showcase/src/security/demo-personas.ts:
// `auditor` position only, so `showcase_auditor` plus the member baseline, which
// grants Team read and no create). Both are dev-only, well-known credentials.
const ADMIN = { email: 'admin@objectos.ai', password: 'admin123' };
const READ_ONLY = { email: 'auditor.demo@example.com', password: 'showcase123' };
const NEW_TEAM = { name: 'Data Guild', lead: 'ada@example.com', capacity_hours: 120 };

// Sent exactly as written, and drawn exactly as written.
const CALL_BODY = `{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "create_record",
    "arguments": {
      "objectName": "${OBJECT}",
      "data": {
        "name": "${NEW_TEAM.name}",
        "lead": "${NEW_TEAM.lead}",
        "capacity_hours": ${NEW_TEAM.capacity_hours}
      }
    }
  }
}`;

// Terminal lines the boot frame shows, matched against this run's output in
// order. `through` extends a match to the line that satisfies it.
const BOOT_LINES = [
  { re: /Fresh OS_HOME: /, through: /Database: file:/ },
  { re: /✓ Server is ready$/, through: /➜\s+MCP:\s+http/ },
  { re: /^Plugins:\s+\d+ loaded$/ },
  { re: /^Seeds:\s+\S+ \d+ rows$/ },
];

class Refusal extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const outDir = opt('--out') ? resolve(opt('--out')) : undefined;
const gifOut = outDir ? join(outDir, 'readme-demo.gif') : GIF;
const workDir = outDir ?? mkdtempSync(join(tmpdir(), 'readme-demo-'));
const framesDir = join(workDir, 'frames');
mkdirSync(framesDir, { recursive: true });

const playwrightRequire = createRequire(join(REPO, 'examples', 'app-showcase', 'package.json'));
const { chromium } = playwrightRequire('@playwright/test');
const nextManifest = createRequire(join(REPO, 'apps', 'docs', 'package.json')).resolve('next/package.json');
const sharp = createRequire(nextManifest)('sharp');

const log = (line) => console.log(line);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// ANSI escape sequences (FORCE_COLOR=0 should leave none; this is the belt).
const stripAnsi = (s) => s.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '');

// ── the dev server ───────────────────────────────────────────────────────────

let server;
let serverOutput = '';
let serverExited = false;

function freePort() {
  return new Promise((ok, fail) => {
    const s = createServer();
    s.once('error', fail);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => ok(port)); });
  });
}

function killServer(signal) {
  if (!server || serverExited) return;
  try { process.kill(-server.pid, signal); } catch { /* group already gone */ }
}

async function stopServer() {
  if (!server || serverExited) return;
  killServer('SIGTERM');
  for (let i = 0; i < 60 && !serverExited; i++) await sleep(250);
  if (!serverExited) killServer('SIGKILL');
}

process.on('exit', () => killServer('SIGKILL'));
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { killServer('SIGTERM'); process.exit(130); });
}

async function bootServer(port) {
  const argv = ['dev:showcase', '--', '--fresh', '-p', String(port)];
  log(`→ pnpm ${argv.join(' ')}`);
  server = spawn('pnpm', argv, {
    cwd: REPO,
    detached: true, // its own process group, so teardown reaches the serve child too
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
  });
  server.stdout.on('data', (d) => { serverOutput += d; });
  server.stderr.on('data', (d) => { serverOutput += d; });
  server.on('exit', () => { serverExited = true; });
  const deadline = Date.now() + 300_000;
  while (Date.now() < deadline) {
    if (serverExited) break;
    if (/Press Ctrl\+C to stop/.test(serverOutput)) {
      const res = await fetch(`http://localhost:${port}/api/v1/ready`).catch(() => undefined);
      if (res?.ok) return `pnpm ${argv.join(' ')}`;
    }
    await sleep(500);
  }
  const tail = stripAnsi(serverOutput).split('\n').slice(-25).join('\n');
  throw new Refusal(4, `the dev server did not come up on :${port}${serverExited ? ' (it exited)' : ''}:\n${tail}`);
}

function pickBootLines() {
  const lines = stripAnsi(serverOutput).split('\n').map((l) => l.replace(/\s+$/, ''));
  const picked = [];
  let from = 0;
  for (const { re, through } of BOOT_LINES) {
    const at = lines.findIndex((l, i) => i >= from && re.test(l.trim()));
    if (at < 0) throw new Refusal(5, `no line of this run's dev-server output matches ${re} — the boot frame shows only printed lines`);
    let end = at;
    if (through) {
      end = lines.findIndex((l, i) => i > at && through.test(l.trim()));
      if (end < 0) throw new Refusal(5, `no line after "${lines[at].trim()}" matches ${through}`);
    }
    if (picked.length && at > picked[picked.length - 1].index + 1) picked.push({ gap: true });
    for (let i = at; i <= end; i++) picked.push({ index: i, text: lines[i] });
    from = end + 1;
  }
  return picked;
}

// ── the API: sign-in, keys, MCP ──────────────────────────────────────────────

async function signIn(browser, base, who) {
  const ctx = await browser.newContext();
  const res = await ctx.request.post(`${base}/api/v1/auth/sign-in/email`, { data: who });
  if (!res.ok()) throw new Refusal(4, `sign-in as ${who.email} answered ${res.status()}: ${await res.text()}`);
  const user = (await res.json()).user;
  const token = res.headers()['set-auth-token'];
  const mint = await ctx.request.post(`${base}/api/v1/keys`, { data: { name: 'readme-demo' } });
  if (!mint.ok()) throw new Refusal(4, `POST /api/v1/keys as ${who.email} answered ${mint.status()}: ${await mint.text()}`);
  const key = (await mint.json()).data;
  if (!key?.key?.startsWith('osk_') || !key.prefix) throw new Refusal(4, `POST /api/v1/keys as ${who.email} returned no osk_ key`);
  const state = await ctx.storageState();
  await ctx.close();
  return {
    user,
    key: key.key,
    prefix: key.prefix,
    storageState: { cookies: state.cookies, origins: [{ origin: base, localStorage: [{ name: 'auth-session-token', value: token }] }] },
  };
}

async function mcpCall(base, key, body) {
  JSON.parse(body); // never send what is not JSON
  const started = Date.now();
  const res = await fetch(`${base}/api/v1/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'x-api-key': key },
    body,
  });
  const raw = await res.text();
  const ms = Date.now() - started;
  let rpc;
  try { rpc = JSON.parse(raw); } catch { throw new Refusal(5, `the MCP endpoint answered non-JSON (${res.status}): ${raw.slice(0, 300)}`); }
  return { status: res.status, statusText: res.statusText, contentType: res.headers.get('content-type'), raw, ms, rpc };
}

async function countRows(base, key) {
  const res = await fetch(`${base}/api/v1/data/${OBJECT}`, { headers: { 'x-api-key': key } });
  if (!res.ok) throw new Refusal(5, `GET /api/v1/data/${OBJECT} answered ${res.status}`);
  return (await res.json()).records.length;
}

// ── the Console ──────────────────────────────────────────────────────────────

const SHOT = { width: 1152, height: 540, scale: 1.125 }; // a 1024 x 480 viewport, drawn at 1152 x 540

async function consoleShot(page, url, name, { waitText, outline }) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.getByText(waitText, { exact: true }).first().waitFor({ timeout: 60_000 });
  await page.waitForLoadState('networkidle').catch(() => {});
  const nav = page.getByRole('link', { name: 'Teams', exact: true }).first();
  if (await nav.count()) await nav.scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(800);
  const path = join(framesDir, `console-${name}.png`);
  await page.screenshot({ path, animations: 'disabled', caret: 'hide' });
  const meta = await sharp(path).metadata();
  if (meta.width !== SHOT.width || meta.height !== SHOT.height) {
    throw new Refusal(6, `Console screenshot ${name} measures ${meta.width} x ${meta.height}, expected ${SHOT.width} x ${SHOT.height}`);
  }
  let box;
  if (outline) {
    const b = await outline(page).boundingBox();
    if (b) box = { x: b.x * SHOT.scale, y: b.y * SHOT.scale, w: b.width * SHOT.scale, h: b.height * SHOT.scale };
  }
  log(`  console ${name}: ${page.url()}`);
  return { src: `data:image/png;base64,${readFileSync(path).toString('base64')}`, url: page.url(), box };
}

// ── frames ───────────────────────────────────────────────────────────────────

const CSS = `
  :root {
    --bg: #08080f; --card: #12131f; --bar: #171824; --line: #2a2a30;
    --fg: #f5f6fa; --fg-2: #c7cad6; --fg-3: #9598ab;
    --indigo: #818cf8; --violet: #a78bfa; --purple: #bd84fc; --amber: #f5a623;
    --green: #34d399; --red: #f87171;
    --font-sans: Inter, 'Liberation Sans', 'DejaVu Sans', sans-serif;
    --font-mono: 'IBM Plex Mono', 'DejaVu Sans Mono', 'Liberation Mono', monospace;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: ${W}px; height: ${H}px; overflow: hidden; background: var(--bg); color: var(--fg);
    font-family: var(--font-sans); -webkit-font-smoothing: antialiased; }
  #stage { position: absolute; left: 23px; top: 18px; width: 1154px; height: 576px; }
  .win { position: absolute; inset: 0; border-radius: 12px; background: var(--card); border: 1px solid var(--line); overflow: hidden; }
  .bar { height: 34px; display: flex; align-items: center; gap: 8px; padding: 0 14px; background: var(--bar);
    border-bottom: 1px solid var(--line); font: 500 14px var(--font-mono); color: var(--fg-3); white-space: nowrap; }
  .bar i { width: 11px; height: 11px; border-radius: 50%; background: #3a3b4a; flex: none; }
  .bar .title { margin-left: 10px; }
  .bar .url { margin-left: 18px; padding: 3px 14px; border-radius: 7px; background: #0b0c14; color: var(--fg-2); }
  .bar .note { margin-left: auto; color: var(--fg-3); }
  .code, .term { padding: 20px 26px; font: 19px/28px var(--font-mono); white-space: pre; color: var(--fg-2); }
  .term { font-size: 18px; line-height: 26px; }
  .k { color: var(--violet); } .s { color: var(--indigo); } .fn { color: var(--amber); }
  .prompt { color: var(--indigo); } .cmd { color: var(--fg); } .gap { color: #55586b; }
  .ok { color: var(--green); }
  .shot { position: absolute; left: 0; top: 34px; width: 1152px; height: 540px; display: block; }
  .ring { position: absolute; border: 3px solid var(--amber); border-radius: 8px;
    box-shadow: 0 0 0 4px rgba(245, 166, 35, 0.22); }
  .cols { position: absolute; top: 34px; left: 0; right: 0; bottom: 0; display: grid; grid-template-columns: 1fr 1fr; }
  .col { padding: 14px 22px; overflow: hidden; }
  .col + .col { border-left: 1px solid var(--line); }
  .lbl { display: flex; align-items: center; gap: 10px; height: 26px; margin-bottom: 8px;
    font: 600 13px var(--font-sans); letter-spacing: 0.12em; color: var(--fg-3); }
  .who { font: 500 14px var(--font-sans); letter-spacing: 0; color: var(--fg-2); }
  .badge { padding: 3px 10px; border-radius: 6px; font: 600 13px var(--font-mono); letter-spacing: 0; }
  .badge.ok { color: var(--green); background: rgba(52, 211, 153, 0.12); border: 1px solid rgba(52, 211, 153, 0.4); }
  .badge.no { color: var(--red); background: rgba(248, 113, 113, 0.12); border: 1px solid rgba(248, 113, 113, 0.45); }
  .badge.ro { color: var(--amber); background: rgba(245, 166, 35, 0.12); border: 1px solid rgba(245, 166, 35, 0.45); }
  .http { font: 15px/21px var(--font-mono); white-space: pre-wrap; overflow-wrap: anywhere; color: var(--fg-2); }
  .http .h { color: var(--fg-3); }
  .http .hl { background: rgba(129, 140, 248, 0.16); color: var(--fg); border-radius: 3px; }
  .http .hk { background: rgba(245, 166, 35, 0.16); color: var(--fg); border-radius: 3px; }
  .http .err { background: rgba(248, 113, 113, 0.14); color: #fecaca; border-radius: 3px; }
  .cap { position: absolute; left: 24px; right: 24px; top: 606px; height: 56px; display: flex; align-items: center; gap: 16px; }
  .cap .n { width: 38px; height: 38px; border-radius: 50%; display: grid; place-items: center; flex: none;
    background: linear-gradient(135deg, #6d6cf5, #9b6cf6); font: 700 20px var(--font-sans); color: #fff; }
  .cap .t { font: 700 25px var(--font-sans); letter-spacing: -0.015em; white-space: nowrap; }
  .cap .sub { font: 400 16px var(--font-sans); color: var(--fg-3); white-space: nowrap; }
  .cap .dots { margin-left: auto; display: flex; gap: 8px; }
  .cap .dot { width: 30px; height: 6px; border-radius: 3px; background: #262735; }
  .cap .dot.on { background: var(--indigo); }
  .close { position: fixed; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 34px;
    background: radial-gradient(900px 520px at 50% 30%, rgba(99, 102, 241, 0.22), transparent 70%); }
  .brand { display: flex; align-items: center; gap: 14px; font: 700 30px var(--font-sans); letter-spacing: -0.02em; }
  .brand svg { width: 40px; height: 40px; }
  .slogan { font: 800 78px/1.05 var(--font-sans); letter-spacing: -0.035em; text-align: center; }
  .slogan .accent { background: linear-gradient(90deg, var(--indigo) 0%, var(--violet) 55%, var(--purple) 100%);
    -webkit-background-clip: text; background-clip: text; color: transparent; padding-right: 0.06em; }
  .chips { display: flex; gap: 14px; }
  .chip { height: 50px; padding: 0 22px; display: inline-flex; align-items: center; border-radius: 12px;
    background: #19191f; border: 1.5px solid var(--line); font: 500 22px var(--font-sans); color: var(--fg-2); }
`;

const LOGO = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#818cf8"/><stop offset="100%" stop-color="#c084fc"/></linearGradient></defs><path d="M12 22.5L2 17.5L12 12.5L22 17.5L12 22.5Z" fill="url(#g)" fill-opacity="0.6"/><path d="M12 17.5L2 12.5L12 7.5L22 12.5L12 17.5Z" fill="url(#g)" fill-opacity="0.8"/><path d="M12 12.5L2 7.5L12 2.5L22 7.5L12 12.5Z" fill="url(#g)"/></svg>`;

const CAPTIONS = {
  1: '1 · One definition. The app runs.',
  2: '2 · An agent creates a record over MCP.',
  3: '3 · A read-only identity is refused.',
};

function caption(beat, sub) {
  if (!beat) return '';
  const dots = [1, 2, 3].map((n) => `<span class="dot${n === beat ? ' on' : ''}"></span>`).join('');
  return `<div class="cap"><div class="n">${beat}</div><div><div class="t">${esc(CAPTIONS[beat].slice(4))}</div><div class="sub">${esc(sub)}</div></div><div class="dots">${dots}</div></div>`;
}

function highlightTs(line) {
  return esc(line)
    .replace(/'[^']*'/g, (m) => `<span class="s">${m}</span>`)
    .replace(/\b(import|from|export|const)\b/g, '<span class="k">$1</span>')
    .replace(/\bField\.(\w+)/g, 'Field.<span class="fn">$1</span>');
}

function readObjectExcerpt() {
  const lines = readFileSync(OBJECT_SOURCE, 'utf8').split('\n');
  const imp = lines.find((l) => l.startsWith('import { ObjectSchema, Field }'));
  const start = lines.findIndex((l) => l.startsWith('export const Team = ObjectSchema.create({'));
  const end = lines.findIndex((l, i) => i > start && l === '});');
  if (!imp || start < 0 || end < 0) throw new Refusal(5, `${OBJECT_SOURCE_LABEL} no longer declares \`export const Team = ObjectSchema.create({ … });\` — update the excerpt`);
  const body = lines.slice(start, end + 1).filter((l) => !/^\s*\/\//.test(l));
  return [imp, '', ...body];
}

const win = (bar, inner) => `<div class="win"><div class="bar"><i></i><i></i><i></i>${bar}</div>${inner}</div>`;

function codeScene(excerpt) {
  return win(`<span class="title">${esc(OBJECT_SOURCE_LABEL)}</span><span class="note">TypeScript · comment lines omitted</span>`,
    `<div class="code">${excerpt.map(highlightTs).join('\n')}</div>`);
}

function termScene(command, words, picked, shown) {
  const typed = command.split(' ').slice(0, words).join(' ');
  const out = picked.slice(0, shown).map((p) => (p.gap ? '<span class="gap">…</span>'
    : esc(p.text).replace(/✓/g, '<span class="ok">✓</span>'))).join('\n');
  return win('<span class="title">terminal · repository root</span>',
    `<div class="term"><span class="prompt">$</span> <span class="cmd">${esc(typed)}</span>${shown ? `\n${out}` : ''}</div>`);
}

function browserScene(shot, ring) {
  const url = shot.url.replace(/^https?:\/\//, '');
  let r = '';
  if (ring && shot.box) {
    const x0 = Math.max(3, shot.box.x - 6);
    const x1 = Math.min(SHOT.width - 3, shot.box.x + shot.box.w + 6);
    r = `<div class="ring" style="left:${x0}px;top:${34 + shot.box.y - 5}px;width:${x1 - x0}px;height:${shot.box.h + 10}px"></div>`;
  }
  return win(`<span class="title">Console</span><span class="url">${esc(url)}</span>`, `<img class="shot" src="${shot.src}">${r}`);
}

function requestLines(prefix) {
  return [
    '<span class="h">POST /api/v1/mcp</span>',
    '<span class="h">content-type: application/json</span>',
    '<span class="h">accept: application/json, text/event-stream</span>',
    `<span class="hk">x-api-key: ${esc(prefix)}••••••••</span>`,
    '',
    ...CALL_BODY.split('\n').map((l) => (l.includes('"create_record"') || l.includes(`"${OBJECT}"`) ? `<span class="hl">${esc(l)}</span>` : esc(l))),
  ];
}

function responseLines(call) {
  const head = `<span class="h">${call.status} ${esc(call.statusText)} · ${esc(call.contentType)} · ${call.ms} ms</span>`;
  // Re-layout for legibility only: the escapes inside the one string field are
  // drawn as the characters they encode; every other byte is as received.
  const text = call.rpc?.result?.content?.[0]?.text;
  const raw = call.raw;
  if (typeof text === 'string') {
    const quoted = JSON.stringify(text);
    const at = raw.indexOf(quoted);
    if (at >= 0) {
      const decoded = text.split('\n').map((l) => {
        const e = esc(l);
        if (call.rpc.result.isError) return `<span class="err">${e}</span>`;
        return /"(name|created_by)":/.test(l) ? `<span class="hl">${e}</span>` : e;
      });
      const after = esc(raw.slice(at + quoted.length)).replace(/"isError":true/, '<span class="err">"isError":true</span>');
      return [head, `${esc(raw.slice(0, at))}"${decoded.join('\n')}"${after}`];
    }
  }
  return [head, esc(raw)];
}

function mcpScene({ identity, prefix, readOnly, reqShown, call, resShown }) {
  const req = requestLines(prefix).slice(0, reqShown).join('\n');
  const res = call && resShown ? responseLines(call).slice(0, resShown).join('\n') : '';
  const verdict = call && resShown >= responseLines(call).length
    ? (call.rpc?.result?.isError ? '<span class="badge no">isError: true</span>' : '<span class="badge ok">record created</span>')
    : '';
  return win(`<span class="title">any MCP client → ${esc(call?.endpoint ?? '')}</span>`,
    `<div class="cols">
      <div class="col"><div class="lbl">REQUEST <span class="who">as ${esc(identity)}</span>${readOnly ? '<span class="badge ro">read-only</span>' : ''}</div><div class="http">${req}</div></div>
      <div class="col"><div class="lbl">RESPONSE ${verdict}</div><div class="http">${res}</div></div>
    </div>`);
}

function closeScene() {
  return `<div class="close">
    <div class="brand">${LOGO}<span>ObjectStack</span></div>
    <div class="slogan">The ontology<br><span class="accent">is the software.</span></div>
    <div class="chips"><span class="chip">Executable</span><span class="chip">AI-writable</span><span class="chip">Agent-operable</span><span class="chip">You own it</span></div>
  </div>`;
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  const browsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers';
  const executablePath = join(browsersPath, 'chromium');
  if (!existsSync(executablePath)) throw new Refusal(2, `no preinstalled Chromium at ${executablePath} — set PLAYWRIGHT_BROWSERS_PATH; this script never runs playwright install`);
  if (spawnSync('ffmpeg', ['-version']).status !== 0) throw new Refusal(2, 'no ffmpeg on PATH — it assembles the GIF');

  const excerpt = readObjectExcerpt();
  const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy;
  const browser = await chromium.launch({
    executablePath,
    args: ['--font-render-hinting=none', '--disable-gpu'],
    ...(proxy ? { proxy: { server: proxy, bypass: 'localhost,127.0.0.1' } } : {}),
  });
  const story = {};
  try {
    // ── record ──
    const port = await freePort();
    const base = `http://localhost:${port}`;
    story.command = await bootServer(port);
    const picked = pickBootLines();
    const admin = await signIn(browser, base, ADMIN);
    const reader = await signIn(browser, base, READ_ONLY);
    log(`  keys minted: ${admin.prefix}… for ${admin.user.email}, ${reader.prefix}… for ${reader.user.email}`);

    const canRead = await mcpCall(base, reader.key,
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'query_records', arguments: { objectName: OBJECT } } }));
    const parseText = (call) => { try { return JSON.parse(call.rpc?.result?.content?.[0]?.text ?? 'null'); } catch { return undefined; } };
    const readRows = canRead.rpc?.result?.isError ? undefined : parseText(canRead)?.records;
    if (!Array.isArray(readRows) || readRows.length === 0) {
      throw new Refusal(5, `${reader.user.email} cannot read ${OBJECT} over MCP (${canRead.raw.slice(0, 200)}) — calling it "read-only" would mislabel it`);
    }

    const page = await (await browser.newContext({
      viewport: { width: SHOT.width / SHOT.scale, height: SHOT.height / SHOT.scale },
      deviceScaleFactor: SHOT.scale,
      storageState: admin.storageState,
    })).newPage();
    const listUrl = `${base}/_console/apps/${APP_ID}/${OBJECT}`;
    const footer = (n) => (p) => p.getByText(`${n} records`, { exact: true }).first();

    const before = await countRows(base, admin.key);
    const shotBefore = await consoleShot(page, listUrl, 'before', { waitText: `${before} records` });

    const created = await mcpCall(base, admin.key, CALL_BODY);
    const createdDoc = created.rpc?.result?.isError ? undefined : parseText(created);
    if (!createdDoc?.record?.id || createdDoc.record.name !== NEW_TEAM.name) {
      throw new Refusal(5, `the admin's create_record did not create the row: ${created.raw.slice(0, 300)}`);
    }
    const afterCreate = await countRows(base, admin.key);
    if (afterCreate !== before + 1) throw new Refusal(5, `${OBJECT} went ${before} → ${afterCreate} rows on the create, expected +1`);
    created.endpoint = `${base.replace(/^https?:\/\//, '')}/api/v1/mcp`;
    const shotCreated = await consoleShot(page, listUrl, 'created', {
      waitText: NEW_TEAM.name,
      outline: (p) => p.getByRole('row').filter({ hasText: NEW_TEAM.name }).first(),
    });
    const shotRecord = await consoleShot(page, `${listUrl}/record/${encodeURIComponent(createdDoc.record.id)}`, 'record', { waitText: 'Created by' });

    const refused = await mcpCall(base, reader.key, CALL_BODY);
    if (!refused.rpc?.result?.isError) throw new Refusal(5, `the read-only identity's create_record was NOT refused: ${refused.raw.slice(0, 300)}`);
    refused.endpoint = created.endpoint;
    const afterRefusal = await countRows(base, admin.key);
    if (afterRefusal !== afterCreate) throw new Refusal(5, `${OBJECT} went ${afterCreate} → ${afterRefusal} rows on the refused call`);
    const shotRefused = await consoleShot(page, listUrl, 'refused', { waitText: `${afterRefusal} records`, outline: footer(afterRefusal) });

    log(`  create_record as ${admin.user.email}: ${created.status}, record ${createdDoc.record.id} "${createdDoc.record.name}", created_by ${createdDoc.record.created_by}`);
    log(`  create_record as ${reader.user.email}: ${refused.status} ${refused.raw}`);
    Object.assign(story, { before, afterCreate, afterRefusal, created: created.raw, refused: refused.raw, admin: admin.user.email, reader: reader.user.email });
    await stopServer();
    log(`  server stopped; ${OBJECT}: ${before} → ${afterCreate} (create) → ${afterRefusal} (refused)`);

    // ── render ──
    // The proxy (when one is configured) is how the web fonts arrive; a TLS-intercepting proxy is why
    // its certificate errors are ignored on this page, which loads nothing but the fonts.
    const page2 = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1, ignoreHTTPSErrors: Boolean(proxy) });
    await page2.setContent(`<!doctype html><html lang="en"><head><meta charset="utf-8">
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500;600&display=block" rel="stylesheet">
      <style>${CSS}</style></head><body><div id="stage"></div><div id="cap"></div></body></html>`, { waitUntil: 'networkidle' }).catch(() => {});
    // A face is only fetched once something asks for it, so ask for every weight the frames use.
    await page2.evaluate(() => Promise.all([
      '400 10px Inter', '500 10px Inter', '600 10px Inter', '700 10px Inter', '800 10px Inter',
      '400 10px "IBM Plex Mono"', '500 10px "IBM Plex Mono"', '600 10px "IBM Plex Mono"',
    ].map((f) => document.fonts.load(f).catch(() => []))));
    await page2.evaluate(() => document.fonts.ready);
    const fonts = await page2.evaluate(() => ({
      inter: document.fonts.check('800 10px Inter') && document.fonts.check('400 10px Inter'),
      plex: document.fonts.check('400 10px "IBM Plex Mono"'),
      loaded: [...document.fonts].filter((f) => f.status === 'loaded').map((f) => `${f.family} ${f.weight}`),
    }));
    const fontsOk = fonts.inter && fonts.plex && fonts.loaded.length > 0;
    story.fonts = fontsOk ? 'Inter + IBM Plex Mono (Google Fonts)' : 'system fallback (Liberation Sans / DejaVu Sans Mono)';
    log(`  fonts loaded: ${fonts.loaded.length ? fonts.loaded.join(', ') : 'NONE'}`);
    if (!fontsOk && !outDir) throw new Refusal(3, 'web fonts did not load (Inter / IBM Plex Mono); refusing to overwrite the committed GIF. Use --out <dir> for a preview.');

    const adminWho = `${admin.user.email} (dev admin)`;
    const readerWho = `${reader.user.email} (${reader.user.name})`;
    const frames = [];
    const add = (stage, beat, sub, seconds) => frames.push({ stage, cap: caption(beat, sub), seconds });

    add(codeScene(excerpt), 1, 'The Team object, as examples/app-showcase defines it', 2.6);
    const words = story.command.split(' ').length;
    for (let w = 1; w <= words; w++) add(termScene(story.command, w, picked, 0), 1, 'Boot it on a fresh, throwaway database', 0.11);
    const chunks = [3, 6, picked.length - 2, picked.length];
    for (const c of chunks) add(termScene(story.command, words, picked, c), 1, 'Boot it on a fresh, throwaway database', 0.28);
    frames[frames.length - 1].seconds = 1.9;
    add(browserScene(shotBefore), 1, `The Console's Team list, served from that definition: ${before} rows`, 2.8);

    const reqCount = requestLines(admin.prefix).length;
    const respCount = responseLines(created).length;
    const mcpA = { identity: adminWho, prefix: admin.prefix, readOnly: false, call: created };
    for (let k = 1; k <= reqCount; k++) add(mcpScene({ ...mcpA, reqShown: k, resShown: 0 }), 2, 'tools/call create_record over /api/v1/mcp, with the admin’s API key', 0.06);
    frames[frames.length - 1].seconds = 0.45;
    for (let k = 1; k <= respCount; k++) add(mcpScene({ ...mcpA, reqShown: reqCount, resShown: k }), 2, 'tools/call create_record over /api/v1/mcp, with the admin’s API key', 0.15);
    frames[frames.length - 1].seconds = 3.3;
    add(browserScene(shotCreated, true), 2, `The Console, refreshed: the new row is there (${afterCreate} rows)`, 2.8);
    add(browserScene(shotRecord), 2, 'Created by the key’s owner: the agent acted as that user', 2.3);

    const mcpB = { identity: readerWho, prefix: reader.prefix, readOnly: true, call: refused };
    add(mcpScene({ ...mcpB, reqShown: reqCount, resShown: 0 }), 3, 'The same call, sent with a read-only key (the Auditor persona)', 1.1);
    for (let k = 1; k <= responseLines(refused).length; k++) add(mcpScene({ ...mcpB, reqShown: reqCount, resShown: k }), 3, 'The same call, sent with a read-only key (the Auditor persona)', 0.15);
    frames[frames.length - 1].seconds = 3.4;
    add(browserScene(shotRefused, true), 3, `The Console, refreshed: unchanged, still ${afterRefusal} rows`, 2.8);
    add(closeScene(), 0, '', 3.4);

    const list = [];
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i];
      await page2.evaluate(([stage, cap]) => {
        document.getElementById('stage').innerHTML = stage;
        document.getElementById('cap').innerHTML = cap;
        // a glyph outside the subsets loaded so far (an arrow, an ellipsis) fetches one more
        return Promise.all([...document.images].map((img) => img.decode().catch(() => {}))).then(() => document.fonts.ready);
      }, [f.stage, f.cap]);
      const file = join(framesDir, `f${String(i).padStart(4, '0')}.png`);
      await page2.screenshot({ path: file, clip: { x: 0, y: 0, width: W, height: H } });
      list.push(`file '${file}'`, `duration ${f.seconds.toFixed(2)}`);
    }
    list.push(list[list.length - 2]); // the concat demuxer drops the last entry's duration unless the file repeats
    const listFile = join(workDir, 'frames.txt');
    writeFileSync(listFile, `${list.join('\n')}\n`);
    story.seconds = frames.reduce((s, f) => s + f.seconds, 0);
    log(`  ${frames.length} frames, ${story.seconds.toFixed(2)} s`);

    // ── assemble ──
    const palette = join(workDir, 'palette.png');
    const run = (argv) => {
      const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...argv], { stdio: 'inherit' });
      if (r.status !== 0) throw new Refusal(6, `ffmpeg ${argv.join(' ')} exited ${r.status}`);
    };
    run(['-f', 'concat', '-safe', '0', '-i', listFile, '-vf', 'palettegen=max_colors=256:stats_mode=full', '-update', '1', '-frames:v', '1', palette]);
    run(['-f', 'concat', '-safe', '0', '-i', listFile, '-i', palette,
      '-lavfi', 'paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle', '-fps_mode', 'vfr', '-loop', '0', gifOut]);

    const meta = await sharp(gifOut, { animated: true }).metadata();
    const bytes = statSync(gifOut).size;
    const seconds = (meta.delay ?? []).reduce((s, d) => s + d, 0) / 1000;
    const height = meta.pageHeight ?? meta.height;
    log(`gif  ${gifOut}  ${meta.width} x ${height}  ${meta.pages} frames  ${seconds.toFixed(2)} s  ${bytes.toLocaleString('en-US')} B  loop=${meta.loop}`);
    if (meta.width !== W || height !== H) throw new Refusal(6, `the GIF measures ${meta.width} x ${height}, expected ${W} x ${H}`);
    if (seconds < MIN_SECONDS || seconds > MAX_SECONDS) throw new Refusal(6, `the GIF runs ${seconds.toFixed(2)} s, outside ${MIN_SECONDS}-${MAX_SECONDS} s`);
    if (bytes > HARD_BYTES) throw new Refusal(6, `the GIF is ${bytes.toLocaleString('en-US')} B, over the ${HARD_BYTES.toLocaleString('en-US')} B hard cap — drop frames or seconds, never the width`);
    if (bytes > SOFT_BYTES) console.warn(`⚠ the GIF is over the ${SOFT_BYTES.toLocaleString('en-US')} B target`);
    if (outDir) writeFileSync(join(outDir, 'story.json'), `${JSON.stringify({ ...story, gif: { width: meta.width, height, frames: meta.pages, seconds, bytes } }, null, 2)}\n`);
  } finally {
    await stopServer();
    await browser.close();
    if (!outDir) rmSync(workDir, { recursive: true, force: true });
  }
}

main().catch(async (err) => {
  await stopServer();
  console.error(`✗ ${err.message}`);
  process.exit(err instanceof Refusal ? err.code : 1);
});
