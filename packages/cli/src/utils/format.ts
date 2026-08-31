// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import chalk from 'chalk';
import type { ZodError } from 'zod';
import { formatZodIssue } from '@objectstack/spec';
import type { TenancyPosture } from '@objectstack/spec/security';
import { writeStdoutDirect } from './json-stdout.js';

// ─── Constants ──────────────────────────────────────────────────────
export const CLI_NAME = 'objectstack';
export const CLI_ALIAS = 'os';

// ─── Machine-readable output ────────────────────────────────────────

/**
 * The only two exit codes this CLI has: `0` success, `1` failure.
 *
 * Deliberately a narrow union rather than `number`, and that narrowness is the
 * whole point. The value it types sits in the SECOND POSITIONAL slot of
 * {@link emitJson} / {@link emitText} — immediately after a payload — where
 * `number` accepted whatever numeric the caller happened to be holding.
 * `os migrate recorded-by --json` and `os migrate resume --json` were holding
 * `timer.elapsed()`, a DURATION in milliseconds, and passed it there (#4873).
 *
 * The result was invisible in every way an author checks: correct JSON on
 * stdout, `✅ Graceful shutdown complete`, empty stderr — and
 * `process.exitCode = 531`, which the shell reports as `531 & 0xFF` = 19. A
 * different non-zero code on every run, because the code WAS the run's
 * duration, so every caller that judges success by exit status (CI steps,
 * `set -e`, Makefiles, container entrypoints) saw a random failure from a
 * command that had just succeeded — the one audience `--json` exists for.
 *
 * Every other `--json` site in this CLI reports its duration INSIDE the
 * payload (`{ ...report, duration: timer.elapsed() }` — `os lint`,
 * `os migrate meta`, `os migrate summary-nulls`, `os meta resync`), which is
 * what those two meant to do as well. With this union a duration in the exit
 * slot is a compile error, so the mistake cannot be made silently again.
 *
 * Widening it is a deliberate act: a third code needs a meaning first.
 */
export type CliExitCode = 0 | 1;

export interface EmitJsonOptions {
  /**
   * Emit on a single line instead of 2-space-indented.
   *
   * Exists so the sweep onto `emitJson` could be a pure truncation fix with no
   * observable output change: roughly half the CLI's `--json` sites were
   * already compact and half indented, and this preserves whichever each one
   * emitted.
   *
   * This comment used to cite `os login --json` — a compact payload followed by
   * an indented one in the same run — as proof the split was accidental. That
   * was true, and worse than a formatting inconsistency: two documents on one
   * stdout parse as neither a single document nor as NDJSON. #6531 fixed it,
   * and in doing so gave `compact` its one *designed* use. `os login` is the
   * CLI's sole declared NDJSON command, because its device flow is genuinely
   * two events over time and the first one has to reach an automation consumer
   * before the user authorizes; there, one line per document IS the contract,
   * enforced through a single emitter in `commands/login.ts` and pinned by
   * `test/login-json-ndjson.e2e.test.ts`.
   *
   * Everywhere else `--json` still means exactly one JSON document on stdout
   * (#6217), so the remaining compact call sites are still only preserving
   * historical formatting and unifying them stays worth doing on its own.
   * New code should use the default.
   */
  compact?: boolean;
}

/**
 * Emit a `--json` payload and record the exit code, without truncating.
 *
 * `console.log(big)` followed by `process.exit(1)` looks correct and is not:
 * when stdout is a **pipe**, Node buffers the write asynchronously and
 * `process.exit` tears the process down with the buffer only partly drained.
 * `os lint packages/platform-objects/scripts/i18n-extract.config.ts --json`
 * came out of a pipe at exactly 65536 bytes — one pipe buffer — so every
 * scripted consumer got invalid JSON while an interactive run (stdout is a TTY,
 * written synchronously) looked perfect. Silent, and invisible to the author.
 *
 * The exit does not have to be an explicit `process.exit` to bite. oclif's
 * `handle()` ends every failing command with `Exit.exit()` → `process.exit()`
 * and performs no flush on that path, so a plain `this.exit(1)` — or any
 * thrown error — truncates exactly the same way. `flush()` runs only on the
 * SUCCESS path of `execute()`. That is why the fix belongs at the write, not
 * at the exit: awaiting the write callback drains the buffer before any of
 * those paths can tear the process down.
 *
 * Deliberately NOT fixed by forcing stdout into blocking mode process-wide
 * (`process.stdout._handle.setBlocking(true)`), which would cover every
 * command in one line: the same binary runs `os serve` / `os dev`, and a
 * blocking write to a pipe whose reader is slow blocks the event loop — it
 * would trade truncated JSON for a server that stalls on its own logs.
 *
 * Setting `process.exitCode` rather than calling `process.exit` lets Node exit
 * on its own once nothing is pending. Callers that must unwind immediately can
 * still `this.exit(n)` after awaiting this — the buffer is already drained by
 * then.
 */
export async function emitJson(
  payload: unknown,
  exitCode: CliExitCode = 0,
  opts: EmitJsonOptions = {},
): Promise<void> {
  const text = opts.compact ? JSON.stringify(payload) : JSON.stringify(payload, null, 2);
  await emitText(text, exitCode);
}

/**
 * True for the `ExitError` oclif's `this.exit(n)` throws.
 *
 * A command whose whole body sits in one `try` has a problem the truncation
 * masked: `this.exit(1)` does not exit, it THROWS, so an inner "report the
 * failure and stop" unwinds into the outer `catch`, which reports a second
 * time. `os validate --json` on a bad config emitted two JSON documents back
 * to back — unparseable as either one document or as JSONL. Nobody noticed
 * because the payload was being cut off at 64 KiB before the second one could
 * appear; draining the write is what made it visible.
 *
 * A catch that reports failures must re-throw this first — it is a
 * control-flow signal from our own code, not a failure to describe:
 *
 *     } catch (error: any) {
 *       if (isExitSignal(error)) throw error;
 *       …
 *     }
 */
export function isExitSignal(error: unknown): boolean {
  const e = error as { code?: unknown; oclif?: { exit?: unknown } } | null | undefined;
  return e?.code === 'EEXIT' || typeof e?.oclif?.exit === 'number';
}

