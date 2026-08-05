// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { normalizeStackInput } from '@objectstack/spec';
import { printHeader, printSuccess, printWarning, printError, printStep, printInfo } from '../utils/format.js';
import { loadConfig, configExists } from '../utils/config.js';
import { checkSpecVersionGap } from '../utils/spec-version.js';
import { validateWidgetBindings } from '@objectstack/lint';
import {
  resolveTenancyPosture,
  collectGlobalUniques,
  unconfirmedGlobalUniques,
  describeGlobalUniqueFinding,
  postureGatesGlobalUniques,
  GLOBAL_UNIQUE_ISOLATED_PRESCRIPTION,
  type GlobalUniqueFinding,
} from '@objectstack/types';
// The posture vocabulary, read from the package that DEFINES it (#5382) — the
// fix list below enumerates the accepted values, and a second literal list
// would be free to drift the day a posture is added.
import { TENANCY_POSTURES, type TenancyPosture } from '@objectstack/spec/security';

interface HealthCheckResult {
  name: string;
  status: 'ok' | 'warning' | 'error';
  message: string;
  fix?: string;
}

// ─── Tenancy Posture ────────────────────────────────────────────────

/**
 * One-line descriptions of the accepted postures, keyed by the vocabulary
 * `@objectstack/spec/security` owns. A posture declared there but not described
 * here is still listed by the fix list (bare, without prose) rather than
 * silently dropped — the advice can go terse, never stale.
 */
const TENANCY_POSTURE_FIX_HINTS: Readonly<Record<string, string>> = {
  single: 'one organization, no organization wall — the default',
  group: 'organization wall enforced by the open engine, one shared database',
  isolated:
    'organization wall + the enterprise @objectstack/organizations runtime '
    + "(the legacy spelling 'multi' is accepted and normalizes to this)",
};

/**
 * What doctor's tenancy-posture read decided (#5382).
 *
 * A verdict object rather than a throw. `resolveTenancyPosture()` refuses an
 * unrecognized value by throwing, and doctor's every posture read used to sit
 * inside the broad config-analysis `try` — so the refusal arrived as
 * `⚠ Could not load config for analysis`, a warning, about the wrong subject,
 * with exit code 0. A verdict cannot be caught by an unrelated `catch`.
 */
export type TenancyPostureReading =
  | { ok: true; posture: TenancyPosture }
  | { ok: false; result: HealthCheckResult };

/**
 * Resolve the environment's requested tenancy posture, or produce the
 * health-check finding that reports an unrecognized value (#5382).
 *
 * `resolveTenancyPosture()` (`@objectstack/types`) is the authority on the
 * vocabulary and already refuses an unrecognized value — this wrapper does NOT
 * re-decide that. It changes HOW the refusal travels and what it says.
 *
 * Why it exists: doctor read the posture in two places
 * (`findUnscopedGlobalUniques()` and the ADR-0120 D5e gate), both of them under
 * the wide `try` that guards config analysis, whose `catch` prints
 * `Could not load config for analysis (config checks skipped)` and counts a
 * WARNING. An environment that `os serve` flatly refuses to boot was therefore
 * reported by `os doctor` as "functional", exit 0, without the string
 * `OS_TENANCY_POSTURE` appearing anywhere in the run — sending the operator to
 * look at their config, which was fine. That is the "diagnostic surface
 * disagrees with the runtime" class of #4801 / cloud#1020, landed on the very
 * command an operator reaches for after `serve` fails.
 *
 * The counterpart in `serve.ts` (`resolveTenancyPostureOrRefusal`, #5359) has
 * the same shape but a different verdict, and deliberately so: serve REFUSES
 * (FATAL + `process.exit(1)` before any boot work), doctor REPORTS (an `error`
 * health check that flows through doctor's own error summary). The wording
 * differs for the same reason — see the `.env` note below, which is true of
 * doctor and false of serve.
 */
