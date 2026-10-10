// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22579] THE FAMILY'S ENUMERATION PIN: every boot-preparation step a SERVING
 * boot runs before its kernel starts, and the migrate boot running each one
 * through the SAME function.
 *
 * ## The family
 *
 * `os migrate plan` / `apply` boot once (`bootSchemaStack`) and examine only
 * what that boot prepared, and it has lagged the serving boot (`os serve`,
 * which `os dev` and `os start` run) one step at a time: the composition
 * (#12938, #21732, #22506), the environment (#22581), and the datasources —
 * the `telemetry` sibling a development boot keeps lifecycle-classed objects in
 * (#22579). Each was found on an upgrade and fixed alone. This file names the
 * steps once, so the next one fails here.
 *
 * ## What "the same function" is, and how it is read
 *
 * {@link STEPS} lists each step with the shared functions it is made of, by
 * REFERENCE — imported here, never spelled as a string. For each function and
 * each boot, three facts are read off the boot's own source (comments and
 * literals masked by the repo's one code/prose separator):
 *
 *  1. the boot USES it in code: calls it, or hands it on — a callback, the
 *     static handle `serve` keeps over a shared rule;
 *  2. the name it calls is BOUND to that function — imported (statically or
 *     through `await import(…)`) from a module whose export, loaded here, is
 *     the very same function object, or declared and exported by the module
 *     itself. A local function that merely shares the name fails;
 *  3. for the migrate boot, in one of the modules `bootSchemaStack` runs:
 *     `schema-migrate.ts`, and `schema-migration-plugins.ts`, its composition.
 *
 * ## A step added to the serving boot alone turns this red
 *
 * The serving boot's steps are taken from the modules that hold them — the
 * CLOSURE modules below. Every function `serve.ts` imports from one of them and
 * uses must be a listed step function, or a {@link SERVE_ONLY} entry carrying
 * the reason the one-shot boot answers it another way. A new step written there
 * and called by `serve` alone fails case 3 by name; listed, it fails case 2
 * until the migrate boot calls it too.
 *
 * ⚠️ Out of reach, stated: a step written INLINE in `serve.ts` calls nothing
 * here. That is the convention this pin holds every step to — a serving-boot
 * preparation step is a shared function — and the reason each one so far was
 * extracted before both boots could call it.
 *
 * The effects are pinned by the boots themselves: the composition by
 * `commands/migrate/plan.boot-parity.integration.test.ts`, the environment by
 * `commands/migrate/plan.reads-env-files.integration.test.ts`, the telemetry
 * sibling by `commands/migrate/plan.telemetry-sibling.integration.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isDevelopmentBoot,
  materializeStackPlugin,
  providesCapability,
  resolveAuthSecret,
  resolvePlatformAuthComposition,
  resolveStackTiers,
} from '@objectstack/core';
import { createStandaloneStack } from '@objectstack/runtime';
import { stampSearchPinyinEnabled } from '@objectstack/types';
// The one code/prose separator, typed by the hand-written `.d.mts` beside it.
import { maskComments, maskCommentsAndLiterals } from '../../../../scripts/js-comment-mask.mjs';
import { isAppPluginLike } from './graft-runtime-hooks.js';
import { loadProjectEnvFiles } from './schema-migrate.js';
import {
  resolveStackCollection,
  stackBootPlugins,
  stackDeclaredCapabilities,
  stackDeclaresMetadata,
} from './stack-collections.js';
import { provisionTelemetryDatasource, standaloneTelemetryPrimary } from './telemetry-datasource.js';

/** …/packages/cli/src/utils */
const HERE = dirname(fileURLToPath(import.meta.url));
/** …/packages/cli/src — this package's own source tree. */
const SRC = resolve(HERE, '..');

/** The serving boot: `os serve`'s `run()`, which `os dev` and `os start` spawn. */
const SERVING_BOOT = 'commands/serve.ts';
/** The migrate boot: `bootSchemaStack`, and the composition it runs. */
const MIGRATE_BOOT = ['utils/schema-migrate.ts', 'utils/schema-migration-plugins.ts'];

type Step = { readonly step: string; readonly functions: readonly ((...args: never[]) => unknown)[] };

/** Every boot-preparation step a serving boot runs, with the shared functions it is made of. */
const STEPS: readonly Step[] = [
  {
    step: 'environment files',
    functions: [loadProjectEnvFiles],
  },
  {
    step: 'datasource provisioning',
    // The primary, as the standalone stack declares it, and the `telemetry`
    // sibling keyed on it — whether, where and how (`provisionTelemetryDatasource`).
    functions: [createStandaloneStack, standaloneTelemetryPrimary, provisionTelemetryDatasource],
  },
  {
    step: 'composition',
    functions: [
      stackBootPlugins,
      materializeStackPlugin,
      isAppPluginLike,
      stackDeclaresMetadata,
      resolveStackCollection,
      stackDeclaredCapabilities,
      stampSearchPinyinEnabled,
      providesCapability,
    ],
  },
  {
    step: 'the auth-family gate',
    functions: [resolvePlatformAuthComposition, resolveStackTiers, resolveAuthSecret, isDevelopmentBoot],
  },
];

/**
 * The modules a serving-boot preparation step lives in: what `serve.ts` calls
 * from them is a step, or says here why it is not one for the one-shot boot.
 */
const CLOSURE = [
  'utils/schema-migrate.ts',
  'utils/telemetry-datasource.ts',
  'utils/stack-collections.ts',
  'utils/plugin-detection.ts',
  'utils/graft-runtime-hooks.ts',
  '@objectstack/core',
];

/** Functions `serve.ts` calls from a {@link CLOSURE} module that the one-shot boot answers another way, and why. */
const SERVE_ONLY: Record<string, string> = {
  shouldAutoRegisterObjectQL:
    'adds ObjectQLPlugin when a config declares objects and composes no engine; the one-shot boot\'s data '
    + 'stack is createStandaloneStack, which always composes it',
  shouldAutoRegisterStorageDriver:
    'serve\'s config-load fallback for a host config with no datasource plugin: a driver from OS_DATABASE_URL '
    + 'alone (an in-memory database without it, which nothing can migrate). The one-shot boot\'s primary is the '
    + 'standalone stack\'s, through the shared resolution (resolveStandaloneDatabase) — the same file whenever '
    + 'OS_DATABASE_URL names one, as os dev does for the serve it spawns — and the sibling is keyed on it',
  shouldBootWithLibrary:
    'serve\'s boot-mode dispatch between the standalone stack and a host config\'s own plugins; the one-shot '
    + 'boot always boots the standalone data stack and composes a host config\'s plugins over it for their '
    + 'declarations (buildSchemaMigrationPlugins)',
  bundleDeclaresTranslations:
    'decides serve\'s tier-gated i18n service, which the declaration boot does not compose '
    + '(schema-migration-plugins.ts, "What this does NOT compose")',
  graftAuthoredRuntimeMembers:
    'grafts the config\'s runtime hooks (onEnable and the rest) onto its AppPlugin: host code the declaration '
    + 'boot deliberately does not run',
  stackSuppliesAuthPlugin:
    'serve\'s own "is an AuthPlugin already composed" read ahead of its auth block; the auth-family gate '
    + '(resolvePlatformAuthComposition, called by both boots) asks the same predicate first',
  findSqlDriverForKernel:
    'the artifact boot migration gate, a kernel:ready hook over a booted kernel — a serving-boot policy that '
    + 'runs after preparation, not a step that shapes what is prepared',
};

// ── Reading a module ─────────────────────────────────────────────────────────

interface Binding {
  /** The name the module calls. */
  local: string;
  /** The export it is bound to. */
  imported: string;
  /** The module that export is read from: a package specifier or an absolute source path. */
  from: string;
}

const source = (rel: string): string => readFileSync(resolve(SRC, rel), 'utf8');

/** Resolve an import specifier written in `rel` to what the test loads. */
function resolveSpecifier(rel: string, spec: string): string {
  if (!spec.startsWith('.')) return spec;
  return resolve(SRC, dirname(rel), spec).replace(/\.js$/, '.ts');
}

/** A specifier relative to `src/`, the CLOSURE's spelling. */
const relToSrc = (from: string): string => (from.startsWith(SRC) ? from.slice(SRC.length + 1) : from);

/** Every value binding `rel` imports — `import { … } from` and `const { … } = await import(…)`. */
function bindings(rel: string): Binding[] {
  const code = maskComments(source(rel));
  const out: Binding[] = [];
  const add = (clause: string, spec: string): void => {
    for (const raw of clause.split(',')) {
      const part = raw.trim();
      if (!part || /^type\s/.test(part)) continue;
      const [imported, local] = part.split(/\s+as\s+|\s*:\s*/).map((s) => s.trim());
      out.push({ imported, local: local ?? imported, from: resolveSpecifier(rel, spec) });
    }
  };
  for (const m of code.matchAll(/\bimport\s+(?!type\b)\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) add(m[1], m[2]);
  for (const m of code.matchAll(/\bconst\s*\{([^}]*)\}\s*=\s*await\s+import\(\s*['"]([^'"]+)['"]\s*\)/g)) add(m[1], m[2]);
  return out;
}

/** The import statements `bindings()` reads — what binds a name, never a use of it. */
const IMPORT_STATEMENT = /\bimport\s+(?!type\b)\{[^}]*\}\s*from\s*['"][^'"]*['"]|\bconst\s*\{[^}]*\}\s*=\s*await\s+import\(\s*['"][^'"]*['"]\s*\)/g;

/**
 * Does `rel` USE the binding `name` in code — call it, or hand it on (a
 * callback such as `plugins.some(isAppPluginLike)`, a static handle such as
 * `Serve.providesCapability`'s initializer)? Comments and literals do not count,
 * and neither does the import that binds it or the declaration that defines it.
 */
function uses(rel: string, name: string): boolean {
  const code = maskCommentsAndLiterals(source(rel))
    .replace(IMPORT_STATEMENT, '')
    .replace(new RegExp(`\\bfunction\\s+${name}\\b`, 'g'), '');
  return new RegExp(`(?<![\\w$.])${name}(?![\\w$])`).test(code);
}

/** Does `rel` declare and export `name` itself? */
const declares = (rel: string, name: string): boolean =>
  new RegExp(`\\bexport\\s+(?:async\\s+)?function\\s+${name}\\b`).test(maskComments(source(rel)));

async function load(from: string): Promise<Record<string, unknown>> {
  return (await import(from)) as Record<string, unknown>;
}

/**
 * Is `fn` what `rel` calls — called there, under a name bound to this very
 * function object? Answers the evidence, or `null` when it is not.
 */
async function callsThrough(rel: string, fn: (...args: never[]) => unknown): Promise<string | null> {
  // Only the bindings of an export of this name are loaded: `serve.ts` imports
  // half the package, and none of the rest can be this function.
  for (const b of bindings(rel)) {
    if (b.imported !== fn.name || !uses(rel, b.local)) continue;
    if ((await load(b.from))[b.imported] === fn) return `${b.local} from ${relToSrc(b.from)}`;
  }
  if (declares(rel, fn.name) && uses(rel, fn.name) && (await load(resolve(SRC, rel)))[fn.name] === fn) {
    return `${fn.name}, declared there`;
  }
  return null;
}

// ── The cases ────────────────────────────────────────────────────────────────

const ROWS = STEPS.flatMap(({ step, functions }) => functions.map((fn) => ({ step, name: fn.name, fn })));

describe('[#22579] the boot-preparation steps a serving boot runs, by the function each is made of', () => {
  it('names the four steps, each by at least one function', () => {
    // The roster the family's close-out named; a row deleted reddens here.
    expect(STEPS.map((s) => s.step)).toEqual([
      'environment files', 'datasource provisioning', 'composition', 'the auth-family gate',
    ]);
    for (const s of STEPS) expect(s.functions.length, s.step).toBeGreaterThan(0);
    // Every reference is a named function the readers below can find.
    for (const row of ROWS) expect(row.name, row.step).toMatch(/^[A-Za-z_$][\w$]*$/);
  });

  it.each(ROWS)('$step: the serving boot calls $name', async ({ fn }) => {
    expect(await callsThrough(SERVING_BOOT, fn)).not.toBeNull();
  });

  it.each(ROWS)('$step: the migrate boot calls $name through the same function', async ({ fn }) => {
    const through = await Promise.all(MIGRATE_BOOT.map((rel) => callsThrough(rel, fn)));
    expect(through.filter((t) => t !== null), `${fn.name} is not called by ${MIGRATE_BOOT.join(' or ')}`)
      .not.toEqual([]);
  });
});

describe('[#22579] a step added to the serving boot alone turns this file red', () => {
  it('every function serve.ts uses from a step module is a listed step, or says why the one-shot boot answers it otherwise', async () => {
    const stepFunctions = new Set<unknown>(ROWS.map((r) => r.fn));
    const fromClosure = bindings(SERVING_BOOT)
      .filter((b) => CLOSURE.includes(relToSrc(b.from)) && uses(SERVING_BOOT, b.local));
    // Non-vacuity: the reader finds the serving boot's own telemetry provision.
    expect(fromClosure.map((b) => b.imported)).toContain('provisionTelemetryDatasource');

    const unlisted: string[] = [];
    for (const b of fromClosure) {
      const value = (await load(b.from))[b.imported];
      // A step is a function; a table it reads (`CAPABILITY_PROVIDERS`) rides with the rule that reads it.
      if (typeof value !== 'function' || stepFunctions.has(value)) continue;
      if (b.imported in SERVE_ONLY) continue;
      unlisted.push(`${b.imported} (from ${relToSrc(b.from)})`);
    }
    expect(unlisted, 'serve.ts uses these from a boot-preparation module; list each as a step the migrate boot '
      + 'runs too, or in SERVE_ONLY with the reason the one-shot boot answers it another way').toEqual([]);
  });

  it('every SERVE_ONLY entry is still used by serve.ts, and is not also a step', async () => {
    const called = new Set(
      bindings(SERVING_BOOT).filter((b) => uses(SERVING_BOOT, b.local)).map((b) => b.imported),
    );
    const steps = new Set(ROWS.map((r) => r.name));
    for (const name of Object.keys(SERVE_ONLY)) {
      expect(called.has(name), `${name}: serve.ts no longer uses it — drop the entry`).toBe(true);
      expect(steps.has(name), `${name}: both a step and serve-only`).toBe(false);
    }
  });
});
