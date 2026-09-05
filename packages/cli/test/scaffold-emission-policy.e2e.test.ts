// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PIN — the two CLI scaffolders emit ONE emission policy, not two copies of it.
 *
 * ## The defect this exists for
 *
 * `os init` and `os create` each wrote the third-party ranges and the
 * `tsconfig.json` a new project receives, in their own words. Measured on the
 * tree the day this landed, the TypeScript range — the value that decides
 * whether a scaffolded project type-checks at all — was written in SIX places
 * across three scaffolders and had split into THREE values (`^5.3.0` in
 * `init.ts`, `^5.8.0` in `create.ts`, `^6.0.0` in the bundled
 * `create-objectstack` template). vitest had split into two. The two CLI values
 * were written in the SAME commit and stayed apart for 211 days; the third
 * arrived 102 days before the measurement.
 *
 * The control for that reading sits in the same file as the defect:
 * `SCAFFOLD_PNPM_RANGE` and `renderPnpmWorkspaceYaml()` are IMPORTED by the
 * other scaffolder rather than restated, and across the same five emissions,
 * the same window and the same authors they did not drift at all.
 *
 * ## What is asserted, and why no expected value is written down here
 *
 * Every expectation below is DERIVED — from the renderers, from the other
 * scaffolder, or from the doc page that already states the answer. A test that
 * transcribed `'^5.3.0'` would go green on a tree where one scaffolder had been
 * edited and the other had not, which is the exact state it exists to catch.
 *
 *   1. Across all five emissions, each third-party dependency name resolves to
 *      exactly ONE range. This is the property; the value it settles on is not.
 *   2. That one range IS the exported constant, so a template that grows a
 *      literal instead of importing turns this red.
 *   3. The surviving TypeScript range is the floor the DOCS state. `^5.3.0`
 *      beat `^5.8.0` because two live pages already promise "TypeScript 5.3+";
 *      that is what made the choice a recorded decision rather than a silent
 *      pick, and this case is what keeps the two ends tied together.
 *   4. `os init`'s `tsconfig.json` is written inside `run()`, so it is measured
 *      by DRIVING the real command into a throwaway directory and reading the
 *      bytes off disk — a renderer that is exported but no longer called would
 *      pass every in-process assertion here.
 *
 * ⚠️ `create-objectstack`'s `^6.0.0` is deliberately out of scope and is NOT
 * asserted against: that package cannot import from `@objectstack/cli` (the
 * dependency edge runs the other way), and unifying it would change what a
 * scaffolded project installs.
 *
 * Spawned through `bin/run-dev.js` + tsx, so this suite does not depend on
 * `packages/cli/dist` having been built (`@objectstack/cli#test` depends on
 * `^build` only) — the same reason `create-refuses-invalid-project-name.e2e.test.ts`
 * spawns that way.
 */

import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { childEnv } from './helpers/serve-process.js';
import {
  renderScaffoldPackageJson,
  renderScaffoldTsconfig,
  SCAFFOLD_TSCONFIG_INCLUDE_WITH_ROOT_CONFIG,
  SCAFFOLD_TSX_RANGE,
  SCAFFOLD_TYPES_NODE_RANGE,
  SCAFFOLD_TYPESCRIPT_RANGE,
  SCAFFOLD_VITEST_RANGE,
  SCAFFOLD_ZOD_RANGE,
  TEMPLATES,
} from '../src/commands/init.js';
import { DEFAULT_PLACEMENT, templates } from '../src/commands/create.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const CLI = resolve(HERE, '../bin/run-dev.js');
const TSX = resolve(HERE, '../../../node_modules/.bin/tsx');

// One `resolve(HERE, …)` call per line and nothing split across lines:
// `check:cross-package-test-inputs` reconstructs these reads by SOURCE SCAN,
// and a spelling it cannot parse leaves the glob declared and held by nothing.
// Both are declared for `@objectstack/cli` in
// scripts/cross-package-test-inputs.mjs and mirrored into turbo.json.
const GETTING_STARTED = resolve(HERE, '../../..', 'content/docs/getting-started/index.mdx');
const TROUBLESHOOTING = resolve(HERE, '../../..', 'content/docs/deployment/troubleshooting.mdx');