export function resolveTenancyPostureOrFinding(): TenancyPostureReading {
  try {
    return { ok: true, posture: resolveTenancyPosture() };
  } catch (err) {
    const raw = (globalThis as { process?: { env?: Record<string, string | undefined> } })
      .process?.env?.OS_TENANCY_POSTURE;
    const cause = err instanceof Error ? err.message : String(err);
    const fixes = TENANCY_POSTURES.map((posture) => {
      const hint = TENANCY_POSTURE_FIX_HINTS[posture];
      return `        • OS_TENANCY_POSTURE=${posture}${hint ? ` — ${hint}` : ''}`;
    }).join('\n');
    return {
      ok: false,
      result: {
        name: 'Tenancy posture',
        status: 'error',
        message:
          `OS_TENANCY_POSTURE=${JSON.stringify(String(raw ?? ''))} is not a recognized tenancy posture`
          + ' — `os serve` refuses to boot this environment',
        fix:
          'Set one of the accepted values:\n'
          + `${fixes}\n`
          + '        • or unset OS_TENANCY_POSTURE entirely — the posture then derives from\n'
          + '          OS_MULTI_ORG_ENABLED (true ⇒ isolated, anything else ⇒ single)\n'
          // Said out loud because it is a real limit of THIS report, and the
          // opposite of serve's gate, which runs after `dotenv-flow` has loaded.
          // `os doctor` loads no `.env*`, so a posture that lives in a committed
          // `.env` reaches the server and never reaches this check — a green
          // doctor is not proof that serve will accept the posture.
          + '      Read from this process\'s environment only: unlike `os serve`, `os doctor` does not\n'
          + '      load `.env*` files, so a value set in one is not visible here.\n'
          // The resolver owns the vocabulary and its wording; quoting rather
          // than paraphrasing keeps doctor from maintaining a second copy that
          // can disagree with it.
          + `      cause: ${cause}`,
      },
    };
  }
}

// ─── Config-Aware Checks ────────────────────────────────────────────

function detectCircularDependencies(objects: any[]): string[] {
  const issues: string[] = [];
  const graph = new Map<string, string[]>();

  for (const obj of objects) {
    const deps: string[] = [];
    if (obj.fields && typeof obj.fields === 'object') {
      for (const field of Object.values(obj.fields) as any[]) {
        if (field?.type === 'lookup' && field?.reference) {
          deps.push(field.reference);
        }
      }
    }
    graph.set(obj.name, deps);
  }

  // DFS cycle detection
  const visited = new Set<string>();
  const stack = new Set<string>();

  function dfs(node: string, path: string[]): boolean {
    if (stack.has(node)) {
      const cycleStart = path.indexOf(node);
      const cycle = path.slice(cycleStart).concat(node);
      issues.push(`Circular dependency: ${cycle.join(' → ')}`);
      return true;
    }
    if (visited.has(node)) return false;

    visited.add(node);
    stack.add(node);

    for (const dep of graph.get(node) || []) {
      if (graph.has(dep)) {
        dfs(dep, [...path, node]);
      }
    }

    stack.delete(node);
    return false;
  }

  for (const name of graph.keys()) {
    if (!visited.has(name)) {
      dfs(name, []);
    }
  }

  return issues;
}

// ── Object-reference walking ────────────────────────────────────────
// A `config.views` entry is a ViewSchema CONTAINER (`{ list, form, listViews,
// formViews }` — the defineView() shape): the object binding lives on each
// sub-view at `data.object` (provider 'object'), never on a top-level
// `view.object`. Legacy flat ViewItems (top-level `object`) are still read.

function* subViewsOf(view: any): Generator<[slot: string, subView: any]> {
  if (!view || typeof view !== 'object') return;
  if (view.list) yield ['list', view.list];
  if (view.form) yield ['form', view.form];
  for (const [key, sub] of Object.entries<any>(
    view.listViews && typeof view.listViews === 'object' ? view.listViews : {},
  )) {
    yield [`listViews.${key}`, sub];
  }
  for (const [key, sub] of Object.entries<any>(
    view.formViews && typeof view.formViews === 'object' ? view.formViews : {},
  )) {
    yield [`formViews.${key}`, sub];
  }
}