/**
 * [#13347] The ADR-0112 carriers a `--format json` failure envelope adds
 * beside its `error` sentence — `{ code, httpStatus }`, and only the ones the
 * thrown error actually carries.
 *
 * ## The defect this closes
 *
 * Every machine-readable failure this CLI emits was built the same way:
 *
 *     await emitJson({ success: false, error: error.message });
 *
 * — 48 sites under `commands/`, and the payload carried the human sentence and
 * nothing else. The error reaching those `catch` blocks from
 * `@objectstack/client` is not a bare `Error`: the SDK's `fetch` wrapper
 * attaches `err.code` (the semantic ADR-0112 string, normalized to the SAME
 * spelling across the flat `@objectstack/rest` envelope and the wrapped
 * runtime-dispatcher one — #3842 / #4007) and `err.httpStatus`. Both were
 * dropped at the CLI boundary, so the one outcome a script most needs to
 * branch on — *someone else edited it, re-read and retry* vs *you are not
 * allowed* vs *the server is down* — was separable only by substring-matching
 * an English sentence that no contract pins.
 *
 * ## Why the keys are OMITTED rather than emitted as `undefined`
 *
 * `JSON.stringify` drops an `undefined` value, so `{ code: undefined }` and an
 * absent `code` are byte-identical on `emitJson`'s own output — which is
 * exactly why building the former is unsafe: the difference is invisible where
 * an author would look for it, and NOT invisible everywhere.
 *
 * Measured, rather than assumed. `yaml.stringify` drops it too (checked: both
 * `{ success, error, code: undefined }` and `{ success, error }` serialize to
 * `success: false\nerror: boom\n`). `formatOutput`'s `table` branch does not:
 * `printKeyValue` walks `Object.entries`, which yields the key, and its
 * `value === undefined` arm prints `code: null` outright; `printTable` derives
 * its columns from `Object.keys` and grows an empty `code` column the same way.
 * A payload meaning "this failure carried no code" would there assert a code
 * whose value is null.
 *
 * So this returns a partial object with the keys ABSENT — the spread adds
 * nothing at all when there is nothing to add — and the pin asserts the
 * emitted BYTES rather than the object, because on two of the three emitters
 * the object's own shape is what the bytes cannot show.
 *
 * ## What counts as "carrying" one — per key, not as a pair
 *
 * The two keys are decided INDEPENDENTLY, and that is a measurement rather
 * than a preference: the SDK sets `error.httpStatus = res.status` on every
 * non-2xx, while `error.code` comes from `asSemanticCode(...)` and is
 * `undefined` whenever the server sent no code. Coupling them ("emit both or
 * neither") would therefore discard a status that IS in hand, on exactly the
 * responses whose envelope is thinnest.
 *
 *  - `code` — a non-empty STRING. A numeric `code` is deliberately rejected
 *    rather than coerced: the pre-#3842 wrapped envelope parked the HTTP
 *    STATUS in `error.code`, and re-publishing a number under the name the
 *    semantic vocabulary uses would reintroduce, at this boundary, the exact
 *    confusion that producer-side fix removed.
 *  - `httpStatus` — a finite integer. `NaN` and fractional values are not
 *    statuses.
 *
 * ⛔ No value is INVENTED. A locally-thrown plain `Error` — every one of this
 * CLI's own input refusals — carries neither key and gets neither key. That
 * was option **B** of the card and it was not chosen: ADR-0112's ledger is the
 * authority on who may mint a code, and this card mints nothing. The accepted
 * cost, recorded so it is not re-opened as a defect: the payload is
 * POLYMORPHIC — a consumer cannot distinguish "this failure carried no code"
 * from "an older CLI". That was weighed against breaking every existing
 * consumer and the non-breaking side won.
 *
 * ⛔ Nor is the value FILTERED against a catalog. The codes actually in flight
 * here are broader than `StandardErrorCode`'s enum — `METADATA_CONFLICT`,
 * `FORBIDDEN` and `VALIDATION_FAILED` are all absent from it — so a membership
 * check would drop precisely the code this card exists to surface. Passing a
 * producer's code through is not minting one; narrowing the field to a
 * vocabulary no ledger declares would be.
 *
 * ## The one exclusion, and why it is not a filter
 *
 * oclif's `this.exit(n)` THROWS an `ExitError` whose `code` is the string
 * `'EEXIT'`. It is a control-flow signal from our own code, not a failure with
 * a vocabulary, and several of these `catch` blocks do not re-throw it first
 * (`os migrate meta` carries a comment about the "EEXIT: 1" it would otherwise
 * report). Publishing `code: "EEXIT"` into a machine-readable envelope would
 * hand consumers a branch on our own stack unwinding. {@link isExitSignal} is
 * reused rather than re-spelled so the judgement "this is a signal, not an
 * error" stays single-sourced.
 *
 * @example
 *     } catch (error: any) {
 *       if (flags.format === 'json') {
 *         await emitJson({ success: false, error: error.message, ...errorCodeFields(error) });
 *         this.exit(1);
 *       }
 */
export interface ErrorCodeFields {
  /**
   * The machine code the failure carried, when it carried one — passed
   * through, never minted or filtered. For wire failures this is the semantic
   * ADR-0112 string the SDK attached (`METADATA_CONFLICT`, `FORBIDDEN`, …);
   * for local I/O failures it is the Node errno (`ENOENT`, `ENOTDIR`, …),
   * which `os validate` / `os compile` / `os lint` really do throw from
   * inside the same `try`. The two vocabularies are disjoint (errnos are
   * `E`-prefixed OS names), so an ADR-0112 branch cannot false-match an
   * errno — but a consumer must not assume every `code` is ledger-owned.
   * Declared honestly here per the 2026-08-31 contract review: narrowing
   * this field to ADR-0112-only later would be breaking.
   */
  code?: string;
  /** The HTTP status the failure carried, when it carried one. */
  httpStatus?: number;
}

export function errorCodeFields(error: unknown): ErrorCodeFields {
  const fields: ErrorCodeFields = {};
  if (isExitSignal(error)) return fields;
  const e = error as { code?: unknown; httpStatus?: unknown } | null | undefined;
  if (typeof e?.code === 'string' && e.code !== '') fields.code = e.code;
  if (typeof e?.httpStatus === 'number' && Number.isInteger(e.httpStatus)) {
    fields.httpStatus = e.httpStatus;
  }
  return fields;
}

/**
 * The drain-aware write `emitJson` is built on, for machine payloads that are
 * not JSON — `formatOutput`'s `--format yaml` truncates on a pipe exactly like
 * the JSON one, and for the same reason.
 *
 * Appends the trailing newline. Everything in `emitJson`'s doc comment about
 * why this cannot be fixed at the exit, or globally via blocking stdout,
 * applies here too.
 */
export async function emitText(text: string, exitCode: CliExitCode = 0): Promise<void> {
  // `writeStdoutDirect`, not `process.stdout.write`: a `--json` command that
  // boots a kernel reserves stdout so the kernel's INFO stream goes to stderr
  // (#6217), and the payload is the one thing that must still reach the real
  // stdout. Outside a reservation this is `process.stdout.write` verbatim.
  await writeStdoutDirect(text + '\n');
  if (exitCode !== 0) process.exitCode = exitCode;
}

// ─── Banner ─────────────────────────────────────────────────────────

export function printBanner(version: string) {
  console.log('');
  console.log(chalk.bold.cyan('  ╔═══════════════════════════════════╗'));
  console.log(chalk.bold.cyan('  ║') + chalk.bold('   ◆ ObjectStack CLI ') + chalk.dim(`v${version}`) + chalk.bold.cyan('        ║'));
  console.log(chalk.bold.cyan('  ╚═══════════════════════════════════╝'));
  console.log('');
}

// ─── Section Header ─────────────────────────────────────────────────

export function printHeader(title: string) {
  console.log(chalk.bold(`\n◆ ${title}`));
  console.log(chalk.dim('─'.repeat(40)));
}

// ─── Key-Value Line ─────────────────────────────────────────────────

export function printKV(key: string, value: string | number, icon?: string) {
  const prefix = icon ? `${icon} ` : '  ';
  console.log(`${prefix}${chalk.dim(key + ':')} ${chalk.white(String(value))}`);
}

// ─── Status Line ────────────────────────────────────────────────────

export function printSuccess(msg: string) {
  console.log(chalk.green(`  ✓ ${msg}`));
}

export function printWarning(msg: string) {
  console.log(chalk.yellow(`  ⚠ ${msg}`));
}

export function printError(msg: string) {
  console.log(chalk.red(`  ✗ ${msg}`));
}

export function printInfo(msg: string) {
  console.log(chalk.blue(`  ℹ ${msg}`));
}

export function printStep(msg: string) {
  console.log(chalk.yellow(`  → ${msg}`));
}

// ─── Timer ──────────────────────────────────────────────────────────

export function createTimer() {
  const start = Date.now();
  return {
    elapsed: () => Date.now() - start,
    display: () => `${Date.now() - start}ms`,
  };
}

// ─── Zod Error Formatting ───────────────────────────────────────────

/**
 * How far the nested lines of an expanded issue are pushed to sit UNDER the
 * `code: message` line this file prints for the issue itself.
 *
 * `formatZodIssue` indents its own depth-0 line by 2 spaces and each nested
 * level by 2 more; this file's per-issue block is at 4/6. Adding 4 puts the
 * first nested level at 8 — one step below the `invalid_union: Invalid input`
 * line it explains — and keeps every deeper level nested relative to it.
 */
