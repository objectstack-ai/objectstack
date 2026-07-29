// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import chalk from 'chalk';
import type { ZodError } from 'zod';

// ─── Constants ──────────────────────────────────────────────────────
export const CLI_NAME = 'objectstack';
export const CLI_ALIAS = 'os';

// ─── Machine-readable output ────────────────────────────────────────

export interface EmitJsonOptions {
  /**
   * Emit on a single line instead of 2-space-indented.
   *
   * Exists so the sweep onto `emitJson` could be a pure truncation fix with no
   * observable output change: roughly half the CLI's `--json` sites were
   * already compact and half indented, and this preserves whichever each one
   * emitted. The split is accidental rather than designed — `os login --json`
   * prints a compact payload and then an indented one in the same run — so
   * unifying it is worth doing, but as its own decision, not as a side effect
   * of fixing truncated pipes.
   *
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
  exitCode = 0,
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
export async function emitText(text: string, exitCode = 0): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    process.stdout.write(text + '\n', (err) => (err ? reject(err) : resolve()));
  });
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
  themes: number;
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
    themes: count(config.themes),
    datasources: count(config.datasources),
    translations: count(config.translations),
    plugins: count(config.plugins),
    devPlugins: count(config.devPlugins),
  };
}

// ─── Server Ready Banner ────────────────────────────────────────────

export interface ServerReadyOptions {
  port: number;
  configFile: string;
  isDev: boolean;
  pluginCount: number;
  pluginNames?: string[];
  uiEnabled?: boolean;
  consolePath?: string;
  /** Resolved storage driver display name (e.g. "MongoDBDriver", "SqlDriver(pg)"). */
  driverLabel?: string;
  /** Resolved DB URL with credentials redacted. */
  databaseUrl?: string;
  /** Whether the SecurityPlugin was wired in multi-tenant mode (default true). */
  multiTenant?: boolean;
  /**
   * Credentials of the dev admin seeded on an empty DB this boot (dev only).
   * When present, the banner surfaces them so backend debugging never has to
   * guess the login. Absent when nothing was seeded.
   */
  seededAdmin?: { email: string; password: string };
  /**
   * Automation wiring summary (2026-07-17 third-party eval). The boot-quiet
   * stdout window swallows every info/warn the automation engine logs while
   * binding flows to triggers, so the banner is the ONE reliable place a
   * developer can see whether their record-change / schedule flows actually
   * armed. Collected from the live engine after runtime.start().
   */
  automation?: AutomationReadySummary;
  /**
   * Per-source seed outcomes for this boot (#3415/#3430). Seeds run inside the
   * boot-quiet stdout window and SeedLoader's own logs sit under the default
   * warn level, so without this line a fixture can silently lose most of its
   * rows (the showcase shipped 1 of 5 projects for weeks) and a marketplace
   * package can rehydrate onto a fresh DB with zero rows. Each config app and
   * each rehydrated/healed marketplace package contributes one entry;
   * rejections and empty installs are loud, a clean seed prints one dim line.
   */
  seeds?: SeedSourceSummary[];
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

export function printServerReady(opts: ServerReadyOptions) {
  const base = `http://localhost:${opts.port}`;
  console.log('');
  console.log(chalk.bold.green('  ✓ Server is ready'));
  console.log('');
  console.log(chalk.cyan('  ➜') + chalk.bold('  API:       ') + chalk.cyan(base + '/'));
  if (opts.uiEnabled && opts.consolePath) {
    console.log(chalk.cyan('  ➜') + chalk.bold('  Console:   ') + chalk.cyan(base + opts.consolePath + '/'));
  }
  if (opts.mcpEnabled) {
    console.log(chalk.cyan('  ➜') + chalk.bold('  MCP:       ') + chalk.cyan(base + '/api/v1/mcp'));
    console.log(chalk.dim(`      connect an AI client (Claude Code, Cursor, …) · skill: ${base}/api/v1/mcp/skill`));
  }
  if (opts.seededAdmin) {
    console.log('');
    console.log(
      chalk.green('  🔑') + chalk.bold('  Dev admin: ') +
      chalk.bold.green(`${opts.seededAdmin.email} / ${opts.seededAdmin.password}`),
    );
    console.log(chalk.dim('      seeded on empty DB · dev only — do not use in production'));
  }
  console.log('');
  console.log(chalk.dim(`  Config:  ${opts.configFile}`));
  console.log(chalk.dim(`  Mode:    ${opts.isDev ? 'development' : 'production'}`));
  if (opts.driverLabel) {
    const dbInfo = opts.databaseUrl ? `${opts.driverLabel}  ${chalk.dim('→')} ${opts.databaseUrl}` : opts.driverLabel;
    console.log(chalk.dim(`  Driver:  ${dbInfo}`));
  }
  if (opts.multiTenant !== undefined) {
    console.log(chalk.dim(`  Tenancy: ${opts.multiTenant ? 'multi-tenant' : 'single-tenant'}`));
  }
  console.log(chalk.dim(`  Plugins: ${opts.pluginCount} loaded`));
  if (opts.pluginNames && opts.pluginNames.length > 0) {
    console.log(chalk.dim(`           ${opts.pluginNames.join(', ')}`));
  }
  if (opts.automation) printAutomationSummary(opts.automation);
  if (opts.seeds) printSeedSummary(opts.seeds);
  console.log('');
  console.log(chalk.dim('  Press Ctrl+C to stop'));
  console.log('');
}

/**
 * One-glance answer to "did my flows actually arm?" — the question the
 * boot-quiet stdout window otherwise makes unanswerable (the engine's own
 * bind/registration logs are swallowed during startup).
 */
function printAutomationSummary(a: AutomationReadySummary) {
  if (!a.enabled) {
    if (a.declaredFlowCount > 0) {
      console.log(
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
  console.log(chalk.dim(`  Flows:   ${parts.join(' ')}`));

  for (const u of a.unbound) {
    console.log(
      chalk.yellow(`  ⚠ flow '${u.flowName}' declares a '${u.triggerType}' trigger but is NOT bound — ${u.reason}`),
    );
  }
  for (const u of a.unknownObject) {
    console.log(
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
    console.log(chalk.yellow(`  ⚠ Seeds:   ${line}`));
    console.log(chalk.dim('      run with OS_LOG_LEVEL=info to see each dropped record'));
    return;
  }
  console.log(chalk.dim(`  Seeds:   ${line}`));
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
        ['Themes', stats.themes],
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