function subViewObject(sub: any): string | undefined {
  if (typeof sub?.data?.object === 'string') return sub.data.object;
  if (typeof sub?.objectName === 'string') return sub.objectName;
  return undefined;
}

/** Every object name a view (container or legacy flat item) references. */
function collectViewObjectRefs(view: any): string[] {
  const refs: string[] = [];
  if (typeof view?.object === 'string') refs.push(view.object);
  for (const [, sub] of subViewsOf(view)) {
    const bound = subViewObject(sub);
    if (bound) refs.push(bound);
    // Inline master-detail children and lookup form fields are references too.
    for (const subform of Array.isArray(sub?.subforms) ? sub.subforms : []) {
      if (typeof subform?.childObject === 'string') refs.push(subform.childObject);
    }
    for (const section of Array.isArray(sub?.sections) ? sub.sections : []) {
      for (const field of Array.isArray(section?.fields) ? section.fields : []) {
        if (typeof field?.reference === 'string') refs.push(field.reference);
      }
    }
  }
  return refs;
}

/**
 * Every object name an app's navigation references. Object nav items carry
 * `objectName` (AppSchema `ObjectNavItemSchema`), nest under `children`, and
 * may live in `areas[*].navigation` instead of the top-level `navigation`.
 */
function collectAppObjectRefs(app: any): string[] {
  const refs: string[] = [];
  const walk = (items: any): void => {
    if (!Array.isArray(items)) return;
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      if (typeof item.objectName === 'string') refs.push(item.objectName);
      if (typeof item.object === 'string') refs.push(item.object);
      if (typeof item.requiresObject === 'string') refs.push(item.requiresObject);
      walk(item.children);
    }
  };
  walk(app?.navigation);
  for (const area of Array.isArray(app?.areas) ? app.areas : []) {
    walk(area?.navigation);
  }
  return refs;
}

export function findOrphanViews(config: any): string[] {
  const objectNames = new Set<string>();
  if (Array.isArray(config.objects)) {
    for (const obj of config.objects) {
      if (obj.name) objectNames.add(obj.name);
    }
  }

  const orphans: string[] = [];
  if (Array.isArray(config.views)) {
    for (const view of config.views) {
      if (typeof view?.object === 'string' && !objectNames.has(view.object)) {
        orphans.push(`View "${view.name || '?'}" references non-existent object "${view.object}"`);
      }
      for (const [slot, sub] of subViewsOf(view)) {
        const bound = subViewObject(sub);
        if (bound && !objectNames.has(bound)) {
          orphans.push(
            `View "${view?.name || sub?.label || slot}" (${slot}) references non-existent object "${bound}"`,
          );
        }
      }
    }
  }
  return orphans;
}

export function findUnusedObjects(config: any): string[] {
  const objectNames = new Set<string>();
  if (Array.isArray(config.objects)) {
    for (const obj of config.objects) {
      if (obj.name) objectNames.add(obj.name);
    }
  }

  const referencedObjects = new Set<string>();

  // Views — container sub-views (data.object), subforms, lookup form fields.
  if (Array.isArray(config.views)) {
    for (const view of config.views) {
      for (const ref of collectViewObjectRefs(view)) referencedObjects.add(ref);
    }
  }

  // Flows — the bound object lives inside node config (FlowNodeSchema.config
  // is unstructured; `object`/`objectName` is the canonical alias pair used
  // by record_change triggers and CRUD nodes).
  if (Array.isArray(config.flows)) {
    for (const flow of config.flows) {
      if (flow.trigger?.object) referencedObjects.add(flow.trigger.object);
      if (flow.object) referencedObjects.add(flow.object);
      for (const node of Array.isArray(flow?.nodes) ? flow.nodes : []) {
        const cfg = node?.config;
        if (typeof cfg?.object === 'string') referencedObjects.add(cfg.object);
        if (typeof cfg?.objectName === 'string') referencedObjects.add(cfg.objectName);
      }
    }
  }

  // Apps — navigation (top-level, nested children, and areas).
  if (Array.isArray(config.apps)) {
    for (const app of config.apps) {
      for (const ref of collectAppObjectRefs(app)) referencedObjects.add(ref);
    }
  }

  // Lookup fields reference other objects
  if (Array.isArray(config.objects)) {
    for (const obj of config.objects) {
      if (obj.fields && typeof obj.fields === 'object') {
        for (const field of Object.values(obj.fields) as any[]) {
          if (field?.type === 'lookup' && field?.reference) {
            referencedObjects.add(field.reference);
          }
        }
      }
    }
  }

  const unused: string[] = [];
  for (const name of objectNames) {
    if (!referencedObjects.has(name)) {
      unused.push(`Object "${name}" is defined but not referenced by any view, flow, app, or lookup field`);
    }
  }
  return unused;
}

