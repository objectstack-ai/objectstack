// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import chalk from 'chalk';
import type { ZodError } from 'zod';

// ─── Constants ──────────────────────────────────────────────────────
export const CLI_NAME = 'objectstack';
export const CLI_ALIAS = 'os';

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