const NESTED_ISSUE_REINDENT = '    ';

/**
 * [#5389] The issue codes whose real diagnosis is nested one level down, and
 * which `formatZodIssue` therefore renders as more than one line.
 *
 * `invalid_union` puts each candidate branch on `issue.errors[]`; `invalid_key`
 * / `invalid_element` put the key/element schema's own issues on
 * `issue.issues[]`. Same defect, two property names — and the gate below has to
 * name both, or the terminal keeps printing `invalid_key: Invalid key in
 * record` with the prescription stranded in the payload.
 *
 * Kept in step with `CONTAINER_ISSUE_CODES` in `@objectstack/spec`'s
 * `error-map.zod.ts`, which is where the descent itself lives.
 */
const EXPANDABLE_ISSUE_CODES: ReadonlySet<string> = new Set([
  'invalid_union',
  'invalid_key',
  'invalid_element',
]);

/**
 * The lines that explain an expandable issue, or nothing at all.
 *
 * Zod folds every branch of a failed union into ONE issue whose own `message`
 * is the literal `"Invalid input"`; each branch's real rejection sits in
 * `issue.errors[]`, with paths relative to the union's own. A consumer that
 * walks only the top level therefore prints `invalid_union: Invalid input` and
 * drops the branch that says WHICH key is wrong — which is what `os validate`,
 * `os build` and `os plugin build` did until #5341, so every curated
 * prescription the #4001 campaign wrote for a strict shape behind a union was
 * produced and never delivered to the author's terminal.
 *
 * The branch SELECTION (drop branches that only say "wrong kind of value",
 * prefer the branch complaining least so one stray key is not reported once per
 * branch, break ties on `unrecognized_keys`, absolute paths, bounded depth) is
 * `@objectstack/spec`'s, reused rather than re-derived: this is the third
 * consumer of the same defect after `formatZodError` (#4971, PR #5342) and the
 * REST wire's `zodIssuesToFields` (#5014, PR #5362), and one mistake must not
 * get three different prescriptions depending on which surface the author hit.
 * Unlike the wire — which needs structured `{field, code, message}` entries and
 * so had to re-implement the ranking — the terminal needs exactly the STRING
 * that spec already exports, so here the reuse is a plain import.
 *
 * [#5389] The same import now also covers `invalid_key` / `invalid_element`,
 * whose diagnosis hangs on `issue.issues[]` instead. Widening the gate is the
 * WHOLE of this file's share of that fix — the descent is spec's, so the
 * terminal inherits it the moment it stops refusing to ask.
 *
 * Line 0 of that render is the issue's own verdict, which the caller has
 * already printed in this file's own idiom; only the explanation is returned,
 * so the change is strictly ADDITIVE — nothing that printed before #5341 stops
 * printing. An issue with nothing nested renders as a single line, hence never
 * reaches here and could not add one anyway.
 */
function nestedIssueLines(issue: unknown): string[] {
  const code = (issue as { code?: unknown } | null)?.code;
  if (typeof code !== 'string' || !EXPANDABLE_ISSUE_CODES.has(code)) return [];
  return formatZodIssue(issue as Parameters<typeof formatZodIssue>[0])
    .split('\n')
    .slice(1)
    .map((line) => `${NESTED_ISSUE_REINDENT}${line}`);
}

export function formatZodErrors(error: ZodError) {
  const issues = error.issues || (error as any).errors || [];
  
  if (issues.length === 0) {
    console.log(chalk.red('  Unknown validation error'));
    return;
  }

  // Group by top-level path
  const grouped = new Map<string, typeof issues>();
  for (const issue of issues) {
    const topPath = (issue as any).path?.[0] || '_root';
    if (!grouped.has(String(topPath))) {
      grouped.set(String(topPath), []);
    }
    grouped.get(String(topPath))!.push(issue);
  }

  for (const [section, sectionIssues] of grouped) {
    console.log(chalk.bold.red(`\n  ${section}:`));
    for (const issue of sectionIssues) {
      const path = (issue as any).path?.join('.') || '';
      const code = (issue as any).code || '';
      const msg = (issue as any).message || '';
      
      console.log(chalk.red(`    ✗ ${path}`));
      console.log(chalk.dim(`      ${code}: ${msg}`));
      
      // Show expected/received for type errors
      if ((issue as any).expected) {
        console.log(chalk.dim(`      expected: ${chalk.green((issue as any).expected)}`));
      }
      if ((issue as any).received) {
        console.log(chalk.dim(`      received: ${chalk.red((issue as any).received)}`));
      }

      // [#5341] …and, for a union — [#5389] or a record key / map element —
      // the nested issues that actually explain it.
      for (const line of nestedIssueLines(issue)) {
        console.log(chalk.dim(line));
      }
    }
  }
  
  console.log('');
  console.log(chalk.dim(`  ${issues.length} validation error(s) total`));
}

// ─── Metadata Statistics ────────────────────────────────────────────

/**
 * Every field here is rendered by {@link printMetadataStats}.
 *
 * #11172 — `translations: number` used to sit in this interface, collected by
 * {@link collectMetadataStats} (`count(config.translations)`) on every
 * `os validate` / `os info` / `os compile` run and then read by nothing: the
 * printer had no `translations` fragment at any value, so a stack with 40
 * translation bundles reported them nowhere. The maintainer ruled
 * implementation-first (2026-08-23) — delete the unread field rather than
 * invent a row for it; an `i18n:` summary row was explicitly NOT approved.
 *
 * The invariant that replaces it: this struct carries no metric the summary
 * does not print. It is enforced from both ends — TypeScript requires
 * `collectMetadataStats` to populate every field declared here, and the
 * `[#11172]` pin in `print-metadata-stats-zero-row.test.ts` requires every
 * collected field to reach the rendered output. A metric that is declared but
 * never rendered cannot satisfy both.
 */
export interface MetadataStats {
  objects: number;
  objectExtensions: number;
  fields: number;
  views: number;
  pages: number;
  apps: number;
  dashboards: number;
  reports: number;
  actions: number;
  flows: number;
  workflows: number;
  agents: number;
  apis: number;
  positions: number;
  permissions: number;
  datasources: number;
  plugins: number;
  devPlugins: number;
}

export function collectMetadataStats(config: any): MetadataStats {
  const count = (val: any) => {
    if (Array.isArray(val)) return val.length;
    if (val && typeof val === 'object') return Object.keys(val).length;
    return 0;
  };
  
  // Count total fields across all objects
  let fields = 0;
  const objects = Array.isArray(config.objects) ? config.objects :
    (config.objects && typeof config.objects === 'object' ? Object.values(config.objects) : []);
  for (const obj of objects as any[]) {
    if (obj.fields && typeof obj.fields === 'object') {
      fields += Object.keys(obj.fields).length;
    }
  }

  return {
    objects: count(config.objects),
    objectExtensions: count(config.objectExtensions),
    fields,
    views: count(config.views),
    pages: count(config.pages),
    apps: count(config.apps),
    dashboards: count(config.dashboards),
    reports: count(config.reports),
    actions: count(config.actions),
    flows: count(config.flows),
    workflows: count(config.workflows),
    agents: count(config.agents),
    apis: count(config.apis),
    positions: count(config.positions),
    permissions: count(config.permissions),
    datasources: count(config.datasources),
    plugins: count(config.plugins),
    devPlugins: count(config.devPlugins),
  };
}

// ─── Server Ready Banner ────────────────────────────────────────────