// ─── ADR-0120 D5e — `isolated`-posture unique-scope advisory ────────

/**
 * The ADVISORY half of ADR-0120 D5e.
 *
 * The hard gate lives at the install seam, where the two things it needs are
 * both present: the app being installed, and an installer who can answer. It
 * structurally cannot reach two populations, and this is where those are
 * reported instead:
 *
 * 1. **Installs that predate the gate** — a ledger entry with no attestation.
 * 2. **Environments whose posture changed after install** — nothing was
 *    installed under `isolated`, so nothing was ever asked.
 *
 * Plus the case with no install seam at all: an app declared in this project's
 * own `objectstack.config.ts`, which is code, not a marketplace install.
 *
 * ⛔ This is `os doctor` / `os migrate plan`, deliberately — NOT a boot-time
 * warning. A startup diagnostic here would fire on every boot of every affected
 * deployment forever, which is the #4884 false-alarm class the ADR names by
 * number. A command someone runs on purpose is the right frequency for a
 * finding whose resolution is a human/agent decision.
 */
interface UniqueScopeAdvisory {
  /** Where the finding came from — a config-declared app, or a ledger entry. */
  source: string;
  finding: GlobalUniqueFinding;
}

/** Read the installed-package ledger without going through HTTP. Best-effort:
 *  a runtime that never installed anything simply has no directory. */
async function readInstalledPackageEntries(cwd: string): Promise<any[]> {
  try {
    // Dynamic, like serve.ts's cloud-connection load: `os doctor` must still
    // run in a checkout where the optional package is not resolvable.
    const mod: any = await import('@objectstack/cloud-connection');
    const dir = path.join(cwd, mod.DEFAULT_INSTALLED_PACKAGES_DIR ?? '.objectstack/installed-packages');
    if (!fs.existsSync(dir)) return [];
    return new mod.LocalManifestSource(dir).list();
  } catch {
    return [];
  }
}

/**
 * Collect every unanswered installation-wide unique this environment would run
 * under `isolated`. Returns an empty list under every other posture: there
 * `'global'` is the correct, unambiguous meaning (`single` = one customer;
 * `group` = the installation IS the customer company).
 */
async function findUnscopedGlobalUniques(
  cwd: string,
  config: any,
  // #5382 — the posture the caller already resolved, not a fresh parse. This
  // function runs inside doctor's broad config-analysis `try`, so a
  // `resolveTenancyPosture()` here is a throw the wrong `catch` reports as
  // "Could not load config for analysis".
  posture: TenancyPosture,
): Promise<UniqueScopeAdvisory[]> {
  if (!postureGatesGlobalUniques(posture)) return [];

  const out: UniqueScopeAdvisory[] = [];
  for (const finding of collectGlobalUniques(config?.objects)) {
    out.push({ source: 'this project’s metadata', finding });
  }
  for (const entry of await readInstalledPackageEntries(cwd)) {
    const findings = collectGlobalUniques(entry?.manifest?.objects);
    // Subtract what the install ceremony already answered for — an attested
    // install must not be re-reported, or the advisory becomes the recurring
    // nag the gate exists to avoid.
    for (const finding of unconfirmedGlobalUniques(findings, entry?.globalUniqueAttestation, posture)) {
      out.push({ source: `installed package '${entry?.manifestId ?? entry?.packageId}'`, finding });
    }
  }
  return out;
}

// ─── Filesystem Checks ──────────────────────────────────────────────

