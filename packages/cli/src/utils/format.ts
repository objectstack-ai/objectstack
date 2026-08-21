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
  translations: number;
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
    translations: count(config.translations),
    plugins: count(config.plugins),
    devPlugins: count(config.devPlugins),
  };
}

// ─── Server Ready Banner ────────────────────────────────────────────

export interface ServerReadyOptions {
  port: number;
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
  const base = `http://localhost:${opts.port}`;
  console.error('');
  console.error(chalk.bold.green('  ✓ Server is ready'));
  console.error('');
  console.error(chalk.cyan('  ➜') + chalk.bold('  API:       ') + chalk.cyan(base + '/'));
  if (opts.uiEnabled && opts.consolePath) {
    console.error(chalk.cyan('  ➜') + chalk.bold('  Console:   ') + chalk.cyan(base + opts.consolePath + '/'));
  }
  if (opts.mcpEnabled) {
    console.error(chalk.cyan('  ➜') + chalk.bold('  MCP:       ') + chalk.cyan(base + '/api/v1/mcp'));
    console.error(chalk.dim(`      connect an AI client (Claude Code, Cursor, …) · skill: ${base}/api/v1/mcp/skill`));
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
  const sections: Array<{ label: string; items: Array<[string, number]> }> = [
    {
      label: 'Data',
      items: [
        ['Objects', stats.objects],
        ['Fields', stats.fields],
        ['Extensions', stats.objectExtensions],
        ['Datasources', stats.datasources],
      ],
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
    },
    {
      label: 'Logic',
      items: [
        ['Flows', stats.flows],
        ['Workflows', stats.workflows],
        ['Agents', stats.agents],
        ['APIs', stats.apis],
      ],
    },
    {
      label: 'Security',
      items: [
        ['Positions', stats.positions],
        ['Permissions', stats.permissions],
      ],
    },
  ];

  for (const section of sections) {
    const nonZero = section.items.filter(([, v]) => v > 0);
    if (nonZero.length === 0) continue;
    
    const line = nonZero.map(([k, v]) => `${chalk.white(v)} ${chalk.dim(k)}`).join('  ');
    console.log(`  ${chalk.bold(section.label + ':')} ${line}`);
  }

  if (stats.plugins > 0 || stats.devPlugins > 0) {
    const parts: string[] = [];
    if (stats.plugins > 0) parts.push(`${stats.plugins} plugins`);
    if (stats.devPlugins > 0) parts.push(`${stats.devPlugins} devPlugins`);
    console.log(`  ${chalk.bold('Runtime:')} ${chalk.dim(parts.join(', '))}`);
  }
}