/** oclif + tsx cold start with every command module loaded; ~2-10 s when healthy. */
const RUN_TIMEOUT_MS = 180_000;

const PROBE_NAME = 'emission-policy-probe';

/** `@objectstack/*` ranges are the CLI's own version — pinned by `init.test.ts`. */
function thirdPartyOnly(deps: Record<string, unknown> | undefined): Array<[string, string]> {
  return Object.entries(deps ?? {})
    .filter(([name, range]) => !name.startsWith('@objectstack/') && typeof range === 'string')
    .map(([name, range]) => [name, range as string]);
}

/**
 * Every `package.json` the two commands emit for the shape a reader of the docs
 * actually gets — `os init`'s three templates and `os create`'s two, in its
 * DEFAULT placement. `--in-repo` is excluded on purpose: it emits `workspace:*`
 * and is documented as platform-work-only.
 */
function emittedManifests(): Array<{ id: string; manifest: Record<string, unknown> }> {
  const out: Array<{ id: string; manifest: Record<string, unknown> }> = [];
  for (const [key, template] of Object.entries(TEMPLATES)) {
    out.push({
      id: `os init -t ${key}`,
      manifest: renderScaffoldPackageJson(PROBE_NAME, template),
    });
  }
  for (const [key, template] of Object.entries(templates)) {
    const render = template.filesFor(DEFAULT_PLACEMENT)['package.json'];
    out.push({
      id: `os create ${key}`,
      manifest: render(PROBE_NAME) as Record<string, unknown>,
    });
  }
  return out;
}

/** `<dependency name> -> every range any emission declares for it`. */
function declaredRanges(): Map<string, Map<string, string[]>> {
  const byName = new Map<string, Map<string, string[]>>();
  for (const { id, manifest } of emittedManifests()) {
    const deps = [
      ...thirdPartyOnly(manifest.dependencies as Record<string, unknown>),
      ...thirdPartyOnly(manifest.devDependencies as Record<string, unknown>),
    ];
    for (const [name, range] of deps) {
      const ranges = byName.get(name) ?? new Map<string, string[]>();
      ranges.set(range, [...(ranges.get(range) ?? []), id]);
      byName.set(name, ranges);
    }
  }
  return byName;
}

describe('scaffold emission policy — one definition, five emissions', () => {
  it('harvests a non-empty policy from all five emissions (control)', () => {
    // Without this, every assertion below passes over an empty harvest — the
    // vacuity that would make the whole file certify the defect it exists for.
    const manifests = emittedManifests();
    expect(manifests.map((m) => m.id).sort()).toEqual([
      'os create example',
      'os create plugin',
      'os init -t app',
      'os init -t empty',
      'os init -t plugin',
    ]);
    const names = [...declaredRanges().keys()];
    expect(names).toContain('typescript');
    expect(names).toContain('vitest');
    expect(names.length).toBeGreaterThanOrEqual(4);
  });

  it('declares exactly one range per third-party dependency', () => {
    const disagreements: string[] = [];
    for (const [name, ranges] of declaredRanges()) {
      if (ranges.size === 1) continue;
      const detail = [...ranges]
        .map(([range, emissions]) => `${range} (${emissions.join(', ')})`)
        .join(' vs ');
      disagreements.push(`${name}: ${detail}`);
    }
    expect(
      disagreements,
      'these dependency names are restated with different ranges by different '
        + 'scaffolders — declare the range once in init.ts and import it',
    ).toEqual([]);
  });

  it('emits the exported constant rather than a literal, for every policy range', () => {
    const ranges = declaredRanges();
    const expected: Array<[string, string]> = [
      ['typescript', SCAFFOLD_TYPESCRIPT_RANGE],
      ['vitest', SCAFFOLD_VITEST_RANGE],
      ['@types/node', SCAFFOLD_TYPES_NODE_RANGE],
      ['tsx', SCAFFOLD_TSX_RANGE],
      ['zod', SCAFFOLD_ZOD_RANGE],
    ];
    for (const [name, constant] of expected) {
      expect([...(ranges.get(name)?.keys() ?? [])], name).toEqual([constant]);
    }
  });
});