function walkDir(dir: string, ext: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'node_modules') continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkDir(fullPath, ext));
    } else if (entry.name.endsWith(ext)) {
      results.push(fullPath);
    }
  }
  return results;
}

function findMissingTests(cwd: string): string[] {
  const specSrcDir = path.join(cwd, 'packages/spec/src');
  if (!fs.existsSync(specSrcDir)) return [];

  const missing: string[] = [];
  const zodFiles = walkDir(specSrcDir, '.zod.ts');

  for (const zodFile of zodFiles) {
    const testFile = zodFile.replace('.zod.ts', '.test.ts');
    if (!fs.existsSync(testFile)) {
      const relZod = path.relative(specSrcDir, zodFile);
      const relTest = path.relative(specSrcDir, testFile);
      missing.push(`Missing test: ${relTest} (for ${relZod})`);
    }
  }
  return missing;
}

function findDeprecatedUsages(cwd: string): string[] {
  const specSrcDir = path.join(cwd, 'packages/spec/src');
  if (!fs.existsSync(specSrcDir)) return [];

  const deprecated: string[] = [];
  const tsFiles = walkDir(specSrcDir, '.ts')
    .filter((f) => !f.endsWith('.test.ts'));

  for (const tsFile of tsFiles) {
    try {
      const content = fs.readFileSync(tsFile, 'utf-8');
      const lines = content.split('\n');
      const relPath = path.relative(specSrcDir, tsFile);
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('@deprecated')) {
          deprecated.push(`${relPath}:${i + 1} — @deprecated tag found`);
        }
      }
    } catch {
      // Skip unreadable files
    }
  }
  return deprecated;
}

// ─── Deprecated Pattern Detection ───────────────────────────────────

