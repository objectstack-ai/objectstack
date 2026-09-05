// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The consumer-specifier ledger, held against the PUBLISHED `exports` maps
 * (#15589, option A).
 *
 * ## The defect class, paid for twice
 *
 * 17.3.0 sealed `@objectstack/cli` behind an `exports` map (#13123). Two
 * out-of-repo consumers were deep-importing through it:
 *
 *   cloud   `objectos-runtime`        dist/utils/console.js            -> #13662
 *   hotcrm  test/helpers/action-sandbox.ts  dist/utils/extract-hook-body.js  -> #15325
 *
 * Both were PREDICTED by #13123's own body ("ratify the subpath rather than read
 * `dist/` paths"). Both were discovered AFTER publish, by the consumer, during
 * an upgrade. Nothing in this repo could have gone red, and that is structural
 * rather than an oversight: an `exports` map is a PACKAGING contract, and inside
 * the monorepo nothing is sealed — every in-repo consumer reaches any file
 * through a relative import, a vitest alias or a `paths` entry. ⭐ The monorepo
 * cannot observe the property at all, so a fix has to IMPORT knowledge from
 * outside. `../consumer-specifiers.ledger.json` is that knowledge; this file is
 * what makes it a test.
 *
 * ## Why this package
 *
 * `@objectstack/downstream-contract` already exists as "a frozen, representative
 * third-party consumer" whose fixtures a spec change must not break. This is the
 * same idea one level down: not "what metadata does a third party author" but
 * "what SPECIFIERS does a third party import". The README's contract governs
 * both halves — a red here is a break for a real downstream repo, and the remedy
 * is never to edit the frozen side to make it pass.
 *
 * ## Why a packed tarball and a child process, and not `require.resolve` here
 *
 * Resolving from inside this workspace proves nothing: this package's own
 * `node_modules/@objectstack/cli` is a symlink into `packages/cli`, and the
 * repo's tsconfig `paths` and vitest aliases bypass `exports` besides. So each
 * ledgered package is packed the way `pnpm publish` packs it, unpacked into a
 * throwaway `node_modules` under the OS temp dir, and every specifier is
 * resolved by a child `node` whose cwd is that directory and which has nothing
 * of this workspace on its resolution path — `createRequire().resolve()` for the
 * `require` condition and `import.meta.resolve()` for the `import` condition.
 *
 * That is the same technique as the pin PR #15611 adds under `packages/cli`,
 * arrived at for the same reason. ⚠️ That file is NOT on this tree — #15611 is
 * open and unmerged — so this suite reproduces the technique rather than reusing
 * it, and the two are independent by construction: the pin asks "does the CLI's
 * map still spell the subpaths this repo ratified", this asks "does every
 * specifier a named out-of-repo consumer imports still resolve". A pin over one
 * package's map cannot see the next package that gains one.
 *
 * ## SEALED_TODAY, and why the red is LEDGERED rather than simply asserted
 *
 * ⚠️ Two of the three seeded specifiers DO NOT RESOLVE on `origin/main` today.
 * `./hook-body` and `./package.json` are ratified by PR #15611, which is open and
 * unmerged — so hotcrm is broken right now, and a test that just asserted "every
 * ledgered specifier resolves" would be permanently red and could not land.
 *
 * A permanently red test is not an option and neither is dropping the two
 * entries, so the red is held the way this repo already holds a measured red
 * (`packages/cli/test/option-b-reader-acceptance.pin.test.ts`): `SEALED_TODAY`
 * records EXACTLY which ledgered specifiers this tree does not open, and the
 * assertion is set EQUALITY. That gives four directions where `toBe(0)` gives
 * one:
 *
 *   - a seal DROPS a resolving specifier          -> RED, naming the consumer.
 *     This is the #13662 / #15325 event, caught on the PR that causes it.
 *   - #15611 lands and the two doors open          -> RED, naming the lines to
 *     DELETE. The ledger of losses shrinks to empty; that is what "done" means.
 *   - a sealed one is re-sealed differently        -> RED, naming the row.
 *   - the probe quietly measures LESS              -> RED, because a specifier
 *     that stops being measured stops matching its line.
 *
 * ⛔ `SEALED_TODAY` is SHRINK-ONLY. Adding a line is never how a red is fixed:
 * a specifier that stops resolving is a broken consumer, which is the whole
 * subject. Every line cites the PR that removes it.
 *
 * ## What makes this non-vacuous
 *
 * A ledger gate that iterates zero entries, or that resolves through a package
 * with no `exports` map, passes while establishing nothing. So the shape checks
 * below are load-bearing, not decoration: the ledger must be non-empty, every
 * ledgered package must DECLARE an `exports` map (an unsealed package would
 * resolve every specifier trivially), every ledgered package must be a declared
 * dependency of this one (that graph edge is what makes turbo re-run this suite
 * when the package changes — without it the gate is real and never runs), and at
 * least one specifier must actually RESOLVE, so a run in which the tarball
 * failed to unpack cannot read as "all of them sealed, as recorded".
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
/** This package's own root — never another package's. */
const PACKAGE_ROOT = resolve(HERE, '..');
const LEDGER_PATH = join(PACKAGE_ROOT, 'consumer-specifiers.ledger.json');

interface LedgerEntry {
  specifier: string;
  consumer: string;
  since: string;
  ratifiedBy: string;
  note?: string;
}
interface Ledger {
  $comment: Record<string, unknown>;
  entries: LedgerEntry[];
}

const LEDGER = JSON.parse(readFileSync(LEDGER_PATH, 'utf8')) as Ledger;
const ENTRIES = LEDGER.entries;

/**
 * The ledgered specifiers this tree does NOT open, each with the reason and the
 * PR that removes the line. SHRINK-ONLY — see the header.
 */
const SEALED_TODAY: Record<string, string> = {
  '@objectstack/cli/hook-body':
    'ratified by PR #15611 (#15325), open and unmerged on this tree — hotcrm action-sandbox is broken until it lands',
  '@objectstack/cli/package.json':
    'ratified by PR #15611 (#15325), open and unmerged on this tree — the same harness cannot read the CLI manifest',
};

/** `@objectstack/cli/console` -> `@objectstack/cli`; `foo/bar` -> `foo`. */
function packageNameOf(specifier: string): string {
  const segs = specifier.split('/');
  return specifier.startsWith('@') ? segs.slice(0, 2).join('/') : segs[0];
}

/**
 * A child environment that declares itself, rather than inheriting the vitest
 * worker's. `TEST` / `VITEST*` change how some packages behave, and `NODE_PATH`
 * would put this workspace back on the child's resolution path — which would
 * silently defeat the entire point of resolving from outside it.
 */
function childEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k === 'TEST' || k === 'NODE_PATH' || k.startsWith('VITEST')) continue;
    out[k] = v;
  }
  return { ...out, ...extra };
}