export interface ServerReadyOptions {
  /**
   * The origin an operator can actually reach this deployment on — the base
   * every absolute URL in the banner is built from — or `null` when none could
   * be determined.
   *
   * ## Why this is handed in, and why the port is not
   *
   * This field replaced a `port: number` that the banner turned into
   * `http://localhost:${port}` itself. That address is the one the process
   * BINDS, which is not the one a human can open the moment anything sits in
   * front of it. Measured on the EE 4.1.0 compose stack (#10646): the app
   * container `expose`s `:3000` with no `ports:` mapping — unreachable from the
   * host, and more so under `--scale app=N` — while the published entry point
   * is Caddy on `:80` and `OS_AUTH_URL` is already resolved to
   * `http://localhost`. The banner printed `http://localhost:3000/_console/`
   * anyway: a Console link that fails outright, and an `MCP:` line that is the
   * address customers paste into an AI client, where a wrong absolute URL never
   * fails loudly — it just never connects.
   *
   * So the banner no longer knows the port at all. It cannot compose an address
   * from one, which makes the old defect a COMPILE error rather than a
   * plausible-looking line of output. The caller resolves the origin through
   * the runtime's own chain (`resolveAuthBaseUrl` in `serve`: `OS_AUTH_URL` →
   * legacy `BETTER_AUTH_URL` → `OS_BASE_URL` → `http://localhost:<port>`) and
   * hands the answer here. That is the same value the CSRF allow-list and
   * first-party auth redirects key off, so the banner and the runtime cannot
   * disagree about where this deployment lives — a second, banner-local notion
   * of "external base" is exactly the drift this field exists to prevent.
   *
   * ## `null` means "say nothing", never "guess"
   *
   * `null` is what the resolver reports when the chain produced something that
   * will not parse — a set-but-empty `OS_AUTH_URL=` (which does NOT fall
   * through to the rest of the chain), or a value with no scheme. The banner
   * then prints the PATHS with no origin in front of them. A missing address
   * sends the operator to look one up; a confidently wrong one gets copied.
   *
   * Required on purpose: an absent field must not be able to mean
   * `http://localhost:<port>` again by omission.
   */
  externalBaseOrigin: string | null;
  /**
   * The authored config file, relative to cwd — printed in the `Config:`
   * row. Omit it when the boot did not actually read a config (#8978): on
   * every artifact-fallback boot (`OS_ARTIFACT_URL`, `OS_ARTIFACT_PATH`, or
   * the plain `<cwd>/dist/objectstack.json` convention) the caller derives
   * this path before deciding which source to boot from, so passing it
   * unconditionally named a file that was either never read or does not
   * exist on disk — on the SAME screen that just said so. See
   * {@link artifactSource} for the OS_ARTIFACT_URL row this slot takes
   * instead; the other artifact-fallback paths have no safely-redacted
   * display to show here, so the row is omitted rather than fabricated.
   */
  configFile?: string;
  /**
   * Set on an `OS_ARTIFACT_URL` boot (#8368) — the resolver's already
   * redacted `display` string (pre-signed URL query strings stripped),
   * printed in the `Config:` row's place. When present it takes priority
   * over {@link configFile}: this is what actually booted (#8978).
   */
  artifactSource?: string;
  isDev: boolean;
  pluginCount: number;
  pluginNames?: string[];
  uiEnabled?: boolean;
  consolePath?: string;
  /** Resolved storage driver display name (e.g. "MongoDBDriver", "SqlDriver(pg)"). */
  driverLabel?: string;
  /** Resolved DB URL with credentials redacted. */
  databaseUrl?: string;
  /**
   * [ADR-0105 D1] The deployment's resolved tenancy posture — printed verbatim.
   *
   * This is the SAME fact serve wires the runtime from: it must be
   * `resolveTenancyPosture()` (`@objectstack/types`), never a re-derivation.
   * The banner used to take a boolean `multiTenant` sourced from
   * `resolveMultiOrgEnabled()`, i.e. from `OS_MULTI_ORG_ENABLED` — the knob
   * `OS_TENANCY_POSTURE` superseded, and which `resolveTenancyPosture()` now
   * consults only as a fallback when the posture is unset. So a deployment
   * booted with `OS_TENANCY_POSTURE=isolated` alone printed
   * `Tenancy: single-tenant` while the organization wall was actually up and
   * `Organizations` was in the plugin table one line below (framework#4801,
   * observed in cloud#1020). Two sources for one fact, drifting.
   *
   * The field is the posture, not a boolean, for the same reason: tenancy is a
   * three-valued spectrum (`single` | `group` | `isolated`), and a boolean
   * cannot say `group` at all — it would have to lie, and the flattening is
   * where the drift hides. Typing it as {@link TenancyPosture} also makes the
   * old wiring a COMPILE error rather than a wrong-but-plausible line of
   * output: `resolveMultiOrgEnabled()` returns `boolean` and no longer fits.
   *
   * Omitted → no `Tenancy:` row (unchanged: a caller with nothing to say says
   * nothing, rather than guessing a posture).
   */
  tenancyPosture?: TenancyPosture;
  /**
   * Credentials of the dev admin seeded on an empty DB this boot (dev only).
   * When present, the banner surfaces them so backend debugging never has to
   * guess the login. Absent when nothing was seeded.
   */
  seededAdmin?: { email: string; password: string };
  /**
   * Automation wiring summary (2026-07-17 third-party eval). The engine's own
   * `info` narration while binding flows to triggers sits under the default
   * `warn` level and never prints, and a flow that armed logs nothing either
   * way — so a log line is the wrong instrument here regardless. This reports
   * live binding STATE, read off the engine after runtime.start(), which is
   * what "did my flows actually arm?" actually asks. (Boot-phase warnings the
   * engine does emit now reach the terminal too — see {@link BootDiagnostics},
   * #4012 — but absence of a warning was never evidence of a bound flow.)
   */
  automation?: AutomationReadySummary;
  /**
   * Per-source seed outcomes for this boot (#3415/#3430). SeedLoader's own
   * logs sit under the default warn level (and the boot-quiet window hid them
   * at every level until #4012), so without this line a fixture can silently
   * lose most of its rows (the showcase shipped 1 of 5 projects for weeks) and a marketplace
   * package can rehydrate onto a fresh DB with zero rows. Each config app and
   * each rehydrated/healed marketplace package contributes one entry;
   * rejections and empty installs are loud, a clean seed prints one dim line.
   */
  seeds?: SeedSourceSummary[];
  /**
   * Boot-phase kernel-logger diagnostics replayed from the boot-quiet stdout
   * window (#4012). `ObjectLogger` writes `warn` to stdout, so that window
   * used to discard every warning a plugin emitted while booting — the
   * ADR-0110 D5 `[action-governance]` inventory, degraded-boot notices, flow
   * binding failures — even though the CLI defaults the kernel to `warn`
   * expressly so they surface (ADR-0032). `serve` now buffers them and hands
   * them here, so they land under the banner instead of nowhere.
   */
  bootDiagnostics?: BootDiagnostics;
  /**
   * Whether the MCP server surface (`/api/v1/mcp`) is on (#3167). Default-on
   * core capability, but nothing in the dev loop surfaces it — an AI client
   * (Claude Code, Cursor, …) can operate the running app the instant a
   * developer knows the endpoint is there. The banner is where they look, so
   * print the URL + the SKILL.md pointer when it's live.
   */
  mcpEnabled?: boolean;
}

export interface SeedSourceSummary {
  /** Display label — the config app id / marketplace manifest id that seeded. */
  source: string;
  /** True when the source is a marketplace package (vs a config-declared app). */
  marketplace?: boolean;
  inserted: number;
  updated: number;
  skipped: number;
  /** Records dropped by validation/reference errors — the silent-loss case. */
  rejected: number;
  /**
   * Reference FIELDS dropped from rows that WERE written (#3932). The row
   * count stays healthy — the association is what went missing — so unless
   * this is said out loud, nothing on this line hints at it.
   */
  droppedRefs?: number;
  /**
   * Rows were (re)seeded onto a fresh/empty database during rehydrate — the
   * "swap the DB out from under an installed package" self-heal (#3430).
   */
  healed?: boolean;
  /**
   * A marketplace package rehydrated with seed datasets declared, yet every
   * seeded object came up empty — the "installed but 0 rows" case (#3430).
   */
  emptyInstall?: boolean;
}

