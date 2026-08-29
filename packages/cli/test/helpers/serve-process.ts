// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Shared harness for e2e tests that need the REAL `os serve` process.
 *
 * Some serve defects only exist above the kernel — the boot-quiet stdout window
 * (#4012), the plugin registration ORDER the command assembles (#4085) — so
 * they survive every in-process test and only a test that spawns the actual
 * command can catch them. This module owns that spawn so each e2e file asserts
 * rather than re-implements it.
 */

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = resolve(fileURLToPath(import.meta.url), '..');

/** `bin/run-dev.js` — the CLI entrypoint that runs from TS source via tsx. */
export const CLI = resolve(HERE, '../../bin/run-dev.js');
export const TSX = resolve(HERE, '../../../../node_modules/.bin/tsx');

// ─────────────────────────────────────────────────────────────────────────
// THE OTHER ENTRYPOINT: `bin/run.js`, and the build state it silently needs
//
// `CLI` above is `bin/run-dev.js`, which pins `NODE_ENV=development` and runs
// the command from `src/` through tsx — so a file using `runServe()` needs no
// `packages/cli/dist` at all. A handful of e2e files deliberately spawn the
// OTHER entrypoint instead, because the thing they measure only exists when
// oclif resolves the command from the BUILT artifact. Those files, and only
// those, carry a build-state prerequisite, and it used to be invisible: an
// unbuilt worktree answered ` ›   Error: command serve not found`, the harness
// reported `serve exited 2 before "Server is ready"`, and nothing in either
// sentence said "run the build" (#12539).
//
// ⭐ The guard is here rather than in those files because it was written THREE
// times, byte-identical, 19 lines each (#11707 / PR #12459 swept three
// spawners in one edit and each got its own copy). Three copies of a refusal is
// the same defect the refusal exists to prevent, one level up.
//
// ⛔ It is NOT a general "is the CLI ready" preflight. `runServe()` must never
// call it: a tsx child reads `src/`, so `packages/cli/dist` is not that child's
// prerequisite and a guard that refused there would be a false red on a tree
// that can run the test perfectly well.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Why a `bin/run.js` child needs `packages/cli/dist`, in the child's own terms.
 *
 * ⭐ Named and exported rather than defaulted inside `requireBuiltCli()`, which
 * is the whole point: this sentence is true of the `bin/run.js` + unset-
 * `NODE_ENV` spawn and of nothing else. A caller reaching a different way (a
 * `bin/run-dev.js` + tsx child, a `pnpm` bin shim, a packed tarball) has a
 * DIFFERENT reason, and pasting this one there would attach a false
 * explanation to a true refusal — the failure class #12498 and #12561 were
 * filed for. The identifier says `RUN_JS` so that misuse has to be deliberate.
 */
export const RUN_JS_RESOLVES_FROM_DIST =
  'This file spawns bin/run.js with NODE_ENV unset, which is what makes oclif resolve the ' +
  'command from dist/ instead of transpiling src/ — so on an unbuilt tree the child answers ' +
  '"command serve not found" and every boot below fails immediately with "serve exited 2", ' +
  'not a timeout.';

/**
 * The refusal itself, separated from the check so its WORDING can be pinned.
 *
 * `requireBuiltCli()` can only produce this Error on an unbuilt tree, and no
 * test can produce an unbuilt tree without breaking every neighbouring file in
 * the same run. So the sentence a reader actually acts on would otherwise be
 * the one part of this guard nothing checks — and a refusal that forgets to
 * name the build command is exactly the false red #12539 exists to end.
 * `serve-built-cli-prerequisite.test.ts` pins it through this function.
 *
 * @param commandFile the `dist/` command file that was looked for and missing
 * @param mechanism   why THIS caller's child needs it — see
 *                    `RUN_JS_RESOLVES_FROM_DIST` for the only one in the tree
 */
export function unbuiltCliError(commandFile: string, mechanism: string): Error {
  return new Error(
    `packages/cli is not built: ${commandFile} does not exist.\n` +
      `${mechanism}\n` +
      'CI declares the build (turbo: @objectstack/cli#test dependsOn build); a direct vitest run does not.\n' +
      'Run: pnpm exec turbo run build --filter=@objectstack/cli',
  );
}

/**
 * Refuse to run against an unbuilt `packages/cli`, in a sentence rather than as
 * oclif's "command serve not found".
 *
 * The command target is read from the CLI's own `oclif.commands.target` rather
 * than restated here: that declaration is where `dist/commands` is decided, and
 * a copy keeps probing the old path after someone moves it — the argument
 * `scripts/cli-build-prerequisite.mjs` makes for the gates that shell out to
 * this CLI. Only that one declared shape is read; anything else (unreadable,
 * or `oclif.commands` written as a bare string) DEFERS rather than failing, so
 * a checkout this cannot understand never turns red here and the spawn's own
 * output stays the fallback — the same fail-open direction those gates take.
 *
 * `serve.js` is the probe because it is the command every caller of this guard
 * spawns, and one `tsup` run emits the whole `dist/commands` directory — so its
 * absence answers "this package was never built" for any of them. ⛔ It does
 * not catch a `dist/` that is merely BEHIND its source; that residual is the
 * honest cost of consuming the artifact and is stated in each caller's header.
 *
 * @param mechanism why this caller's child resolves the command from `dist/`.
 *                  Required, with no default: see `RUN_JS_RESOLVES_FROM_DIST`.
 */
export function requireBuiltCli(mechanism: string): void {
  let target: unknown;
  try {
    target = JSON.parse(readFileSync(resolve(HERE, '../../package.json'), 'utf8'))?.oclif?.commands?.target;
  } catch {
    return;
  }
  if (typeof target !== 'string' || !target) return;
  const commandFile = resolve(HERE, '../..', target.replace(/^\.\//, ''), 'serve.js');
  if (existsSync(commandFile)) return;
  throw unbuiltCliError(commandFile, mechanism);
}

/**
 * The bind probe, run in a throwaway Node process: bind `0.0.0.0:<want>`, print
 * the port the kernel actually assigned, close. `want = 0` asks the kernel to
 * choose. Returns `null` when the bind failed — which for a specific `want`
 * means "that port is taken", and for `0` means the probe itself malfunctioned.
 *
 * ## Why a SUBPROCESS rather than an in-process `net.createServer()`
 *
 * `net.Server#listen()` reports its assigned port ASYNCHRONOUSLY. Measured on
 * this container (node 22.22.2): `server.address()` is `null` on the very next
 * line after `listen(0, '0.0.0.0')`, so an in-process probe can only be
 * `async`. `randomPort()` below is called from ~14 sites across 8 other files
 * in this directory, every one of them passing it straight into a `spawn()`
 * argument list; turning it async would edit all of them for no behavioural
 * gain. A `node -e` child does the same bind and is synchronous from this
 * process's point of view.
 *
 * The price, measured on the container this suite runs in: ~38 ms per draw
 * (5-draw mean, empty child env — an inherited environment measured 74.7 ms,
 * so the strip below roughly halves it too). Against this package's own
 * measured per-spawn floor — 2.9 s for `node bin/run.js --version`, 6.5 s for
 * the tsx source entry — one draw is ~1.3% of the cheapest thing it precedes,
 * and ~14 draws are ~0.5 s against a suite whose wall was 495.8 s when
 * `vitest.config.ts` last measured it (~0.1%).
 *
 * ⛔ The probe child gets an environment built from NOTHING — not
 * `{ ...process.env, … }`, not even `childEnv()`. It is a bare `net` bind that
 * reads no variable at all, so the whole runner environment is surplus, and a
 * bulk copy into a spawn is the class `pnpm check:cli-test-child-env` closes in
 * this directory (a spread here is a real finding under that gate, not a false
 * positive — measured: it takes this file from 0 to 1 over its ceiling). Not
 * inheriting `NODE_OPTIONS` is the concrete win: an `--import` hook meant for
 * the suite would otherwise load inside every port draw.
 */
function probeBind(want: number): number | null {
  const src = [
    "const net = require('node:net');",
    'const want = Number(process.argv[1] || 0);',
    'const s = net.createServer();',
    "s.on('error', () => process.exit(3));",
    "s.listen(want, '0.0.0.0', () => {",
    '  const p = s.address().port;',
    '  s.close(() => process.stdout.write(String(p)));',
    '});',
  ].join('\n');
  try {
    const out = execFileSync(process.execPath, ['-e', src, String(want)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30_000,
      env: {},
    });
    const port = Number(out.trim());
    return Number.isInteger(port) && port > 0 ? port : null;
  } catch {
    return null;
  }
}

/**
 * The ONE port draw for every e2e spawn in this directory — a real bind probe,
 * not a blind `Math.random()` (#12441).
 *
 * Listen on `0.0.0.0:0`, read the port the kernel assigned, close the listener,
 * return the port for the caller to hand to `os serve`.
 *
 * ## ⚠️ What this guarantees, and what it does NOT — both halves, deliberately
 *
 * It is **still TOCTOU**. The listener is closed before `serve` binds, so the
 * port is unheld across the close-to-spawn gap and this can still lose a race.
 * What it actually buys:
 *
 *   • It never draws a port that is **already held**. A blind draw picks a
 *     number out of a range without asking anyone, so a neighbouring agent's
 *     dev server — bound for that process's entire lifetime, minutes or hours —
 *     is a live target on every single draw. The kernel does not assign a port
 *     that is currently bound, so that whole population is off the table.
 *   • It narrows the window from "the whole run" to "one close-to-spawn gap"
 *     (milliseconds). Only something that binds *inside* that gap can take it.
 *   • It removes this directory's second collision source. There used to be
 *     three independent draws over two overlapping ranges (41000-60000 here,
 *     40000-60000 in `serve-app-anchored-optional-import.e2e.test.ts`), which
 *     could collide with EACH OTHER under `--maxWorkers > 1`, not only with a
 *     neighbour. There is one draw now and it asks the kernel.
 *
 * ⛔ The comment this replaced claimed "a run never contends with another
 * agent's dev server on this host". That unqualified negative is the reason
 * nobody re-examined the draw until a real run in this fleet went red on
 * `✗ Port 49402 is already in use`. **Do not write another one here.** The
 * residual race is real and unclosed; what pays for it is
 * `portContentionError()` below, which makes the residual failure SAY it is a
 * port race instead of `serve exited 1 before "Server is ready"`.
 *
 * ⚠️ One property that is worse than the old range and is stated rather than
 * hidden: the kernel assigns from its ephemeral range
 * (`/proc/sys/net/ipv4/ip_local_port_range`, 32768-60999 on this container),
 * which is also where it draws source ports for OUTBOUND connections. The old
 * 40000-60000 range overlapped that anyway, and the probe's win — never
 * handing out a port some listener already holds — is the larger term. Nothing
 * here makes the port immune once it is handed over.
 */
export function reservePort(): number {
  // Retried, because a `null` for `want = 0` is a malfunctioning probe (the
  // kernel cannot answer "busy" to a request for any free port), and turning a
  // transient subprocess hiccup into a hard failure would replace one flake
  // class with another.
  for (let attempt = 0; attempt < 3; attempt++) {
    const port = probeBind(0);
    if (port !== null) return port;
  }
  throw new Error(
    'bind probe failed: could not obtain a free TCP port from the kernel after 3 attempts '
    + '(listen on 0.0.0.0:0 in a `node -e` child). This is a host problem, not a verdict '
    + 'about the code under test.',
  );
}

/**
 * Is `port` bindable RIGHT NOW? The **negative arm** of the same probe.
 *
 * Exported so `serve-port-bind-probe.test.ts` can prove the instrument is able
 * to answer NO: a probe that reports "free" for a port the test is holding open
 * is not an instrument, and every claim `reservePort()` makes rests on this
 * being a real bind rather than a shape that always succeeds.
 */
export function portIsFree(port: number | string): boolean {
  return probeBind(Number(port)) !== null;
}

/**
 * Bind `0.0.0.0:0` and KEEP it bound — the instrument for a test that needs a
 * port to be genuinely UNAVAILABLE, rather than merely believed to be.
 *
 * Resolves with the port and its closer; `release()` resolves once the listener
 * is fully closed, so a test can prove the negative arm and then the positive
 * one on the same number.
 *
 * ⚠️ It lives HERE, in the shared helper, because two files need it now
 * (`serve-port-bind-probe.test.ts` and `serve-port-readback.e2e.test.ts`) and
 * this directory has already paid once for duplicating a port instrument: the
 * three independent blind draws over two overlapping ranges that `reservePort()`
 * above replaced. A second copy is how they drift.
 */
export function holdPort(): Promise<{ port: number; release: () => Promise<void> }> {
  return new Promise((resolveHold, rejectHold) => {
    const server: Server = createServer();
    server.on('error', rejectHold);
    server.listen(0, '0.0.0.0', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        rejectHold(new Error(`listen(0) produced no numeric address: ${String(address)}`));
        return;
      }
      resolveHold({
        port: address.port,
        release: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

/**
 * `reservePort()` as a string, for the call sites that pass a port straight
 * into a `spawn()` argument list.
 *
 * ⚠️ The name is kept — and is now a slight misnomer, which is cheaper than the
 * alternative. It is `String(reservePort())` and nothing else; the draw, the
 * guarantees and the residual race are all documented on `reservePort()` above
 * and there is no second mechanism hiding behind this name. Renaming it would
 * be a rename-only edit across the 8 other files in this directory that call
 * it, which is churn this change deliberately does not spend.
 */
export function randomPort(): string {
  return String(reservePort());
}

/** How a boot says the port was taken — `serve.ts`'s own diagnostic, then the raw kernel error. */
const PORT_TAKEN_PATTERNS = [
  /Port (\d+) is already in use/,
  /EADDRINUSE[^\n]*?:(\d+)/,
];

/**
 * ⭐ Turn a boot that died on a taken port into a failure that SAYS SO (#12441
 * ruling ④).
 *
 * Returns an `Error` when `output` shows the child could not bind, else `null`.
 *
 * ## Why this exists, and why it is the half that pays
 *
 * The measured cost of a lost port race here is not the lost run. It is *"a red
 * suite that is not reproducible, on a test file the reader has no reason to
 * connect to a port"* — the failure surfaced as `serve exited 1 before "Server
 * is ready"` inside a file about `NODE_ENV` defaulting, and it cost an agent a
 * round to decide whether the failure belonged to the change under test. A fix
 * that only lowers the probability leaves that cost exactly where it was, just
 * rarer and therefore even more surprising when it lands.
 *
 * So the port number is read out of the CHILD's own diagnostic rather than
 * passed in: whatever the harness thought it reserved, the number the child
 * printed is the one that was contended. `probedPort` is threaded in only to
 * say, in the message, that the port WAS probed free moments earlier — which is
 * what tells the reader this is the residual TOCTOU gap and not a harness that
 * never looked.
 */
export function portContentionError(
  output: string,
  what: string,
  probedPort?: number | string,
): Error | null {
  let port: string | undefined;
  for (const pattern of PORT_TAKEN_PATTERNS) {
    const match = pattern.exec(output);
    if (match) {
      port = match[1];
      break;
    }
  }
  if (port === undefined) return null;
  const probed = probedPort === undefined
    ? ''
    : `This harness bind-probed ${probedPort} and the kernel reported it FREE moments earlier `
      + '(`reservePort()` in `test/helpers/serve-process.ts`), so this is the residual '
      + 'close-to-spawn gap that probe narrows but does not close.\n';
  return new Error(
    `PORT CONTENTION on port ${port}: \`${what}\` could not bind it.\n`
    + probed
    + 'Several agents share one container in this fleet, so another process took the port '
    + 'between the probe and the spawn.\n'
    + '⛔ This is a HOST race, not a verdict about the code under test. Do not spend a round '
    + 'deciding whether your change caused it — re-run this file in isolation. If it '
    + 'reproduces there, the port is genuinely held and the message above names it.\n'
    + `--- child output ---\n${output}`,
  );
}

/**
 * ANSI colour, removed before the banner is read.
 *
 * `runServe()` pins `NO_COLOR=1` and a piped stderr is not a TTY, so a child
 * spawned through this helper prints plain text either way. The strip is here
 * because `opts.env` is applied AFTER those defaults, so a caller CAN turn
 * colour back on — and it keeps the `API:` row quotable in the message below
 * rather than echoing escape sequences at the reader.
 *
 * ⛔ The escape is BUILT (`String.fromCharCode(27)`), never typed. A raw
 * control byte in a source file is what `pnpm check:nul-bytes` exists to stop:
 * it renders as nothing and matches neither spelling in a search, so the next
 * person greps for it and finds a file that looks fine.
 */
const ANSI_SGR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

function stripAnsi(text: string): string {
  return text.replace(ANSI_SGR, '');
}

/**
 * The banner's own `API:` row — the ONE line of a healthy boot that names the
 * address the child is reachable at.
 *
 * ⚠️ It carries the bound PORT only conditionally, which is why the read-back
 * below has an `unreadable` state rather than a boolean. `serve.ts` builds the
 * row from `resolveAuthBaseUrl(boundPort).baseOrigin`, whose chain is
 * `OS_AUTH_URL` → `BETTER_AUTH_URL` → `OS_BASE_URL` → `http://localhost:<port>`
 * — and `boundPort` is the port the transport reports it BOUND (#13062), which
 * is the requested one for every value but `0`. So a child
 * carrying any of those three prints an origin that is NOT what it bound, and
 * an unparseable one prints paths with no origin at all. Measured on this tree
 * (`f28f00fbd`): nothing under `packages/cli/test` and nothing in the runner
 * environment sets any of the three, so every `runServe()` child today prints
 * the `http://localhost:<port>` default.
 */
const BANNER_API_ROW = /^[^\n]*\bAPI:[^\n]*$/m;

/**
 * The banner's LAST line — the marker that says the WHOLE banner is in the
 * buffer, which is what makes this read-back deterministic rather than racy.
 *
 * `printServerReady` prints the `API:` row first and this line last, both with
 * `console.error`, and writes to one stream are ordered. So keying on the TAIL
 * means: if this matched, the `API:` row is in the buffer, full stop. Keying on
 * the HEAD (`Server is ready`) instead would make the read-back depend on
 * whether the rest of the banner happened to land in the same pipe chunk — and
 * a check that goes blind at random is worse than no check at all, because its
 * silence reads as a pass.
 */
const BANNER_TAIL = /Press Ctrl\+C to stop/;

/**
 * The banner's FIRST line, used to bound the search rather than to trigger it.
 *
 * `runServe()` hands the whole captured buffer over — boot log included — and
 * the `API:` row is matched by a line pattern, so a kernel line mentioning an
 * API earlier in the boot would otherwise be found FIRST and answered on. The
 * parse therefore looks only at the text from the banner's head onward.
 */
const BANNER_HEAD = 'Server is ready';

/** What a child's ready banner says about the port it actually bound. */
export type BannerPortReadback =
  /** No COMPLETE ready banner in the output — the boot died, or never got there. */
  | { state: 'no-banner' }
  /** A complete banner whose `API:` row does not name a localhost port. */
  | { state: 'unreadable'; apiRow: string }
  /** The port the child is serving on, read out of its own banner. */
  | { state: 'bound'; port: number };

/**
 * ⭐ Read the child's REAL bound port back out of its ready banner (#12525).
 *
 * ## The false green this removes
 *
 * `runServe()` spawns through `bin/run-dev.js`, which sets
 * `process.env.NODE_ENV = 'development'` before argv is even parsed. That makes
 * `serve.ts`'s `portAutoShiftAllowed` (`flags.dev || NODE_ENV ===
 * 'development'`) TRUE for **every child this helper spawns**, and on that
 * branch a taken port is not an error at all: `getAvailablePort()` walks to the
 * next free port and the boot SUCCEEDS.
 *
 * ## ⚠️ The LOUD column is far narrower than it looks — measured, because the
 * obvious reading of it is wrong
 *
 * `serve.ts:1318` is `flags.dev || process.env.NODE_ENV === 'development'`, and
 * **either half alone opens the auto-shift branch**. So "spawned `bin/run.js`
 * with `NODE_ENV` unset" does NOT put a spawner in the loud column — passing
 * `--dev` re-opens it whatever the variable says (and `serve.ts:1300` then sets
 * `NODE_ENV=development` in-process anyway). What a spawner needs to be loud is
 * BOTH halves false:
 *
 *     spawn shape                                   taken port ⇒
 *     no `--dev`, NODE_ENV not 'development'        hard exit 1 — loud, and
 *                                                   `portContentionError()`
 *                                                   above names it
 *     `--dev`, whatever NODE_ENV                    SILENT drift, GREEN boot
 *     `bin/run-dev.js` (NODE_ENV pinned at :28)     SILENT drift, GREEN boot
 *
 * Measured on this tree: `serve-node-env-production-default.e2e.test.ts` is the
 * ONLY file in this directory that is in the loud row. Every `runServe()` child
 * is in the silent one by the third route, and the three `serve-mcp-*` /
 * `serve-stdio-*` spawners are in it by the second — they pass `--dev`, so the
 * `bin/run.js` entry buys them nothing. ⛔ Do not restate the older reading
 * ("`bin/run.js` + unset `NODE_ENV` ⇒ loud"): it is the sentence that made this
 * population look half its real size, and it survived because `--dev` on those
 * spawn lines predates the cards blamed for it and was simply never read.
 *
 * And the port `runServe()` hands over is an opaque element of an argv list, so
 * until this read-back the harness never learned the child's real one. A test
 * that then talks to the port it ASKED for reaches whatever else is holding it
 * — on the container this fleet develops in, plausibly a neighbouring agent's
 * dev server. So the port is read out of the CHILD's own banner and never
 * inferred from what the harness passed in: that value is exactly what is wrong
 * when a drift happens.
 *
 * ⛔ This is NOT an argument to make `os serve` stricter. Auto-shifting in
 * development is correct and deliberate (#11113 pins the production half for
 * its own reasons). The defect was that the test harness could not tell the
 * difference.
 */
export function boundPortFromBanner(output: string): BannerPortReadback {
  const text = stripAnsi(output);
  const head = text.lastIndexOf(BANNER_HEAD);
  // Falling back to the whole buffer when the head is missing is deliberate: it
  // can only produce a LOUD `unreadable`, never a silent skip.
  const banner = head === -1 ? text : text.slice(head);
  if (!BANNER_TAIL.test(banner)) return { state: 'no-banner' };
  const row = BANNER_API_ROW.exec(banner);
  if (row === null) return { state: 'unreadable', apiRow: '(no `API:` row at all)' };
  const address = /http:\/\/localhost:(\d+)\b/.exec(row[0]);
  if (address === null) return { state: 'unreadable', apiRow: row[0].trim() };
  return { state: 'bound', port: Number(address[1]) };
}

/**
 * ⭐ The verdict half of the read-back: an `Error` when the child did not bind
 * the port it was asked for — or when its banner cannot say — else `null`.
 *
 * Shaped like `portContentionError()` above and used at the same place, because
 * it is the same host race seen through the other entrypoint: something took
 * the port between this harness's bind probe and the child's `listen()`. The
 * production column dies loudly and gets `portContentionError()`; the
 * development column drifts and gets this.
 *
 * ## Why `unreadable` is an ERROR and not a skip
 *
 * A skip there would restore the exact shape this check removes: the harness
 * looks, finds nothing, and hands back a green. An instrument that cannot
 * answer has to SAY it could not answer. The one shape that reaches it today is
 * a child carrying `OS_AUTH_URL` / `BETTER_AUTH_URL` / `OS_BASE_URL` (see
 * `BANNER_API_ROW`), and the message names them.
 *
 * ## What it deliberately does NOT cover
 *
 * A boot that never printed a complete banner — it died, or the caller's
 * `waitFor` matched something earlier, as `serve-no-artifact`'s
 * `/Nothing to serve/` case does. Such a child announced no bound port, so
 * there is nothing to compare and this returns `null`. Every `runServe()`
 * caller that boots successfully today waits for `Press Ctrl+C to stop` — the
 * banner tail — so all of them are covered.
 */
export function portDriftError(
  output: string,
  what: string,
  requestedPort?: string | number,
): Error | null {
  if (requestedPort === undefined) return null;
  const requested = Number(requestedPort);
  // A non-numeric `--port` is `serve`'s own parse to complain about, not this
  // harness's: there is no number to compare, so there is no verdict to give.
  if (!Number.isInteger(requested)) return null;

  const readback = boundPortFromBanner(output);
  if (readback.state === 'no-banner') return null;

  if (readback.state === 'unreadable') {
    return new Error(
      `CANNOT READ BACK THE BOUND PORT: \`${what}\` printed a ready banner whose \`API:\` row `
      + 'does not name a `http://localhost:<port>` address, so this harness cannot tell whether '
      + `the child bound the ${requested} it was asked for.\n`
      + `  API row: ${readback.apiRow}\n`
      + 'That row is `resolveAuthBaseUrl(boundPort).baseOrigin` (`serve.ts`), so a child carrying '
      + 'OS_AUTH_URL, BETTER_AUTH_URL or OS_BASE_URL prints THAT origin instead of the address it '
      + 'bound — and this read-back channel goes with it.\n'
      + '⛔ Reported rather than skipped on purpose (#12525): a silent skip here is the same '
      + 'false green the read-back exists to remove.\n'
      + `--- child output ---\n${output}`,
    );
  }

  // ⭐ `--port 0` is a REQUEST for a kernel-assigned port, not an expectation
  // about WHICH one — `utils/port-contract.ts` declares `MIN_PORT = 0` from its
  // own measurement and states that 0 is "a REQUEST, not an error". A child
  // asked for 0 therefore binds something else BY DESIGN, and reading that as
  // drift would reject every healthy `--port 0` boot.
  //
  // ⛔ Not the silent skip this file's header forbids, either: there is exactly
  // one answer such a boot can get wrong, and it is announcing the REQUEST back
  // (#13062 — the banner, the IPC message and `runtime.<env>.json` all printed
  // `localhost:0`, an address nothing was listening on). That one is reported;
  // beyond it there is genuinely no comparison this harness can make.
  if (requested === 0) {
    if (readback.port !== 0) return null;
    return new Error(
      `ANNOUNCED PORT 0 on \`${what}\`: the child was asked for port 0 — a request for a `
      + 'kernel-assigned port — and its ready banner names `http://localhost:0`, which is not '
      + 'an address anything can listen on.\n'
      + 'The banner is built from the port `serve.ts` PUBLISHES, so this is the #13062 defect: '
      + 'the requested port announced in place of the bound one. The same wrong number reaches '
      + 'the `objectstack:listening` IPC message and `runtime.<environment>.json`.\n'
      + `--- child output ---\n${output}`,
    );
  }

  if (readback.port === requested) return null;

  return new Error(
    `PORT DRIFT on \`${what}\`: this harness asked for port ${requested} and the child BOUND `
    + `port ${readback.port} — read back from the child's own ready banner.\n`
    + '`bin/run-dev.js` pins `NODE_ENV=development` before argv is parsed, so `serve.ts`\'s '
    + '`portAutoShiftAllowed` is true for every child spawned through this helper: a taken port '
    + 'is not an error there, it is a hop to the next free one, and the boot then SUCCEEDS.\n'
    + `So something else took ${requested} between this harness's bind probe and the child's `
    + 'listen — the same residual close-to-spawn race `portContentionError()` above names when '
    + 'the child is in production posture and dies loudly instead.\n'
    + '⛔ This is a HOST race, not a verdict about the code under test. Re-run this file in '
    + 'isolation.\n'
    + '⛔ And do not answer it by relaxing this check. Without it the run is a FALSE GREEN: the '
    + 'child boots, every assertion on its output passes, and anything that afterwards talks to '
    + `port ${requested} reaches whatever else is holding it — on this container, plausibly a `
    + 'neighbouring agent\'s dev server.\n'
    + `--- child output ---\n${output}`,
  );
}

/**
 * The variables vitest sets on its own WORKER process, which must never reach a
 * spawned `os serve` child (#11267).
 *
 * ## Why this exists — measured, not defensive
 *
 * A child built with `{ ...process.env, … }` inherits the **vitest worker's**
 * environment, and vitest sets `TEST=true` on that worker unconditionally,
 * independent of `NODE_ENV`. better-auth 1.7.1 reads `TEST` **directly**:
 *
 * ```js
 * // @better-auth/core/dist/env/env-impl.mjs:36
 * const isTest = () => nodeENV === "test" || toBoolean(env.TEST);
 * // better-auth/dist/context/create-context.mjs:210
 * skipOriginCheck: options.advanced?.disableOriginCheck !== void 0
 *   ? options.advanced.disableOriginCheck
 *   : isTest() ? true : false,
 * ```
 *
 * So an inherited `TEST=true` disables better-auth's origin/CSRF validation
 * **entirely**, one layer below anything `serve.ts` or `plugin-auth` decide,
 * and independent of whatever `NODE_ENV` the caller sets on the child. The
 * dangerous direction is not a red test: it is a security-posture assertion
 * that can never go red for the reason it exists, which reads as coverage.
 *
 * MEASURED on a real boot through this helper's own spawn recipe — same
 * fixture, same code, the five variables below the only difference. Probe:
 * `POST /api/v1/auth/sign-in/email` with `Origin: https://evil.example.com`
 * (untrusted under every branch of `serve.ts`'s trusted-origin assembly,
 * including the `isDev` `http://localhost:*` convenience that `run-dev.js`
 * always turns on):
 *
 * | child env | answer |
 * |---|---|
 * | `{ ...process.env }` (this helper, before #11267) | `401 INVALID_EMAIL_OR_PASSWORD` — origin ACCEPTED, validation never ran |
 * | family below stripped | `403 INVALID_ORIGIN` — validation ran and rejected |
 * | only `TEST` stripped | `403 INVALID_ORIGIN` |
 *
 * The third row is the isolation for THAT probe: `TEST` alone is what
 * better-auth reads.
 *
 * ## VITEST is stripped as defence-in-depth now, not for a live product read
 *
 * The first revision of this header said the `VITEST*` entries were stripped
 * as hygiene, "nothing in `os serve` reads them today". That was **false**
 * for a while: `detectMode` in `local-crypto-provider.ts` read `env.VITEST`
 * directly, so an inherited `VITEST=true` put a spawned child's crypto layer
 * in `test` mode — ephemeral key, never touches disk, never refuses — no
 * matter what posture the rest of the boot was in. #11448 (`a58eac3e`,
 * merged 2026-08-23) removed that arm; `detectMode` today reads only
 * `NODE_ENV`:
 *
 * ```ts
 * // packages/services/service-settings/src/local-crypto-provider.ts:185
 * const detectMode = (env: EnvMap): CryptoMode => {
 *   if (env.NODE_ENV === 'test') return 'test';
 *   if (env.NODE_ENV === 'production') return 'production';
 *   return 'development';
 * };
 * ```
 *
 * No product source reads `VITEST` any more, and `pnpm check:runner-env-posture`
 * is the gate that keeps that class shut. The strip below stays anyway — now
 * as **defence-in-depth over a gated class**, not as the fix for a live read:
 * the choke point here should not depend on product source staying that way.
 *
 * The consequence this drove — `OS_SECRET_KEY` being a default below — no
 * longer follows from a VITEST leak; re-derive it from `NODE_ENV`, which is
 * what `detectMode` actually reads. `bin/run-dev.js` pins
 * `process.env.NODE_ENV = 'development'` before argv is even parsed, and
 * `NODE_ENV` is deliberately outside this strip family (below), so every
 * child spawned through this helper is ALREADY in `development` crypto
 * posture — with or without a leaked `VITEST`. Development mode **persists**
 * a minted key to `$HOME/.objectstack/dev-crypto-key`. Measured: with that
 * file absent a production-posture boot refuses to start, and with it
 * present — put there by any earlier dev-mode boot in the same run — the
 * same boot succeeds. That is a cross-test ordering coupling through the
 * runner's home directory, and under vitest's parallel workers it is
 * nondeterministic. An explicit key removes both halves: nothing is written,
 * and nothing is depended on.
 *
 * ⛔ `NODE_ENV` is deliberately NOT in this family. The vitest worker exports
 * `NODE_ENV=test` too, but every caller here already pins the child's
 * `NODE_ENV` explicitly (`bin/run-dev.js` sets `development` before argv is
 * even parsed; the `bin/run.js` spawners pass it in `env`), so stripping it
 * would change which entrypoint those tests resolve through rather than remove
 * a leak. That is a different defect with its own card (#11317) — ⛔ do not
 * fold it in here.
 */
/**
 * A fixed, obviously-synthetic 32-byte key (64 hex chars) for spawned children,
 * so no test boot has to mint one — see `runServe()` and the header above.
 * ⛔ Test fixtures only; it is in the repo in plaintext and encrypts nothing
 * anyone keeps.
 */
export const E2E_SECRET_KEY = '0e2e'.repeat(16);

export const VITEST_WORKER_ENV_KEYS = [
  'TEST',
  'VITEST',
  'VITEST_WORKER_ID',
  'VITEST_POOL_ID',
  'VITEST_MODE',
] as const;

/** `TEST` exactly, or any `VITEST`-prefixed variable — see `childEnv()`. */
function isVitestWorkerKey(key: string): boolean {
  return key === 'TEST' || key === 'VITEST' || key.startsWith('VITEST_');
}

/**
 * Variables that silently move a spawned child's module RESOLUTION BASE. A
 * different defect from the runner leak above, stripped for a different reason
 * (#11773).
 *
 * A vitest worker runs with `NODE_PATH` pointing at pnpm's hoisted store
 * (`node_modules/.pnpm/node_modules`), which holds everything transitively
 * reachable anywhere in the workspace. `NODE_PATH` is a FALLBACK, not an
 * override — the `node_modules` walk wins whenever it hits — so the store can
 * only turn a MISS into a HIT. The dangerous direction is therefore an
 * ACCEPTANCE claim ("this base CAN reach X"): green because the store supplied
 * X, not because the base did.
 *
 * The split that decides whether it bites, measured in
 * `test/vitest-resolution-base-collapse.e2e.test.ts`:
 *
 *     resolution API                        NODE_PATH honoured?   base kept?
 *     ESM  import() / import.meta.resolve            NO               YES
 *     CJS  createRequire().resolve()                 YES              NO
 *
 * Spawning a real Node child is this directory's remedy for the resolution base
 * an in-process test cannot measure at all (#11412) — it escapes Vite's
 * rewrite, but it did NOT escape this, so a spawned pin whose claim routes
 * through CJS was as vacuous as the in-process one it replaced.
 * `serve-host-fallback-base.e2e.test.ts`'s control survived only because
 * `createHostImporter`'s fallback leg happens to be an ESM `import()`; had it
 * been CJS — as `createHostRequire` is — the inherited `NODE_PATH` would have
 * kept it green through the very ablation it exists to fail.
 *
 * ⛔ Deliberately NOT folded into `VITEST_WORKER_ENV_KEYS` above. That list is
 * "what vitest sets on its own worker", and `NODE_PATH` is not vitest's: every
 * pnpm bin shim exports one, so a REAL `serve`/`dev` child in production
 * carries it — that is #4719's entire history. Stripping it here is a DEFAULT
 * for spawned test children, not a claim that no child should ever see it. A
 * test that reproduces the shim shape says so explicitly, and the #4719 pin in
 * `serve-organizations-host-resolution.e2e.test.ts` already does
 * (`env: { …, NODE_PATH: hoistedStore }`) — `overrides` are applied after the
 * strip, so that opt-in still wins. What changes is that the fidelity is now
 * DECLARED by the test that wants it rather than inherited by every child.
 */
export const RESOLUTION_BASE_ENV_KEYS = ['NODE_PATH'] as const;

const RESOLUTION_BASE_ENV_SET: ReadonlySet<string> = new Set(RESOLUTION_BASE_ENV_KEYS);

/**
 * Build the environment for a spawned CLI child: this process's environment
 * minus the TWO families stripped above, plus `overrides`.
 *
 * The vitest-worker strip is a **class**, not the fixed list: `TEST` exactly,
 * plus anything matching `VITEST`/`VITEST_*`. `VITEST_WORKER_ENV_KEYS` names
 * the five that vitest 4 exports today (and is what the pin asserts against),
 * but a future runner variable in that namespace is caught without anyone
 * having to rediscover this trap first. The resolution-base strip
 * (`RESOLUTION_BASE_ENV_KEYS`) is the opposite shape — exact names only, no
 * namespace — because `NODE_PATH` is a variable real children legitimately
 * carry, so widening it by prefix would strip things nobody measured.
 *
 * `overrides` is applied AFTER the strip, so a test that genuinely wants one of
 * these set in its child can still say so explicitly — the point is that
 * nothing arrives by accident. An `undefined` value UNSETS a variable for the
 * child: Node's `spawn()` omits `undefined`-valued entries rather than
 * stringifying them, which `''` would not do.
 */
export function childEnv(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (isVitestWorkerKey(key) || RESOLUTION_BASE_ENV_SET.has(key)) continue;
    env[key] = value;
  }
  return { ...env, ...overrides };
}

export interface ServeRun {
  stdout: string;
  stderr: string;
}

/**
 * The port a caller asked for, read back out of its own `args`.
 *
 * `runServe` takes the port as an opaque argv element rather than a parameter,
 * so this is how it learns which port it asked for. `undefined` when the caller
 * passed no `--port`.
 *
 * ⚠️ The two consumers use it for OPPOSITE things, and the difference is the
 * whole point of #12525:
 *
 *   • `portContentionError` — for the MESSAGE only. The contended port is read
 *     out of the child's own diagnostic, because whatever the harness thought
 *     it reserved, the number the child printed is the one that was contended.
 *   • `portDriftError` — as the EXPECTATION to check the child's banner
 *     against. It is the one thing a drift makes wrong, which is exactly why it
 *     is compared with the child's real port rather than trusted as it.
 */
function portOf(args: string[]): string | undefined {
  for (const flag of ['--port', '-p']) {
    const at = args.indexOf(flag);
    if (at !== -1 && at + 1 < args.length) return args[at + 1];
  }
  return undefined;
}

/**
 * Boot `os serve` in `cwd`, collect its output until `waitFor` matches (or the
 * process exits), then stop it. Never leaves the child running.
 *
 * A boot that DIES still has to have said why, so an early exit resolves rather
 * than rejects — the caller's assertions read what it printed on the way down.
 *
 * ⭐ TWO narrow exceptions to that, both deliberate, and they are the same host
 * race seen from the two sides of `serve`'s port policy:
 *
 *   • A boot that DIED because it could not bind rejects with
 *     `portContentionError()`'s message (#12441). That death says nothing about
 *     the code under test, and letting it resolve hands the caller an output
 *     buffer whose assertions then fail on whatever marker is missing — the
 *     illegible shape that card measured.
 *   • A boot that SUCCEEDED on a port other than the one it was asked for
 *     rejects with `portDriftError()`'s message (#12525). Children spawned here
 *     run with `NODE_ENV=development` pinned by `bin/run-dev.js`, so this is the
 *     branch they actually take when the port is taken: `serve` hops to the next
 *     free port and boots clean. Read the docblock there for why a green is the
 *     more expensive outcome of the two.
 *
 * Only the SECOND needs the caller to have passed `--port`; both read the
 * child's own output for the port they name, never the harness's expectation.
 *
 * `waitFor` is matched against **stdout and stderr together** (#7915). `serve`
 * writes every human line — banner, boot progress, kernel logs — to stderr now,
 * because its stdout belongs to the MCP stdio transport when one is mounted;
 * matching stdout alone would wait for a stream that stays empty for the whole
 * boot. Both streams are still returned separately, which is what lets
 * `serve-stdio-stdout-purity.e2e.test.ts` assert stdout carries NOTHING else.
 */
export function runServe(
  cwd: string,
  args: string[],
  // `env` values may be `undefined` to UNSET a variable for the child (Node
  // omits undefined entries), which is how a test asserts behaviour that depends
  // on a variable being absent — `''` would not do it, since the resolvers this
  // exercises use `??` and an empty string is not nullish.
  opts: { waitFor: RegExp; timeoutMs?: number; config?: string; env?: Record<string, string | undefined> },
): Promise<ServeRun> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(TSX, [CLI, 'serve', opts.config ?? 'objectstack.config.ts', ...args], {
      cwd,
      // `childEnv`, never a bare `...process.env` — see its header for the
      // measured reason (#11267).
      env: childEnv({
        NO_COLOR: '1',
        // Keep the fixture self-contained: no file written, no port conflict
        // with another agent's dev server, no inherited log level.
        OS_DATABASE_URL: ':memory:',
        OS_LOG_LEVEL: '',
        OS_DISABLE_CONSOLE: '1',
        // Same "no file written" rule, extended to the crypto key — see the
        // header. Without this the child mints one and PERSISTS it to
        // `$HOME/.objectstack/dev-crypto-key`, which both litters the runner's
        // home directory and couples unrelated tests to each other through it.
        OS_SECRET_KEY: E2E_SECRET_KEY,
        ...(opts.env ?? {}),
      }),
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child.kill('SIGTERM');
      } catch {
        /* already gone */
      }
      if (err) {
        rejectRun(err);
        return;
      }
      const what = 'os serve (bin/run-dev.js, via runServe)';
      const contended = portContentionError(stdout + stderr, what, portOf(args));
      if (contended) {
        rejectRun(contended);
        return;
      }
      // ⭐ #12525 — the child may equally have bound a DIFFERENT port and
      // succeeded. `bin/run-dev.js` pins `NODE_ENV=development`, so the branch
      // above (a loud refusal to bind) is not the one these children take; this
      // is. See `portDriftError`.
      const drifted = portDriftError(stdout + stderr, what, portOf(args));
      if (drifted) {
        rejectRun(drifted);
        return;
      }
      resolveRun({ stdout, stderr });
    };

    const timer = setTimeout(
      () =>
        finish(
          new Error(
            `serve did not reach ${opts.waitFor} in time.\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`,
          ),
        ),
      opts.timeoutMs ?? 180_000,
    );

    child.stdout.on('data', (d) => {
      stdout += String(d);
      if (opts.waitFor.test(stdout + stderr)) finish();
    });
    child.stderr.on('data', (d) => {
      stderr += String(d);
      if (opts.waitFor.test(stdout + stderr)) finish();
    });
    child.on('error', (err) => finish(err));
    child.on('exit', () => finish());
  });
}