const DEPRECATED_PATTERNS: Array<{
  pattern: RegExp;
  description: string;
  replacement: string;
}> = [
  {
    pattern: /\bEnhancedObjectKernel\b/,
    description: 'EnhancedObjectKernel is deprecated in v3',
    replacement: 'Use ObjectKernel instead',
  },
  {
    pattern: /\bmax_length\b/,
    description: 'snake_case config key: max_length',
    replacement: 'Use maxLength (camelCase)',
  },
  {
    pattern: /\bdefault_value\b/,
    description: 'snake_case config key: default_value',
    replacement: 'Use defaultValue (camelCase)',
  },
  {
    pattern: /\bmin_length\b/,
    description: 'snake_case config key: min_length',
    replacement: 'Use minLength (camelCase)',
  },
  {
    // `referenceFilters` was REMOVED from FieldSchema (#2377 / ADR-0049); its
    // successor is `lookupFilters` (read by the objectui LookupField picker).
    // Pointing at the removed key sent authors to a silently-stripped spelling.
    pattern: /\breference_filters\b|\breferenceFilters\b/,
    description: 'retired lookup-scoping key: reference_filters / referenceFilters',
    replacement: 'Use lookupFilters (camelCase) — `referenceFilters` was removed in #2377',
  },
  {
    pattern: /\bunique_name\b/,
    description: 'snake_case config key: unique_name',
    replacement: 'Use uniqueName (camelCase)',
  },
  {
    pattern: /from\s+['"]@objectstack\/core\/enhanced['"]/,
    description: 'Import from deprecated @objectstack/core/enhanced path',
    replacement: "Use import from '@objectstack/core'",
  },
  {
    pattern: /from\s+['"]@objectstack\/spec\/dist\/[^'"]+['"]/,
    description: 'Import from deprecated @objectstack/spec/dist/ deep path',
    replacement: "Use import from '@objectstack/spec'",
  },
];

function scanDeprecatedPatterns(dir: string): Array<{ file: string; line: number; description: string; replacement: string }> {
  const results: Array<{ file: string; line: number; description: string; replacement: string }> = [];
  if (!fs.existsSync(dir)) return results;

  const tsFiles = walkDir(dir, '.ts').filter(f => !f.endsWith('.test.ts'));

  for (const tsFile of tsFiles) {
    try {
      const content = fs.readFileSync(tsFile, 'utf-8');
      const lines = content.split('\n');
      const relPath = path.relative(process.cwd(), tsFile);

      for (let i = 0; i < lines.length; i++) {
        for (const dp of DEPRECATED_PATTERNS) {
          if (dp.pattern.test(lines[i])) {
            results.push({
              file: relPath,
              line: i + 1,
              description: dp.description,
              replacement: dp.replacement,
            });
          }
        }
      }
    } catch {
      // Skip unreadable files
    }
  }
  return results;
}

// ─── Command ────────────────────────────────────────────────────────

export default class Doctor extends Command {
  static override description = 'Check development environment and configuration health';

  static override flags = {
    verbose: Flags.boolean({ char: 'v', description: 'Show detailed information' }),
    'scan-deprecations': Flags.boolean({ description: 'Scan for deprecated ObjectStack patterns' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Doctor);

    printHeader('Environment Health Check');

    const results: HealthCheckResult[] = [];

    // ── Tenancy posture (#5382) ──────────────────────────────────────
    // Resolve ONCE, here, OUTSIDE every `try` in this method.
    //
    // Placement is the whole fix. Doctor's two posture readers — the ADR-0120
    // D5e unique-scope gate and `findUnscopedGlobalUniques()` — both sat under
    // the wide config-analysis `try` further down, whose `catch` prints
    // `Could not load config for analysis (config checks skipped)` and records
    // a WARNING. So an unrecognized `OS_TENANCY_POSTURE` produced a report that
    // blamed the config (which was fine), never printed the variable's name,
    // and exited 0 under `⚠️  Environment is functional` — while `os serve`
    // refused to boot the identical environment.
    //
    // Reading it here also widens the fix past the issue's own repro: those
    // readers only ran `if (configExists())`, so an environment with no
    // `objectstack.config.ts` never read the posture at all and said nothing
    // whatsoever about it.
    //
    // Note this REPORTS rather than refuses — no `process.exit(1)` here. The
    // finding is an ordinary `error` health check, so the rest of the report
    // still runs and doctor's own summary owns the non-zero exit.
    const postureReading = resolveTenancyPostureOrFinding();

    // Check Node.js version
    try {
      const nodeVersion = process.version;
      const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0]);
      
      if (majorVersion >= 18) {
        results.push({
          name: 'Node.js',
          status: 'ok',
          message: `Version ${nodeVersion}`,
        });
      } else {
        results.push({
          name: 'Node.js',
          status: 'error',
          message: `Version ${nodeVersion} (requires >= 18.0.0)`,
          fix: 'Upgrade Node.js: https://nodejs.org',
        });
      }
    } catch (error) {
      results.push({
        name: 'Node.js',
        status: 'error',
        message: 'Not found',
        fix: 'Install Node.js: https://nodejs.org',
      });
    }
    
    // Check pnpm
    try {
      const pnpmVersion = execSync('pnpm -v', { encoding: 'utf-8' }).trim();
      results.push({
        name: 'pnpm',
        status: 'ok',
        message: `Version ${pnpmVersion}`,
      });
    } catch (error) {
      results.push({
        name: 'pnpm',
        status: 'error',
        message: 'Not found',
        fix: 'Install pnpm: npm install -g pnpm@10.28.1',
      });
    }
    
    // Check TypeScript
    try {
      const tscVersion = execSync('tsc -v', { encoding: 'utf-8' }).trim();
      results.push({
        name: 'TypeScript',
        status: 'ok',
        message: tscVersion,
      });
    } catch (error) {
      results.push({
        name: 'TypeScript',
        status: 'warning',
        message: 'Not found in PATH',
        fix: 'Installed locally via pnpm',
      });
    }
    
    // Check if dependencies are installed
    const cwd = process.cwd();
    const nodeModulesPath = path.join(cwd, 'node_modules');
    
    if (fs.existsSync(nodeModulesPath)) {
      results.push({
        name: 'Dependencies',
        status: 'ok',
        message: 'Installed',
      });
    } else {
      results.push({
        name: 'Dependencies',
        status: 'error',
        message: 'Not installed',
        fix: 'Run: pnpm install',
      });
    }
    
    // Check if spec package is built
    const specDistPath = path.join(cwd, 'packages/spec/dist');
    
    if (fs.existsSync(specDistPath)) {
      results.push({
        name: '@objectstack/spec',
        status: 'ok',
        message: 'Built',
      });
    } else {
      results.push({
        name: '@objectstack/spec',
        status: 'warning',
        message: 'Not built',
        fix: 'Run: pnpm --filter @objectstack/spec build',
      });
    }
    
    // Check Git
    try {
      const gitVersion = execSync('git --version', { encoding: 'utf-8' }).trim();
      results.push({
        name: 'Git',
        status: 'ok',
        message: gitVersion,
      });
    } catch (error) {
      results.push({
        name: 'Git',
        status: 'warning',
        message: 'Not found',
        fix: 'Install Git for version control',
      });
    }

    // #5382 — the posture verdict resolved at the top of `run()`, reported here
    // among the other environment facts. Only an unrecognized value produces a
    // row: a valid posture is not a finding, and doctor's output for every
    // environment that can actually start is unchanged.
    if (!postureReading.ok) {
      results.push(postureReading.result);
    }

    // Display environment results
    let hasErrors = false;
    let hasWarnings = false;
    
    console.log('');
    results.forEach((result) => {
      const padded = result.name.padEnd(20);
      if (result.status === 'ok') {
        printSuccess(`${padded} ${result.message}`);
      } else if (result.status === 'warning') {
        printWarning(`${padded} ${result.message}`);
      } else {
        printError(`${padded} ${result.message}`);
      }
      
      if (result.fix && (flags.verbose || result.status === 'error')) {
        console.log(chalk.dim(`      → ${result.fix}`));
      }
      
      if (result.status === 'error') hasErrors = true;
      if (result.status === 'warning') hasWarnings = true;
    });

    // ── Extended Checks ──────────────────────────────────────────────

    // Missing test files
    printStep('Checking for missing test files...');
    const missingTests = findMissingTests(cwd);
    if (missingTests.length > 0) {
      hasWarnings = true;
      for (const msg of missingTests) {
        printWarning(msg);
      }
    } else {
      printSuccess('Test coverage         All *.zod.ts files have matching tests');
    }

    // Deprecated usage detection
    printStep('Scanning for @deprecated usage...');
    const deprecatedUsages = findDeprecatedUsages(cwd);
    if (deprecatedUsages.length > 0) {
      hasWarnings = true;
      for (const msg of deprecatedUsages) {
        printWarning(`Deprecated: ${msg}`);
      }
    } else {
      printSuccess('Deprecations          No @deprecated tags found');
    }

    // Config-aware checks (only if config exists)
    if (configExists()) {
      printStep('Loading configuration for analysis...');
      try {
        const { config: rawConfig } = await loadConfig();
        const config: any = normalizeStackInput(rawConfig as Record<string, unknown>);

        // Spec-version drift: installed platform newer than the app declares.
        printStep('Checking platform spec version...');
        const specGap = checkSpecVersionGap(config.manifest);
        if (specGap) {
          hasWarnings = true;
          printWarning(`Platform spec         ${specGap.message}`);
          console.log(chalk.dim(`      → ${specGap.hint}`));
        } else {
          printSuccess('Platform spec         Declared specVersion is current with the installed platform');
        }

        // Circular dependency detection
        if (Array.isArray(config.objects) && config.objects.length > 0) {
          printStep('Checking for circular dependencies...');
          const cycles = detectCircularDependencies(config.objects);
          if (cycles.length > 0) {
            hasWarnings = true;
            for (const msg of cycles) {
              printWarning(msg);
            }
          } else {
            printSuccess('Dependencies          No circular references detected');
          }

          // Unused objects
          printStep('Checking for unused objects...');
          const unused = findUnusedObjects(config);
          if (unused.length > 0) {
            hasWarnings = true;
            for (const msg of unused) {
              printWarning(msg);
            }
          } else {
            printSuccess('Object usage          All objects are referenced');
          }
        }

        // ADR-0120 D5e advisory — installation-wide uniques under `isolated`.
        // Runs whenever a config loaded, whether or not it declares objects:
        // the ledger half reports installed packages this project never
        // declared.
        //
        // #5382 — reads the verdict resolved at the top of `run()`. Re-invoking
        // the resolver here is what put its throw inside this swallowing `try`
        // in the first place. An unrecognized posture skips the advisory (there
        // is no posture to gate on) and is already reported above as an error,
        // so nothing is silently lost.
        if (postureReading.ok && postureGatesGlobalUniques(postureReading.posture)) {
          printStep("Checking unique scopes against the 'isolated' tenancy posture...");
          const scopeFindings = await findUnscopedGlobalUniques(cwd, config, postureReading.posture);
          if (scopeFindings.length > 0) {
            hasWarnings = true;
            for (const { source, finding } of scopeFindings) {
              printWarning(`Unique scope         ${describeGlobalUniqueFinding(finding)} (${source})`);
            }
            console.log(chalk.dim(`      → ${GLOBAL_UNIQUE_ISOLATED_PRESCRIPTION}`));
          } else {
            printSuccess("Unique scope          No unconfirmed installation-wide uniques for this 'isolated' environment");
          }
        }

        // Orphan views
        if (Array.isArray(config.views) && config.views.length > 0) {
          printStep('Checking for orphan views...');
          const orphans = findOrphanViews(config);
          if (orphans.length > 0) {
            hasWarnings = true;
            for (const msg of orphans) {
              printWarning(msg);
            }
          } else {
            printSuccess('View integrity        All views reference valid objects');
          }
        }

        // Dashboard widget integrity (issue #1721) — the widget-side analogue
        // of the orphan-view pass: every widget's `dataset`, `dimensions`,
        // `values`, and chartConfig axis/series fields must resolve against
        // the declared datasets (ADR-0021).
        if (Array.isArray(config.dashboards) && config.dashboards.length > 0) {
          printStep('Checking dashboard widget integrity...');
          const widgetFindings = validateWidgetBindings(config);
          if (widgetFindings.length > 0) {
            for (const f of widgetFindings) {
              if (f.severity === 'error') {
                hasErrors = true;
                printError(`${f.where}: ${f.message}`);
              } else {
                hasWarnings = true;
                printWarning(`${f.where}: ${f.message}`);
              }
              if (flags.verbose) {
                console.log(chalk.dim(`      → ${f.hint}`));
              }
            }
          } else {
            printSuccess('Dashboard integrity   All widgets resolve datasets, dimensions, and measures');
          }
        }
      } catch {
        printWarning('Could not load config for analysis (config checks skipped)');
        hasWarnings = true;
      }
    }

    // ── Deprecation Pattern Scan ─────────────────────────────────────
    if (flags['scan-deprecations']) {
      printStep('Scanning for deprecated ObjectStack patterns...');
      const scanDir = path.join(cwd, 'src');
      const deprecations = scanDeprecatedPatterns(scanDir);
      if (deprecations.length > 0) {
        hasWarnings = true;
        for (const dep of deprecations) {
          printWarning(`${dep.file}:${dep.line} — ${dep.description}`);
          if (flags.verbose) {
            console.log(chalk.dim(`      → ${dep.replacement}`));
          }
        }
        console.log('');
        printInfo(`Found ${deprecations.length} deprecated pattern(s). Run \`objectstack codemod v2-to-v3\` to auto-fix.`);
      } else {
        printSuccess('Deprecation scan      No deprecated patterns found');
      }
    }
    
    console.log('');
    
    // Summary
    if (hasErrors) {
      console.log(chalk.red('❌ Some critical issues found. Please fix them before continuing.'));
      results
        .filter(r => r.status === 'error' && r.fix)
        .forEach(r => console.log(chalk.dim(`   ${r.fix}`)));
      process.exit(1);
    } else if (hasWarnings) {
      console.log(chalk.yellow('⚠️  Environment is functional but has some warnings.'));
      console.log(chalk.dim('   Run with --verbose to see fix suggestions.'));
    } else {
      console.log(chalk.green('✅ Environment is healthy and ready for development!'));
    }
    
    console.log('');
  }
}