export interface AutomationReadySummary {
  /** Whether the automation service is registered at all. */
  enabled: boolean;
  /** Flows declared in the stack config (used when the engine is absent). */
  declaredFlowCount: number;
  /** Flows registered in the engine (0 when `enabled` is false). */
  flowCount: number;
  /** Flows bound to a trigger. */
  boundCount: number;
  /** Registered trigger types (record_change, schedule, api, …). */
  triggerTypes: string[];
  /** Enabled flows that declare a trigger but are NOT bound, with the fix. */
  unbound: Array<{ flowName: string; triggerType: string; reason: string }>;
  /** Bound record-change flows whose target object is not registered (dead binding). */
  unknownObject: Array<{ flowName: string; object: string }>;
  /**
   * Bare flow names claimed by more than one definition, as the ADR-0005
   * overlay precedence resolved them (#12028).
   *
   * `armed` is the body that is actually in the engine's flow map and will
   * dispatch; `shadowedCount` is how many same-named definitions it displaced.
   * BOTH are carried on purpose. The engine's flow map is keyed by BARE name,
   * so a displaced definition is invisible by construction: it is not in
   * `flowCount`, not in `unbound`, not in `unknownObject`, and not in
   * `listFlows()`. A count on its own would report that something is wrong and
   * withhold the one fact the operator is standing there to get — *which* body
   * is the one running.
   *
   * Empty on every healthy boot. No contested name, no line: this banner is
   * read on every `os dev` / `os start`, and a warning that fires when nothing
   * is wrong is a warning readers learn to skip.
   */
  shadowed: Array<{
    flowName: string;
    armed: { source: 'package' | 'runtime'; packageId?: string };
    shadowedCount: number;
  }>;
  /** Enabled flows whose persisted status is 'draft' (they still fire). */
  draftCount: number;
}

/**
 * `os serve`'s startup banner — on **stderr** (#7915).
 *
 * Everything below writes with `console.error`, and that is the whole point of
 * this comment: the banner is a DIAGNOSTIC, not program output. `os serve`'s
 * stdout belongs to the MCP stdio transport when one is mounted
 * (`OS_MCP_STDIO_ENABLED=true`), and that protocol is newline-delimited JSON —
 * a conforming client `JSON.parse`s every line it reads, so one banner line
 * reaches it as a transport error. Measured on the #7915 repro: the
 * `initialize` result arrived on line 517, behind 516 lines of banner and
 * kernel log.
 *
 * Unconditional on purpose. "stderr when the stdio transport is mounted" needs
 * a reliable signal at the moment each line prints, and fails silently and in
 * the worse direction when that signal is wrong or late. Diagnostics belong on
 * stderr whether or not anything is listening on stdout, and in a terminal it
 * costs nothing — both streams render.
 *
 * `printBootDiagnostics`, `printAutomationSummary` and `printSeedSummary` are
 * part of this same banner and follow the same rule. The general helpers above
 * (`printSuccess`, `printKV`, `printMetadataStats`, …) deliberately do NOT:
 * they serve every command, some of whose stdout IS the program's output.
 */
export function printServerReady(opts: ServerReadyOptions) {
  // #10646 — the address the OPERATOR can reach, never the one this process
  // binds. See ServerReadyOptions.externalBaseOrigin for the measured case
  // these two came apart in; `null` there means the deployment's external base
  // is UNKNOWN, and the rule for that case is the whole design: print the path
  // and no origin. Every absolute URL below goes through `link()`, so there is
  // exactly one place that decides, and no line can quietly grow its own base.
  const base = opts.externalBaseOrigin;
  const link = (path: string) => (base === null ? path : base + path);
  console.error('');
  console.error(chalk.bold.green('  ✓ Server is ready'));
  console.error('');
  console.error(chalk.cyan('  ➜') + chalk.bold('  API:       ') + chalk.cyan(link('/')));
  if (opts.uiEnabled && opts.consolePath) {
    console.error(chalk.cyan('  ➜') + chalk.bold('  Console:   ') + chalk.cyan(link(opts.consolePath + '/')));
  }
  if (opts.mcpEnabled) {
    console.error(chalk.cyan('  ➜') + chalk.bold('  MCP:       ') + chalk.cyan(link('/api/v1/mcp')));
    console.error(chalk.dim(`      connect an AI client (Claude Code, Cursor, …) · skill: ${link('/api/v1/mcp/skill')}`));
  }
  if (base === null) {
    // Say why the origin is missing and name the one variable that fixes it,
    // rather than leaving the operator to infer it from truncated links. The
    // boot already complains in more detail (formatUnusableAuthBaseUrlDiagnostic
    // in `serve`), but only on the branch that registers auth — so on every
    // other boot shape this line is the only notice there is.
    console.error(chalk.dim('      paths only — this deployment\'s external base URL could not be resolved;'));
    console.error(chalk.dim('      set OS_AUTH_URL to its public origin (e.g. https://app.example.com)'));
  }
  if (opts.seededAdmin) {
    console.error('');
    console.error(
      chalk.green('  🔑') + chalk.bold('  Dev admin: ') +
      chalk.bold.green(`${opts.seededAdmin.email} / ${opts.seededAdmin.password}`),
    );
    console.error(chalk.dim('      seeded on empty DB · dev only — do not use in production'));
  }
  console.error('');
  // #8978 — name what actually booted, never a file that was not read.
  // `artifactSource` (OS_ARTIFACT_URL) wins when present; a caller with
  // neither (the other artifact-fallback paths) gets no row at all rather
  // than a fabricated or nonexistent one.
  if (opts.artifactSource) {
    console.error(chalk.dim(`  Artifact: ${opts.artifactSource} (OS_ARTIFACT_URL)`));
  } else if (opts.configFile) {
    console.error(chalk.dim(`  Config:  ${opts.configFile}`));
  }
  console.error(chalk.dim(`  Mode:    ${opts.isDev ? 'development' : 'production'}`));
  if (opts.driverLabel) {
    const dbInfo = opts.databaseUrl ? `${opts.driverLabel}  ${chalk.dim('→')} ${opts.databaseUrl}` : opts.driverLabel;
    console.error(chalk.dim(`  Driver:  ${dbInfo}`));
  }
  // [ADR-0105 D1] Print the posture verbatim — see `tenancyPosture` above for
  // why this is not a boolean and why it must be the resolver's answer.
  if (opts.tenancyPosture !== undefined) {
    console.error(chalk.dim(`  Tenancy: ${opts.tenancyPosture}`));
  }
  console.error(chalk.dim(`  Plugins: ${opts.pluginCount} loaded`));
  if (opts.pluginNames && opts.pluginNames.length > 0) {
    console.error(chalk.dim(`           ${opts.pluginNames.join(', ')}`));
  }
  if (opts.automation) printAutomationSummary(opts.automation);
  if (opts.seeds) printSeedSummary(opts.seeds);
  if (opts.bootDiagnostics) printBootDiagnostics(opts.bootDiagnostics);
  console.error('');
  console.error(chalk.dim('  Press Ctrl+C to stop'));
  console.error('');
}

/** Boot-phase logger records held back by the boot-quiet window (#4012). */
export interface BootDiagnostics {
  /** Retained records, in emission order, exactly as the logger rendered them. */
  lines: string[];
  /** Records dropped because the capture buffer filled. */
  dropped?: number;
}