interface Manifest {
  name: string;
  exports?: Record<string, unknown> | string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

const OWN_MANIFEST = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')) as Manifest;

/**
 * The workspace directory of a ledgered package, reached through this package's
 * own `node_modules` — i.e. through the DEPENDENCY, never through a hard-coded
 * `../../<pkg>` path. Two things follow from that and both are wanted: the read
 * is a vendored one, so it cannot silently escape this package's declared test
 * inputs; and it only works when the package is a declared dependency, which is
 * exactly the edge that makes turbo re-run this suite when the package changes.
 */
function workspaceDirOf(packageName: string): string {
  const linked = join(PACKAGE_ROOT, 'node_modules', ...packageName.split('/'));
  expect(
    existsSync(linked),
    `${packageName} is ledgered but not installed at ${linked} — declare it in this package's ` +
      'devDependencies, or the ledger names a package this suite can neither pack nor be re-run for',
  ).toBe(true);
  return realpathSync(linked);
}

/**
 * Pack as the release does. `pnpm pack` applies the same manifest rewrites as
 * `pnpm publish`, so the tarball is what a downstream `npm install` receives.
 * `npm_execpath` is honoured first when it names pnpm, so a nested invocation
 * packs with the pnpm that is running it.
 */
function pnpmPack(packageDir: string, destination: string): string {
  const execpath = process.env.npm_execpath;
  const viaExecpath = typeof execpath === 'string' && /pnpm/.test(basename(execpath));
  const [command, prefix]: [string, string[]] = viaExecpath ? [process.execPath, [execpath as string]] : ['pnpm', []];
  const res = spawnSync(command, [...prefix, 'pack', '--pack-destination', destination, '--json'], {
    cwd: packageDir,
    encoding: 'utf8',
    env: childEnv(),
  });
  if (res.error) throw new Error(`pnpm pack could not start (${command}): ${res.error.message}`);
  if (res.status !== 0) {
    throw new Error(`pnpm pack exited ${res.status} in ${packageDir}\n--- stdout ---\n${res.stdout}\n--- stderr ---\n${res.stderr}`);
  }
  const jsonStart = res.stdout.search(/^\{/m);
  if (jsonStart < 0) throw new Error(`pnpm pack --json printed no report\n${res.stdout}`);
  return (JSON.parse(res.stdout.slice(jsonStart)) as { filename: string }).filename;
}

/**
 * The probe. Plain ESM, no transform, importing nothing but Node built-ins: the
 * two resolution conditions a real consumer meets, over the specifiers handed to
 * it in a JSON file.
 */
const PROBE_SOURCE = `
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const specifiers = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const out = {};
for (const spec of specifiers) {
  const one = (fn) => {
    try { return { ok: true, path: fn(spec) }; }
    catch (e) { return { ok: false, code: e?.code ?? String(e) }; }
  };
  out[spec] = {
    require: one((s) => require.resolve(s)),
    import: one((s) => import.meta.resolve(s)),
  };
}
process.stdout.write(JSON.stringify(out));
`;

interface Resolution {
  ok: boolean;
  path?: string;
  code?: string;
}
type Probe = Record<string, { require: Resolution; import: Resolution }>;

let scratch: string;
let probe: Probe;
/** packageName -> its manifest, read from the WORKSPACE tree (what a PR edits). */
const manifests = new Map<string, Manifest>();

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'os-consumer-ledger-'));
  const consumer = join(scratch, 'consumer');
  mkdirSync(consumer, { recursive: true });
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({ name: 'ledgered-consumer', version: '1.0.0', type: 'module' }));

  const packageNames = [...new Set(ENTRIES.map((e) => packageNameOf(e.specifier)))].sort();
  for (const name of packageNames) {
    const dir = workspaceDirOf(name);
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as Manifest;
    manifests.set(name, manifest);

    // A missing build must not read as a sealed door: every specifier would fail
    // for the wrong reason and the run would look like a tree full of seals.
    const rootEntry = typeof manifest.exports === 'object' ? (manifest.exports as Record<string, unknown>)['.'] : undefined;
    const rootJs =
      typeof rootEntry === 'string' ? rootEntry : (rootEntry as { default?: string } | undefined)?.default;
    if (rootJs && !existsSync(join(dir, rootJs))) {
      throw new Error(
        `${name} is not built (${rootJs} is absent), so its tarball would carry no dist and every ` +
          `resolution below would fail for the wrong reason. Run: pnpm --filter '${name}...' build`,
      );
    }

    const tarball = pnpmPack(dir, scratch);
    const extractDir = mkdtempSync(join(scratch, 'extract-'));
    const tar = spawnSync('tar', ['-xzf', tarball, '-C', extractDir], { encoding: 'utf8', env: childEnv() });
    if (tar.status !== 0) throw new Error(`tar -xzf failed for ${name} (${tar.status}): ${tar.stderr}`);
    const scope = join(consumer, 'node_modules', ...name.split('/').slice(0, -1));
    mkdirSync(scope, { recursive: true });
    renameSync(join(extractDir, 'package'), join(consumer, 'node_modules', ...name.split('/')));
  }

  const listPath = join(consumer, 'specifiers.json');
  writeFileSync(listPath, JSON.stringify(ENTRIES.map((e) => e.specifier)));
  const probePath = join(consumer, 'probe.mjs');
  writeFileSync(probePath, PROBE_SOURCE);
  const run = spawnSync(process.execPath, [probePath, listPath], { cwd: consumer, encoding: 'utf8', env: childEnv() });
  if (run.status !== 0) throw new Error(`probe exited ${run.status}\n--- stderr ---\n${run.stderr}\n--- stdout ---\n${run.stdout}`);
  probe = JSON.parse(run.stdout) as Probe;
}, 300_000);