describe('the surviving TypeScript range is the floor the docs already state', () => {
  /** `TypeScript 5.3+` / `TypeScript 5.3.0 or later`, normalised to `major.minor`. */
  function statedFloors(file: string): string[] {
    const text = readFileSync(file, 'utf8');
    const out: string[] = [];
    const re = /TypeScript (\d+)\.(\d+)(?:\.\d+)?(?:\+| or later)/g;
    for (const m of text.matchAll(re)) out.push(`${m[1]}.${m[2]}`);
    return out;
  }

  it('finds a stated floor on both pages (control)', () => {
    // A regex that matched nothing would make the case below assert `[] === []`.
    expect(statedFloors(GETTING_STARTED).length).toBeGreaterThan(0);
    expect(statedFloors(TROUBLESHOOTING).length).toBeGreaterThan(0);
  });

  it('agrees with what the scaffolders emit', () => {
    const floors = new Set([...statedFloors(GETTING_STARTED), ...statedFloors(TROUBLESHOOTING)]);
    expect([...floors], 'the two pages state different TypeScript floors').toHaveLength(1);
    const [floor] = [...floors];
    expect(
      SCAFFOLD_TYPESCRIPT_RANGE,
      'the emitted range and the documented floor have to be the same promise — '
        + 'change both together, or neither',
    ).toBe(`^${floor}.0`);
  });
});

describe('the emitted tsconfig.json comes from the shared renderer', () => {
  function runCli(args: string[], cwd: string): Promise<{ code: number; stderr: string }> {
    return new Promise((done) => {
      execFile(
        TSX,
        [CLI, ...args],
        { cwd, maxBuffer: 8 * 1024 * 1024, env: childEnv({ NO_COLOR: '1' }) },
        (err, _stdout, stderr) => {
          done({
            code: err
              ? typeof (err as { code?: unknown }).code === 'number'
                ? (err as unknown as { code: number }).code
                : 1
              : 0,
            stderr: String(stderr),
          });
        },
      );
    });
  }

  /** Everything but the two keys the emitted shapes legitimately differ on. */
  function base(tsconfig: Record<string, unknown>): Record<string, unknown> {
    const options = { ...(tsconfig.compilerOptions as Record<string, unknown>) };
    delete options.rootDir;
    return options;
  }

  it(
    'os init writes exactly what renderScaffoldTsconfig() returns, and os create shares its base',
    { timeout: RUN_TIMEOUT_MS },
    async () => {
      const sandbox = mkdtempSync(join(tmpdir(), 'emission-policy-'));
      try {
        const run = await runCli(['init', PROBE_NAME, '-t', 'app', '--no-install'], sandbox);
        expect(run.code, run.stderr).toBe(0);

        // The emission really happened — an absent or empty directory would let
        // every comparison below run over nothing.
        const projectDir = join(sandbox, PROBE_NAME);
        expect(readdirSync(projectDir).length).toBeGreaterThan(1);

        const emitted = readFileSync(join(projectDir, 'tsconfig.json'), 'utf8');
        const rendered = renderScaffoldTsconfig({
          rootDir: '.',
          include: SCAFFOLD_TSCONFIG_INCLUDE_WITH_ROOT_CONFIG,
        });
        expect(emitted).toBe(`${JSON.stringify(rendered, null, 2)}\n`);

        // `os create`'s standalone tsconfigs measured against the bytes `os
        // init` actually wrote, not against a transcription of either.
        const emittedOptions = base(JSON.parse(emitted) as Record<string, unknown>);
        for (const [key, template] of Object.entries(templates)) {
          const render = template.filesFor(DEFAULT_PLACEMENT)['tsconfig.json'];
          const created = render(PROBE_NAME) as Record<string, unknown>;
          expect(base(created), `os create ${key}`).toEqual(emittedOptions);
        }
      } finally {
        rmSync(sandbox, { recursive: true, force: true });
      }
    },
  );
});