/**
 * Replay what the boot-quiet stdout window held back (#4012).
 *
 * `serve` blanks stdout while the kernel boots so the banner is readable, and
 * `ObjectLogger` sends `warn` to stdout — so for as long as that window simply
 * discarded its bytes, no plugin's boot-phase warning could reach a terminal on
 * either `os dev` or `os serve`, at any `--log-level`. Data-phase logging was
 * unaffected, which is why the hole stayed invisible: the stream looked alive.
 *
 * Quiet when a boot had nothing to say. Printed from the banner on a healthy
 * boot and directly from serve's error path on a failed one — a boot that dies
 * is exactly when its warnings matter most.
 *
 * Replayed to **stderr** (#7915) — these are the kernel's own diagnostics, held
 * back and re-emitted, so they land where every other `serve` diagnostic does.
 */
export function printBootDiagnostics(diagnostics: BootDiagnostics) {
  const { lines, dropped = 0 } = diagnostics;
  if (lines.length === 0) return;

  console.error('');
  console.error(
    chalk.yellow(
      `  ⚠ Boot diagnostics — ${lines.length} warning${lines.length === 1 ? '' : 's'} logged during startup:`,
    ),
  );
  for (const line of lines) console.error(chalk.dim(`    ${line}`));
  if (dropped > 0) {
    console.error(chalk.dim(`    …and ${dropped} more (capture buffer full)`));
  }
  console.error(chalk.dim('    run with --log-level debug to watch the boot stream live'));
}

/**
 * Name one flow body the way an operator can act on it (#12028).
 *
 * Deliberately worded to match `@objectstack/service-automation`'s own
 * bootstrap warning for the same event, so an operator who sees both at
 * `--log-level info` reads one story rather than two. `packageId` is optional
 * on the engine's contender shape, so both halves have a defined answer here
 * instead of interpolating an absent id into the sentence.
 */
function describeFlowBody(c: { source: 'package' | 'runtime'; packageId?: string }): string {
  if (c.source !== 'package') return 'a runtime-authored row (sys_metadata)';
  return c.packageId ? `package '${c.packageId}'` : 'a code-shipped package (id unknown)';
}

/**
 * One-glance answer to "did my flows actually arm?" — the question the
 * boot-quiet stdout window otherwise makes unanswerable (the engine's own
 * bind/registration logs are swallowed during startup).
 */
function printAutomationSummary(a: AutomationReadySummary) {
  if (!a.enabled) {
    if (a.declaredFlowCount > 0) {
      console.error(
        chalk.yellow(
          `  ⚠ Flows:   ${a.declaredFlowCount} flow(s) declared but the automation engine is not enabled — ` +
          `they will never run. Add requires: ['automation', 'triggers'] to objectstack.config.ts`,
        ),
      );
    }
    return;
  }
  if (a.flowCount === 0) return;

  const parts = [`${a.flowCount} flow(s)`, `${a.boundCount} bound to triggers`];
  if (a.triggerTypes.length > 0) parts.push(`(${a.triggerTypes.join(', ')})`);
  if (a.draftCount > 0) parts.push(`· ${a.draftCount} draft`);
  console.error(chalk.dim(`  Flows:   ${parts.join(' ')}`));

  // #12028 — printed FIRST among the warnings because it re-reads every line
  // above it: the counts describe the ARMED bodies only, so when a name is
  // contested "3 flow(s), 3 bound" is true of a set that does not include the
  // definition the operator just edited.
  for (const s of a.shadowed) {
    console.error(
      chalk.yellow(
        `  ⚠ flow '${s.flowName}' is claimed by ${s.shadowedCount + 1} definitions — ` +
        `${describeFlowBody(s.armed)} is ARMED, ${s.shadowedCount} shadowed ` +
        `(ADR-0005 overlay precedence; only the armed definition dispatches)`,
      ),
    );
  }
  for (const u of a.unbound) {
    console.error(
      chalk.yellow(`  ⚠ flow '${u.flowName}' declares a '${u.triggerType}' trigger but is NOT bound — ${u.reason}`),
    );
  }
  for (const u of a.unknownObject) {
    console.error(
      chalk.yellow(
        `  ⚠ flow '${u.flowName}' targets unknown object '${u.object}' — bound, but it will never fire ` +
        `(object names match exactly; check the start node's config.objectName)`,
      ),
    );
  }
}

/**
 * One-glance answer to "did my seed rows actually land — from every source?"
 * (#3415/#3430). Follows printAutomationSummary's contract: quiet when
 * everything is fine, yellow with the reason when rows were dropped or a
 * marketplace package came up empty. Both config apps (AppPlugin) and
 * rehydrated/healed marketplace packages contribute, e.g.
 *
 *   Seeds:   showcase 162 rows · hotcrm(marketplace) 157 ok / 5 errors ⚠
 *
 * A fixture contradiction (seed status vs a state_machine's initialStates), a
 * row-level lookup failure, or a marketplace package that healed onto a fresh
 * DB with zero rows must never pass silently again.
 */
function printSeedSummary(sources: SeedSourceSummary[]) {
  const shown = sources.filter((s) => {
    // Empty installs and rejections are ALWAYS shown (they're the whole point);
    // a source that touched no rows and had no problem is noise — drop it.
    if (s.emptyInstall || s.rejected > 0 || (s.droppedRefs ?? 0) > 0) return true;
    return s.inserted + s.updated + s.skipped > 0;
  });
  if (shown.length === 0) return;

  const anyProblem = shown.some((s) => s.rejected > 0 || (s.droppedRefs ?? 0) > 0 || s.emptyInstall);

  const fragment = (s: SeedSourceSummary): string => {
    const label = s.marketplace ? `${s.source}(marketplace)` : s.source;
    if (s.emptyInstall) return `${label} installed but 0 rows ⚠`;
    const ok = s.inserted + s.updated + s.skipped;
    // A dropped reference leaves the row in place, so it never shows up in the
    // row counts — name it separately or the line reads clean over a severed
    // association (#3932).
    const dropped = s.droppedRefs ?? 0;
    const lostLinks = dropped > 0 ? ` / ${dropped} lost link${dropped === 1 ? '' : 's'}` : '';
    if (s.rejected > 0) {
      return `${label} ${ok} ok / ${s.rejected} error${s.rejected === 1 ? '' : 's'}${lostLinks} ⚠`;
    }
    if (dropped > 0) return `${label} ${ok} ok${lostLinks} ⚠`;
    return `${label} ${ok} rows${s.healed ? ' (healed on fresh db)' : ''}`;
  };

  const line = shown.map(fragment).join(' · ');
  if (anyProblem) {
    console.error(chalk.yellow(`  ⚠ Seeds:   ${line}`));
    console.error(chalk.dim('      run with OS_LOG_LEVEL=info to see each dropped record'));
    return;
  }
  console.error(chalk.dim(`  Seeds:   ${line}`));
}