afterAll(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
});

describe('the ledger itself', () => {
  it('is non-empty — a ledger gate iterating nothing establishes nothing', () => {
    expect(ENTRIES.length).toBeGreaterThan(0);
  });

  it('states its purpose, its OWNER and the shrink-only rule', () => {
    expect(Object.keys(LEDGER.$comment)).toEqual(expect.arrayContaining(['purpose', 'owner', 'shrinkOnly']));
    expect(JSON.stringify(LEDGER.$comment.owner)).toContain('OWNER:');
  });

  it('gives every entry all four required fields', () => {
    for (const entry of ENTRIES) {
      for (const field of ['specifier', 'consumer', 'since', 'ratifiedBy'] as const) {
        expect(entry[field], `entry ${JSON.stringify(entry.specifier)} is missing "${field}"`).toBeTypeOf('string');
        expect((entry[field] as string).length, `entry ${JSON.stringify(entry.specifier)} has an empty "${field}"`).toBeGreaterThan(0);
      }
      expect(entry.since, `entry ${entry.specifier} has a non-ISO "since"`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(entry.ratifiedBy, `entry ${entry.specifier} must cite a card or PR`).toMatch(/#\d+/);
    }
  });

  it('carries no duplicate specifier', () => {
    const seen = ENTRIES.map((e) => e.specifier);
    expect(seen).toEqual([...new Set(seen)]);
  });

  it('records BARE specifiers — never the dist/ deep paths the seals closed', () => {
    for (const entry of ENTRIES) {
      // NOT `toContain('/')` — a SCOPED bare package name (`@objectstack/cli`)
      // contains one too, so that spelling admits exactly the entry this rule
      // exists to reject. The package name is what the ledger is silent about;
      // a subpath is what it records.
      expect(
        entry.specifier,
        `${entry.specifier} is a bare package name, not a subpath. The root entry of an exports ` +
          'map is never at risk in the way a subpath is — ledger the subpath the consumer imports',
      ).not.toBe(packageNameOf(entry.specifier));
      expect(
        entry.specifier,
        `${entry.specifier} is a dist/ deep path — those are what an exports map deliberately seals; ` +
          'ratify a subpath and ledger that instead',
      ).not.toMatch(/\/dist\//);
    }
  });
});

describe('every ledgered package is one this suite can actually judge', () => {
  it('is a declared dependency of this package — the graph edge that makes turbo re-run this suite', () => {
    const declared = { ...OWN_MANIFEST.dependencies, ...OWN_MANIFEST.devDependencies };
    for (const name of new Set(ENTRIES.map((e) => packageNameOf(e.specifier)))) {
      expect(
        declared[name],
        `${name} is ledgered but is not a dependency of ${OWN_MANIFEST.name}. Without that edge turbo's ` +
          'affected-package set never reaches this suite, so the gate exists and never runs on the PR that seals it',
      ).toBeTypeOf('string');
    }
  });

  it('declares an `exports` map — an unsealed package would resolve anything and prove nothing', () => {
    for (const [name, manifest] of manifests) {
      expect(
        manifest.exports,
        `${name} declares no "exports" map, so every specifier below resolves trivially and this ` +
          'suite would be green whatever the ledger said (check:published-files owns the invariant itself)',
      ).toBeTypeOf('object');
    }
  });
});

describe('resolution from a consumer directory outside the workspace', () => {
  /** What the probe saw, as the sentence a failure should print. */
  const describeEntry = (entry: LedgerEntry): string =>
    `${entry.specifier}\n      consumer:  ${entry.consumer}\n      ledgered:  ${entry.since} (${entry.ratifiedBy})\n` +
    `      probe:     ${JSON.stringify(probe[entry.specifier])}`;

  it('measured every ledgered specifier — a specifier the probe skipped is not a specifier that passed', () => {
    expect(Object.keys(probe).sort()).toEqual(ENTRIES.map((e) => e.specifier).sort());
  });

  it('opens at least one door — otherwise an unpacking failure would read as "all sealed, as recorded"', () => {
    const opened = ENTRIES.filter((e) => probe[e.specifier].require.ok);
    expect(
      opened.length,
      `not one ledgered specifier resolved. That is not a tree full of seals, it is a broken measurement — ` +
        `check that the packed tarballs unpacked.\n${ENTRIES.map(describeEntry).join('\n')}`,
    ).toBeGreaterThan(0);
  });

  it('resolves every ledgered specifier that is not recorded as sealed, under BOTH conditions', () => {
    for (const entry of ENTRIES) {
      if (entry.specifier in SEALED_TODAY) continue;
      const seen = probe[entry.specifier];
      expect(
        seen.require.ok,
        `SEALED: ${entry.specifier} no longer resolves under the \`require\` condition.\n` +
          `      This breaks ${entry.consumer}\n      ${describeEntry(entry)}\n` +
          '      Re-open the subpath in the package\'s exports map, or migrate the consumer and cite that migration in the ledger.',
      ).toBe(true);
      expect(
        seen.import.ok,
        `SEALED: ${entry.specifier} no longer resolves under the \`import\` condition.\n` +
          `      This breaks ${entry.consumer}\n      ${describeEntry(entry)}`,
      ).toBe(true);
    }
  });

  it('has exactly the sealed set SEALED_TODAY records — no more, and no fewer', () => {
    const sealed = ENTRIES.filter((e) => !probe[e.specifier].require.ok || !probe[e.specifier].import.ok)
      .map((e) => e.specifier)
      .sort();
    const recorded = Object.keys(SEALED_TODAY).sort();
    expect(
      sealed,
      'the sealed set moved.\n' +
        `  measured: ${JSON.stringify(sealed)}\n  recorded: ${JSON.stringify(recorded)}\n` +
        '  A specifier that GAINED resolution (it is recorded but no longer measured) means the ratifying PR landed — ' +
        'DELETE its SEALED_TODAY line; that ledger is shrink-only and reaching empty is what "done" means.\n' +
        '  A specifier that LOST resolution (measured but not recorded) is a live downstream break: ' +
        `${ENTRIES.filter((e) => sealed.includes(e.specifier) && !(e.specifier in SEALED_TODAY)).map((e) => `${e.specifier} -> ${e.consumer}`).join('; ') || '(none)'}`,
    ).toEqual(recorded);
  });
});
