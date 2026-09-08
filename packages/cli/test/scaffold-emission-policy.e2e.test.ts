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
 * `create-objectstack` template). vitest had split into two. Dated off `git
 * log -G` as of 2026-09-05: the two CLI values were written in the SAME commit
 * (338e68d2564, 2026-02-07) and stayed apart for 210 days; the bundled template
 * landed at `^5.3.0` too (dbb54e12f0c, 2026-05-25) and only became the third
 * value 53 days ago, when eaff01425b7 moved it to `^6.0.0` without recording
 * any reasoning about TypeScript.
 *
 * The control for that reading sits in the same file as the defect:
 * `SCAFFOLD_PNPM_RANGE` and `renderPnpmWorkspaceYaml()` are IMPORTED by the
 * other scaffolder rather than restated, and across the same emissions,
 * the same window and the same authors they did not drift at all.
 *
 * ## What is asserted, and why no expected value is written down here
 *
 * Every expectation below is DERIVED — from the renderers, from the other
 * scaffolder, or from the doc page that already states the answer. A test that
 * transcribed `'^5.3.0'` would go green on a tree where one scaffolder had been
 * edited and the other had not, which is the exact state it exists to catch.
 *
 *   1. Across every emission the two commands still ship (four since #16483
 *      retired `os create example`), each third-party dependency name resolves
 *      to exactly ONE range. This is the property; the value it settles on is
 *      not, and neither is the count — both are derived from the live maps.
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
 *   5. The THIRD scaffolder — `npx create-objectstack`, the documented on-ramp
 *      — is now in scope (#16485). It still cannot IMPORT these constants: the
 *      dependency edge runs the other way and the npx package must not pull the
 *      CLI's closure. It reaches them by GENERATION instead
 *      (`scripts/sync-scaffold-emission-policy.mjs` stamps its bundled template
 *      from this same file at build time, and `pnpm check:scaffold-emission-policy`
 *      reddens on drift). While it was out of scope its `typescript` line sat at
 *      `^6.0.0`, so two projects created the same day got different TypeScript
 *      MAJORS depending on which entry point the reader followed.
 *
 * ⚠️ The on-ramp is measured by DRIVING it — spawning its real `bin/` entry into
 * a throwaway directory and reading the emitted `package.json` off disk — and
 * never by reading the committed template the generator writes. A pin that read
 * the generator's own output would be reading the same source it is guarding,
 * and would stay green through a build that stopped copying templates at all.
 * Its `dist/` is present because `@objectstack/cli#test` depends on `^build`.
 *
 * Spawned through `bin/run-dev.js` + tsx, so this suite does not depend on
 * `packages/cli/dist` having been built (`@objectstack/cli#test` depends on
 * `^build` only) — the same reason `create-refuses-invalid-project-name.e2e.test.ts`
 * spawns that way.
 */

import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { childEnv } from './helpers/serve-process.js';
import {
  renderScaffoldPackageJson,
  renderScaffoldTsconfig,
  SCAFFOLD_PNPM_RANGE,
  SCAFFOLD_TSCONFIG_INCLUDE_WITH_ROOT_CONFIG,
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

/**
 * The on-ramp's real entry point and the template it ships, both declared as
 * cross-package inputs of `@objectstack/cli` (scripts/cross-package-test-inputs.mjs,
 * mirrored into turbo.json) — a template-only diff changes what the block at the
 * bottom of this file measures, so without the declaration this suite would
 * replay a cached green over exactly the divergence it exists to catch.
 */
const ON_RAMP_BIN = resolve(HERE, '../../..', 'packages/create-objectstack/bin/create-objectstack.js');
const ON_RAMP_TEMPLATE_PKG = resolve(HERE, '../../..', 'packages/create-objectstack/src/templates/blank/package.json');

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
 * actually gets — `os init`'s three templates and `os create`'s one, in its
 * DEFAULT placement. `--in-repo` is excluded on purpose: it emits `workspace:*`
 * and is documented as platform-work-only.
 *
 * `os create` contributed two until #16483 retired `example`, which is why the
 * harvest is four emissions now. Both halves are DERIVED from the live maps, so
 * the count moves with the roster rather than being maintained here.
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

describe('scaffold emission policy — one definition, four emissions', () => {
  it('harvests a non-empty policy from all four emissions (control)', () => {
    // Without this, every assertion below passes over an empty harvest — the
    // vacuity that would make the whole file certify the defect it exists for.
    // `os create example` was here until #16483 retired it.
    const manifests = emittedManifests();
    expect(manifests.map((m) => m.id).sort()).toEqual([
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
    // ⚠️ `tsx` left this table with #16483: the retired `os create example`
    // template was the only emission that declared it. `SCAFFOLD_TSX_RANGE`
    // has now been retired with it — every surviving emission runs its scripts
    // through `objectstack`, `tsc` or `vitest`, none of which is invoked as
    // `tsx`, so no emission declares that range. Asserting it here anyway
    // would compare an empty harvest against a constant and go red on a
    // correct tree; a row is owed by a range some emission really declares,
    // and by nothing else — so this table grows a `tsx` row only after some
    // emission declares one, never to keep a constant company.
    const expected: Array<[string, string]> = [
      ['typescript', SCAFFOLD_TYPESCRIPT_RANGE],
      ['vitest', SCAFFOLD_VITEST_RANGE],
      ['@types/node', SCAFFOLD_TYPES_NODE_RANGE],
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

describe('the on-ramp emits the same policy — measured by DRIVING it', () => {
  /**
   * `npx create-objectstack`'s emitted `package.json`, produced by spawning the
   * package's real `bin/` entry. `--skip-install` and `--skip-skills` keep the
   * run offline and fs-only; everything this block reads is written before
   * either step would run.
   */
  let sandbox = '';
  let emitted: Record<string, unknown> | null = null;
  let failure = '';

  beforeAll(async () => {
    sandbox = mkdtempSync(join(tmpdir(), 'on-ramp-policy-'));
    const run = await new Promise<{ code: number; stderr: string }>((done) => {
      execFile(
        process.execPath,
        [ON_RAMP_BIN, PROBE_NAME, '--skip-install', '--skip-skills'],
        { cwd: sandbox, maxBuffer: 8 * 1024 * 1024, env: childEnv({ NO_COLOR: '1' }) },
        (err, _stdout, stderr) => {
          done({ code: err ? Number((err as { code?: unknown }).code ?? 1) : 0, stderr: String(stderr) });
        },
      );
    });
    if (run.code !== 0) {
      // `bin/create-objectstack.js` imports `../dist/index.js`, so an unbuilt
      // package fails here rather than anywhere informative. Say which build.
      failure =
        `create-objectstack exited ${run.code}. If it could not resolve ../dist/index.js, this suite ` +
        'ran without its dependency build — `pnpm --filter create-objectstack build`, which ' +
        `\`@objectstack/cli#test\` normally supplies via \`^build\`.\n${run.stderr}`;
      return;
    }
    const projectDir = join(sandbox, PROBE_NAME);
    emitted = JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf8')) as Record<string, unknown>;
  }, RUN_TIMEOUT_MS);

  afterAll(() => {
    if (sandbox) rmSync(sandbox, { recursive: true, force: true });
  });

  /** Every emission the two CLI commands render, plus the on-ramp's. */
  function allScaffolderManifests(): Array<{ id: string; manifest: Record<string, unknown> }> {
    return [...emittedManifests(), { id: 'npx create-objectstack', manifest: emitted! }];
  }

  it('really drove the on-ramp, and got a manifest with policy in it (control)', () => {
    expect(failure, failure).toBe('');
    expect(readdirSync(join(sandbox, PROBE_NAME)).length).toBeGreaterThan(1);
    // Without this, every assertion below would range over an empty harvest —
    // the vacuity that would let this whole block certify the defect it exists
    // for. The on-ramp declares exactly one third-party dependency today, so
    // `toContain` rather than a count.
    expect(thirdPartyOnly(emitted?.devDependencies as Record<string, unknown>).map(([n]) => n)).toContain(
      'typescript',
    );
    expect((emitted?.engines as Record<string, unknown> | undefined)?.pnpm).toBeTypeOf('string');
  });

  it('declares exactly one range per third-party dependency, across ALL THREE scaffolders', () => {
    const byName = new Map<string, Map<string, string[]>>();
    for (const { id, manifest } of allScaffolderManifests()) {
      for (const [name, range] of [
        ...thirdPartyOnly(manifest.dependencies as Record<string, unknown>),
        ...thirdPartyOnly(manifest.devDependencies as Record<string, unknown>),
      ]) {
        const ranges = byName.get(name) ?? new Map<string, string[]>();
        ranges.set(range, [...(ranges.get(range) ?? []), id]);
        byName.set(name, ranges);
      }
    }
    const disagreements: string[] = [];
    for (const [name, ranges] of byName) {
      if (ranges.size === 1) continue;
      disagreements.push(
        `${name}: ${[...ranges].map(([r, ids]) => `${r} (${ids.join(', ')})`).join(' vs ')}`,
      );
    }
    expect(
      disagreements,
      'a scaffolded project must declare the same third-party ranges whichever documented entry '
        + 'point created it. The on-ramp reaches the policy by generation, not import: run '
        + '`pnpm gen:scaffold-emission-policy` and commit the template it rewrites',
    ).toEqual([]);
  });

  it('emits the exported TypeScript and pnpm constants, not a restatement of them', () => {
    const typescriptRanges = new Set(
      allScaffolderManifests().map(
        ({ manifest }) =>
          (manifest.devDependencies as Record<string, string> | undefined)?.typescript
          ?? (manifest.dependencies as Record<string, string> | undefined)?.typescript,
      ),
    );
    expect([...typescriptRanges], 'every emission declares typescript, at one range').toEqual([
      SCAFFOLD_TYPESCRIPT_RANGE,
    ]);

    const pnpmRanges = new Set(
      allScaffolderManifests().map(({ manifest }) => (manifest.engines as Record<string, string> | undefined)?.pnpm),
    );
    expect([...pnpmRanges], 'every emission declares engines.pnpm, at one range').toEqual([
      SCAFFOLD_PNPM_RANGE,
    ]);
  });

  it('carries the committed template through unchanged — the generator ran, the build copied', () => {
    // The one place the committed template is read, and deliberately as a
    // CONSEQUENCE rather than as the expectation: the drive above already
    // settled what the on-ramp emits. This says the bytes a reader would edit
    // are the bytes that shipped, so a stale `dist/` or a generator that never
    // ran is legible as itself rather than as a policy disagreement.
    const committed = JSON.parse(readFileSync(ON_RAMP_TEMPLATE_PKG, 'utf8')) as {
      devDependencies?: Record<string, string>;
      engines?: Record<string, string>;
    };
    expect(committed.devDependencies?.typescript).toBe(
      (emitted?.devDependencies as Record<string, string> | undefined)?.typescript,
    );
    expect(committed.engines?.pnpm).toBe((emitted?.engines as Record<string, string> | undefined)?.pnpm);
  });
});