export function printMetadataStats(stats: MetadataStats) {
  const sections: Array<{
    label: string;
    items: Array<[string, number]>;
    /**
     * The item(s) to force-print when EVERY item in the section is `0`.
     *
     * #10504 — a section whose every item is `0` used to vanish from the
     * summary entirely, and that reads as "this summary does not report on
     * this section" rather than "this project has none of it" — exactly the
     * same output for a newcomer's freshly scaffolded project (intentionally
     * zero apps) and for a summary that simply never covers UI. That card
     * measured the drop only through `UI:` and triage ruled narrowly on that
     * row, so the mechanism landed opt-in and `Data:`/`Logic:`/`Security:`
     * kept dropping.
     *
     * #10952 measured the same drop on the other three rows, against the real
     * CLI (`bin/run-dev.js validate`, `NO_COLOR=1`): on a stack with one
     * object, two fields and nothing else the entire summary was
     *
     *     Data: 1 Objects  2 Fields
     *     UI: 0 Apps
     *
     * with no `Logic:` and no `Security:` line present at all; on a stack that
     * also declares no objects it was the single line `UI: 0 Apps`. Both
     * exited `0`. Triage generalised #10504's principle — a summary section is
     * NEVER silently dropped; every section prints its zero state — so this is
     * no longer opt-in. The field is REQUIRED and typed non-empty, and that
     * typing is the enforcement: a section added to this array later cannot
     * compile without naming what it prints at zero, so the dropped-row defect
     * cannot be reintroduced one section at a time.
     *
     * Most sections name the single item carrying that section's signal
     * (`Apps` for `UI:` — the shipped shape). `Security:` names both of its
     * items; the rationale sits at its entry below.
     */
    zeroFallback: [string, ...string[]];
    /**
     * How this section's surviving items become the printed line.
     *
     * Omitted by every section that renders the shipped #10504 shape —
     * `<count> <Item>` with the count in white and the item name dim, joined
     * by two spaces (`Data: 1 Objects  2 Fields`). `Runtime:` is the one row
     * that has never rendered that way and still does not: it prints
     * `2 plugins, 1 devPlugins`, comma-joined and fully dim, with lowercase
     * item names. That difference is pre-existing shipped output and #11172
     * deliberately did NOT change it — the ruling was about the row's
     * PRESENCE at zero, not its typography, and rewriting a user-visible row's
     * look while fixing its zero state would be an unruled widening.
     *
     * This hook is what let `Runtime:` join the array (see its entry) instead
     * of getting a second, parallel no-silent-drop mechanism bolted on beside
     * the loop. One row's formatting is data on the row; the "never dropped"
     * guarantee stays single-sourced in the loop below.
     */
    render?: (shown: Array<[string, number]>) => string;
  }> = [
    {
      label: 'Data',
      items: [
        ['Objects', stats.objects],
        ['Fields', stats.fields],
        ['Extensions', stats.objectExtensions],
        ['Datasources', stats.datasources],
      ],
      // `Objects` is the section's signal: a stack with no objects has no data
      // model at all, which `validate` already warns about separately.
      zeroFallback: ['Objects'],
    },
    {
      label: 'UI',
      items: [
        ['Apps', stats.apps],
        ['Views', stats.views],
        ['Pages', stats.pages],
        ['Dashboards', stats.dashboards],
        ['Reports', stats.reports],
        ['Actions', stats.actions],
      ],
      // The shipped shape (#10504): `UI: 0 Apps`. Unchanged.
      zeroFallback: ['Apps'],
    },
    {
      label: 'Logic',
      items: [
        ['Flows', stats.flows],
        ['Workflows', stats.workflows],
        ['Agents', stats.agents],
        ['APIs', stats.apis],
      ],
      // `Flows` is this section's signal the way `Apps` is `UI:`'s — the
      // primary automation primitive, and the one the boot banner's own
      // automation summary counts.
      zeroFallback: ['Flows'],
    },
    {
      label: 'Security',
      items: [
        ['Positions', stats.positions],
        ['Permissions', stats.permissions],
      ],
      // BOTH peers, deliberately. `Security:` has no single canonical signal
      // the way `UI:` has `Apps`: `Positions` and `Permissions` are
      // independently authorable, so naming one would print a zero state that
      // silently omits the other — the very "reads as never asked" defect this
      // mechanism exists to remove. Printing both keeps the zero row's item set
      // identical to its non-zero rendering, built from the same
      // `<count> <Item>` fragments and the same two-space join as `UI: 0 Apps`,
      // so it is the shipped shape rather than a second formatting concept.
      zeroFallback: ['Positions', 'Permissions'],
    },
    {
      // #11172 — `Runtime:` used to be rendered OUTSIDE this loop, as a
      // standalone `if (stats.plugins > 0 || stats.devPlugins > 0)` after the
      // loop closed, so a stack with no plugins and no devPlugins printed no
      // `Runtime:` line at all. Same "reads as never asked, not as zero" defect
      // #10504 and #10952 removed from the sections, and measured the same way
      // (`bin/run-dev.js validate`, `NO_COLOR=1`, a stack declaring nothing).
      // The maintainer ruled it in (2026-08-23): `Runtime:` renders
      // unconditionally, joining the no-silent-drop invariant.
      //
      // Folded into the array rather than fixed in place. Being outside the
      // loop was not incidental to the defect — it is why #10952's mechanism
      // could not reach this row, and a hand-rolled zero case beside the loop
      // would have been a SECOND copy of the invariant, un-enforced by the
      // `zeroFallback` typing that stops the next row from being added without
      // one. The per-item `> 0` filter this row already applied is the same
      // filter the loop applies, so the only thing that had to be carried over
      // was its fragment style — see `render` on the type above.
      label: 'Runtime',
      items: [
        ['plugins', stats.plugins],
        ['devPlugins', stats.devPlugins],
      ],
      // `plugins` is this row's signal: `devPlugins` is a dev-only overlay on
      // it, so `Runtime: 0 devPlugins` would report the narrower fact and stay
      // silent about the broader one.
      zeroFallback: ['plugins'],
      render: (shown) => chalk.dim(shown.map(([k, v]) => `${v} ${k}`).join(', ')),
    },
  ];

  /** The shipped #10504 section shape — see `render` on the type above. */
  const countFragments = (shown: Array<[string, number]>) =>
    shown.map(([k, v]) => `${chalk.white(v)} ${chalk.dim(k)}`).join('  ');

  for (const section of sections) {
    let shown = section.items.filter(([, v]) => v > 0);
    if (shown.length === 0) {
      // Never drop the row (#10504, #10952, #11172) — the row is what says
      // "this project has none of this"; its absence says nothing at all.
      shown = section.zeroFallback
        .map((key) => section.items.find(([itemKey]) => itemKey === key))
        .filter((item): item is [string, number] => item !== undefined);
      // Defensive only — zeroFallback must name real items. A bare `Security:`
      // with no counts would read worse than the drop, so this one path still
      // omits the row.
      if (shown.length === 0) continue;
    }

    const line = (section.render ?? countFragments)(shown);
    console.log(`  ${chalk.bold(section.label + ':')} ${line}`);
  }
}

// ─── Author-time advisories ─────────────────────────────────────────

/**
 * One author-time advisory, in the shape the authoring-rule registry reports
 * (`@objectstack/lint`'s `splitBySeverity(...).advisories`) and the shape
 * `os build --json` / `os validate --json` publish under `warnings`.
 *
 * Declared structurally rather than re-exported from `@objectstack/lint` so
 * this rendering helper stays a pure formatter with no rule-engine import.
 */
export interface AuthoringAdvisory {
  where: string;
  message: string;
  rule: string;
  path: string;
  hint?: string;
}

/**
 * The pointer a truncation notice offers when — and ONLY when — the command's
 * own `--json` payload really does carry the list that was cut.
 *
 * Spelled once because the honesty of the sentence is per-SITE, not per-word.
 * `--json` publishes a different payload at every exit in every command, and
 * a notice pointing at one that omits its list is worse than a silent cut: it
 * sends the author down a path that returns the same truncated view. So each
 * call site below passes this only after its payload has been read, and the
 * sites whose list `--json` cannot carry — `os init` declares no `--json`
 * flag at all — pass `null` and state the remainder with no pointer.
 */
export const JSON_FULL_LIST_REMEDY = 're-run with --json for the full list';

/**
 * How many entries a diagnostic list renders in full before it switches to
 * the withheld-count line — the value every 50-capped render in the CLI's
 * `build` / `validate` / `init` diagnostics has always used.
 */
export const DIAGNOSTIC_PRINT_LIMIT = 50;

/**
 * Say that a rendered list was cut, and by exactly how much.
 *
 * ONE implementation of that sentence, deliberately. #11529 closed the
 * silence at the author-time advisory list; #11642 re-derived the population
 * from the DEFECT — a truncating render with no remainder line — and found
 * nine more across `compile` / `validate` / `init`. Nine copies of the
 * wording would be nine chances for them to drift apart, and the one thing a
 * reader must be able to trust is that a report which says nothing about a
 * remainder has none.
 *
 * The defect is the SILENCE, not the cap. Truncated output carrying no notice
 * is indistinguishable from complete output, so an author who reads it and
 * sees no further problems has read a list that stopped early. Hence the pair
 * this function encodes: over the cap the exact remainder is named, at or
 * under it NOTHING is printed — the absence is what makes the presence
 * informative, so both halves are pinned.
 *
 * `remedy` is a path to the complete output. It is optional, and it is the
 * caller's job to have verified it: see {@link JSON_FULL_LIST_REMEDY}.
 */
export function printTruncationNotice(options: {
  /** How many entries the list had. */
  total: number;
  /** How many of them the caller actually rendered. */
  shown: number;
  /** What the entries are, already plural — e.g. `author-time warning(s)`. */
  noun: string;
  /** A complete-output path that WORKS for this list, or `null` for none. */
  remedy?: string | null;
}): void {
  const withheld = options.total - options.shown;
  if (withheld <= 0) return;
  printWarning(
    `… and ${withheld} more ${options.noun} not shown (${options.shown} of ${options.total})` +
      (options.remedy ? ` — ${options.remedy}` : ''),
  );
}

/**
 * How many advisories `printAuthoringAdvisories` renders in full before it
 * switches to the withheld-count line. The cap itself is not the defect it
 * guards against — see below — so it keeps the value it has always had.
 */
export const AUTHORING_ADVISORY_PRINT_LIMIT = 50;

/**
 * Print author-time advisories, and — this is the point — say so when the
 * list was cut.
 *
 * #11529: `os build` printed a fixed 50 detailed entries and then stopped,
 * with nothing in the output saying the list had been truncated. Measured on
 * `objectstack-ai/hotcrm` with the published 17.1.0 CLI: two runs, 80 and then
 * 75 advisories, both printing exactly 50 entries and exactly 184 lines. The
 * summary line counted all of them (`⚠ 80 author-time warning(s) — see
 * above`) while only 50 were above, and removing five warnings made five
 * previously-unprinted ones appear — which reads as a regression caused by the
 * fix. Because the advisories are ordered by surface (pages, then views, then
 * flows), a repo whose page warnings alone exceed the cap keeps every `view`
 * and `flow` advisory permanently invisible.
 *
 * The defect is the SILENCE, not the cap. Truncated output that carries no
 * notice is not merely incomplete — it is indistinguishable from complete, so
 * an author who reads it and sees their file is clean has read a list that
 * stopped early. That is the same shape as the dropped summary rows above
 * (#10504, #10952): output that cannot distinguish "none" from "not shown".
 *
 * So the cap stays and the honesty line is added: over the limit, the exact
 * remainder is named; at or under it, no such line appears. The pointer is
 * `--json`, which already carries the whole set (`warnings: ruleAdvisories`)
 * — a complete-output path that exists today, rather than a new flag.
 *
 * Rendering for a set at or under the limit is byte-for-byte what it was.
 */
export function printAuthoringAdvisories(
  advisories: readonly AuthoringAdvisory[],
  limit: number = AUTHORING_ADVISORY_PRINT_LIMIT,
  remedy: string | null = JSON_FULL_LIST_REMEDY,
): void {
  if (advisories.length === 0) return;

  for (const f of advisories.slice(0, limit)) {
    printWarning(`${f.where}: ${f.message}`);
    if (f.hint) console.log(chalk.dim(`    ${f.hint}`));
    console.log(chalk.dim(`    rule: ${f.rule}  at ${f.path}`));
  }

  // [#11642] The notice sentence now lives in ONE place. Rendering here is
  // byte-for-byte what #11529 shipped — `printTruncationNotice` reproduces
  // the same wording from the same three numbers — and the third parameter
  // exists because `os init` renders this same advisory list with no `--json`
  // face to point at.
  printTruncationNotice({
    total: advisories.length,
    shown: Math.min(advisories.length, limit),
    noun: 'author-time warning(s)',
    remedy,
  });
}

/**
 * Errors and advisories are the SAME registry shape — `AuthoringFinding` in
 * `@objectstack/lint`, split only by `severity` — so both printers take one
 * type. The `AuthoringAdvisory` name predates the error printer below; new
 * call sites should read this alias.
 */
export type AuthoringRuleFinding = AuthoringAdvisory;

/**
 * Print the GATING author-time rule failures, and name the remainder when the
 * list was cut.
 *
 * Three commands rendered this identical three-line block inline, each behind
 * its own `.slice(0, 50)` and none of them saying so (#11642): `os build`,
 * `os validate` and `os init`'s scaffold self-test. The comment
 * `validate.ts` carries over its own block is the reason the silence matters
 * here and not only on the advisory path — "the command used to exit at the
 * first failing gate, so an author with three unrelated problems fixed them
 * in three round trips and could not see how deep the hole went". A capped
 * list with no notice restores a smaller version of exactly that: past the
 * cap each round of fixes reveals a new batch that reads as fresh breakage.
 *
 * The `hint` line is conditional, which is how `printAuthoringAdvisories` and
 * `init` already rendered it; `compile`/`validate` printed it unconditionally.
 * `AuthoringFinding.hint` is a required non-empty string in every rule the
 * registry ships (checked: no rule emits an empty one), so the two forms
 * differ on no finding this CLI can actually produce.
 */
export function printAuthoringRuleErrors(
  errors: readonly AuthoringRuleFinding[],
  options: { limit?: number; remedy?: string | null } = {},
): void {
  const limit = options.limit ?? DIAGNOSTIC_PRINT_LIMIT;
  for (const f of errors.slice(0, limit)) {
    console.log(`  • ${f.where}: ${f.message}`);
    if (f.hint) console.log(chalk.dim(`      ${f.hint}`));
    console.log(chalk.dim(`      rule: ${f.rule}  at ${f.path}`));
  }
  printTruncationNotice({
    total: errors.length,
    shown: Math.min(errors.length, limit),
    noun: 'author-time rule failure(s)',
    remedy: options.remedy,
  });
}

/** One package-doc lint issue, in the shape `collectAndLintDocs` reports. */
export interface DocIssueRow {
  path: string;
  message: string;
  rule: string;
}

/**
 * Print package-doc (ADR-0046) errors, and name the remainder when the list
 * was cut. Shared by `os build` and `os validate`, which ran byte-identical
 * capped loops (#11642).
 */
export function printDocIssueErrors(
  issues: readonly DocIssueRow[],
  options: { limit?: number; remedy?: string | null } = {},
): void {
  const limit = options.limit ?? DIAGNOSTIC_PRINT_LIMIT;
  for (const i of issues.slice(0, limit)) {
    console.log(`  • ${i.path}: ${i.message}`);
    console.log(chalk.dim(`      rule: ${i.rule}`));
  }
  printTruncationNotice({
    total: issues.length,
    shown: Math.min(issues.length, limit),
    noun: 'package-doc error(s)',
    remedy: options.remedy,
  });
}

/**
 * Print an already-formatted list as `  • <line>` bullets, and name the
 * remainder when the list was cut.
 *
 * For the diagnostics whose entries are strings by the time they reach the
 * printer: the undeclared-authoring-key findings, the access-matrix drift
 * lines, and `--strict-body`'s refusal list (#11642). `noun` is required
 * rather than defaulted — a notice that names the wrong thing is the same
 * class of unhelpful as one that names nothing.
 */
export function printBulletList(
  lines: readonly string[],
  options: { noun: string; limit?: number; remedy?: string | null },
): void {
  const limit = options.limit ?? DIAGNOSTIC_PRINT_LIMIT;
  for (const line of lines.slice(0, limit)) console.log(`  • ${line}`);
  printTruncationNotice({
    total: lines.length,
    shown: Math.min(lines.length, limit),
    noun: options.noun,
    remedy: options.remedy,
  });
}
