import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CLIENT_PACKAGE_NAME,
  resolveClientDistInjection,
  widenVendorChunkTestForClient,
} from '../vite-objectstack-client-dist';

/**
 * objectui#6094 — `OBJECTSTACK_CLIENT_DIST` validates the override it aliases.
 *
 * The hook lets a developer point the console at a locally built
 * `@objectstack/client`. Before this card it was a bare string alias: no
 * existence check, no manifest read, no dependency check. Measured on
 * `a100f77d3` with the override aimed at a copy of the installed client placed
 * outside the workspace, `vite build` printed `✓ 8615 modules transformed`,
 * wrote every chunk, and left the client's three own bare specifiers
 * (`@objectstack/core/logger`, `@objectstack/spec/api`, `@objectstack/spec/data`)
 * in `assets/framework-*.js` as calls to rolldown's `require` shim — a bundle no
 * browser can load, produced by a build whose output never named the variable.
 *
 * Three facts are pinned here, and they pull against each other on purpose:
 *
 *   1. **Set and broken → refused, by NAME.** The card's complaint is not that
 *      the build survived; it is that nothing named `OBJECTSTACK_CLIENT_DIST`.
 *      So the cases below assert the variable appears in the message, not
 *      merely that something threw.
 *   2. **Set and valid → still injected.** A check that refused every override
 *      would pass (1) while destroying the hook's only purpose. Both valid
 *      spellings are exercised against the REAL installed client.
 *   3. **Unset → nothing moves.** The alias table and `server.fs.allow` stay at
 *      their baseline values, read off the real console config, so a check that
 *      stopped being conditional turns red here rather than shipping a
 *      different production bundle.
 *
 * The shape axis cuts across all three: a directory, its `dist/`, and an entry
 * file inside it are all legal, and a dependency check is parameterised over a
 * DIRECTORY. A check that quietly did nothing for the entry-file spelling would
 * be the same defect wearing a green build, so every refusal case is asserted
 * for both spellings.
 *
 * Reverse verification — direction predicted BEFORE each run, and one
 * prediction was wrong in a way worth keeping:
 *
 *   - **Start the walk at `resolved` even for a file** (drop the
 *     `shape === 'directory'` branch in `findClientPackageDir`). Predicted RED
 *     on the entry-file cases. Measured **GREEN, 19/19** — and that is a fact
 *     about the code, not a vacuous suite. The walk probes
 *     `<dir>/package.json` and climbs; handed `…/dist/index.mjs` its first
 *     probe simply misses (`…/index.mjs/package.json`) and the next iteration
 *     lands on `…/dist` anyway. The branch is explicitness about where the walk
 *     starts, not the mechanism that makes the file spelling work — the walk
 *     itself is indifferent. Recorded rather than deleted: a green ablation
 *     left unexplained reads as a test that pins nothing.
 *   - **Skip validation entirely for the entry-file spelling** — the naive port
 *     of a directory-parameterised check, and the exact defect class the card
 *     names ("a check that silently does nothing when pointed at a
 *     `dist/index.js`"). Predicted RED on the entry-file cases; measured 3 red,
 *     including *refuses an out-of-tree copy given as an entry file*. That is
 *     the pin the first leg was reaching for.
 *   - **Drop the `realpathSync`** in `findClientPackageDir`. Predicted RED on
 *     the valid installed-client cases, because pnpm reaches the client through
 *     a symlink whose ancestors never include the store directory holding its
 *     dependencies. Measured 5 red, every one of them "a VALID override is
 *     rejected" — the direction that matters, since a suite blind to it would
 *     have shipped a hook that refuses everything and still passed the
 *     reproduction.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * The installed client, as the console resolves it — under pnpm a SYMLINK into
 * the store, which is the whole point of the realpath cases below.
 */
const installedClientDir = path.join(repoRoot, 'apps/console/node_modules/@objectstack/client');

/** Fixture roots created here, removed in `afterAll`. */
const fixtureRoots: string[] = [];

function makeFixtureRoot(): string {
  // Each fixture gets its OWN `mkdtempSync` root rather than sharing
  // `os.tmpdir()`, which every other suite and every parallel agent also writes
  // to — and, more to the point here, the walk under test climbs its ancestors.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'client-dist-6094-'));
  fixtureRoots.push(root);
  return root;
}

/**
 * A copy of the installed client placed outside the workspace — manifest and
 * `dist/` intact, no reachable `node_modules` for its two dependencies.
 *
 * This is the card's reproduction, reduced to a fixture.
 */
function outOfTreeClientCopy(): string {
  const dest = path.join(makeFixtureRoot(), 'client');
  fs.cpSync(fs.realpathSync(installedClientDir), dest, { recursive: true, dereference: true });
  return dest;
}

/**
 * The walk `packageResolvesFrom` performs, re-stated here as a MEASUREMENT
 * rather than an import: these cases exist to show what the production walk
 * would answer if it ran from the un-realpath'd path, which is precisely what
 * the module refuses to do.
 */
function walkResolves(startDir: string, name: string): boolean {
  let dir = startDir;
  for (;;) {
    if (fs.existsSync(path.join(dir, 'node_modules', name))) return true;
    const parent = path.dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

/**
 * A fresh evaluation of the console's Vite config, keyed by `query`.
 *
 * The specifier is assembled at runtime on purpose — a literal one would pull
 * `apps/console/vite.config.ts` into this program, where `tsconfig.scripts.json`
 * (no `allowImportingTsExtensions`) turns its own `.ts` imports into TS5097.
 * Same reasoning, same spelling as the spec-dist suite next door.
 */
async function loadConsoleConfig(query = ''): Promise<any> {
  const specifier = `../../apps/console/vite.config.ts${query}`;
  return (await import(/* @vite-ignore */ specifier)).default;
}

beforeAll(() => {
  // Every case below reads the installed client. If the workspace is not
  // installed, say so here rather than letting each case invent its own
  // explanation for a missing directory.
  expect(fs.existsSync(path.join(installedClientDir, 'package.json'))).toBe(true);
});

afterAll(() => {
  for (const root of fixtureRoots) fs.rmSync(root, { recursive: true, force: true });
});

describe('objectui#6094: unset leaves the hook inert', () => {
  it.each([undefined, '', '   '])('returns null for %j', (raw) => {
    expect(resolveClientDistInjection(raw)).toBeNull();
  });

  it('leaves the console config at its baseline alias and fs.allow', async () => {
    const config = await loadConsoleConfig();
    expect(config.resolve.alias[CLIENT_PACKAGE_NAME]).toBeUndefined();
    // `server.fs` is absent entirely when neither override is set, so Vite
    // keeps its own default allow-list.
    expect(config.server.fs).toBeUndefined();
  });
});

describe('objectui#6094: a VALID override is still injected — all three spellings', () => {
  const realClientDir = () => fs.realpathSync(installedClientDir);

  it('accepts the package directory', () => {
    const injection = resolveClientDistInjection(installedClientDir);
    expect(injection).not.toBeNull();
    expect(injection!.aliasTarget).toBe(installedClientDir);
    expect(injection!.packageDir).toBe(realClientDir());
  });

  it('accepts the `dist/` directory inside the package', () => {
    const dist = path.join(installedClientDir, 'dist');
    const injection = resolveClientDistInjection(dist);
    expect(injection!.aliasTarget).toBe(dist);
    // The walk climbed out of `dist/` to the package that owns it.
    expect(injection!.packageDir).toBe(realClientDir());
  });

  it('accepts a built entry FILE inside the package', () => {
    const entry = path.join(installedClientDir, 'dist/index.mjs');
    expect(fs.statSync(entry).isFile()).toBe(true);
    const injection = resolveClientDistInjection(entry);
    expect(injection!.aliasTarget).toBe(entry);
    expect(injection!.packageDir).toBe(realClientDir());
    // The alias target is the file, unchanged from the pre-check config; only
    // the dependency walk uses the package directory.
    expect(injection!.fsAllow).toEqual([
      path.join(installedClientDir, 'dist'),
      installedClientDir,
    ]);
  });

  it('resolves the dependency walk through the pnpm symlink, not around it', () => {
    // Skipped only where the installed client is NOT a symlink (a hoisted,
    // non-pnpm install), because then there is no symlink for the realpath to
    // make a difference to and the counter-probe would be measuring nothing.
    if (fs.realpathSync(installedClientDir) === installedClientDir) return;

    // The measurement that makes `realpathSync` load-bearing rather than
    // tidy: from the symlink path, the client's own dependency is NOT found —
    // the walk climbs `apps/console/node_modules` → `apps/console` → the repo
    // root, none of which carry `node_modules/@objectstack/core`. From the
    // store path it is found, beside the store copy of the client.
    expect(walkResolves(installedClientDir, '@objectstack/core')).toBe(false);
    expect(walkResolves(fs.realpathSync(installedClientDir), '@objectstack/core')).toBe(true);
    // …so the injection, which walks from `packageDir`, must be reading the
    // store path. Without this the check would reject the installed client —
    // the one input it must accept.
    expect(resolveClientDistInjection(installedClientDir)!.packageDir).not.toBe(installedClientDir);
  });

  it('does not demand `peerDependencies` — they come from the consuming app', () => {
    const dir = path.join(makeFixtureRoot(), 'client');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: CLIENT_PACKAGE_NAME, peerDependencies: { react: '^19' } })
    );
    expect(resolveClientDistInjection(dir)).not.toBeNull();
  });

  it('tolerates a manifest with no `dependencies` at all', () => {
    const dir = path.join(makeFixtureRoot(), 'client');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: CLIENT_PACKAGE_NAME }));
    expect(resolveClientDistInjection(dir)).not.toBeNull();
  });

  it('injects into the real console config: alias plus a widened fs.allow', async () => {
    const baseline = await loadConsoleConfig();
    process.env.OBJECTSTACK_CLIENT_DIST = installedClientDir;
    let injected: any;
    try {
      // A distinct module id (the query suffix) so the baseline evaluation
      // above stays intact and the two can be compared. `vi.resetModules()` is
      // not an option: the `unit` project runs `isolate: false`.
      injected = await loadConsoleConfig('?objectstack-client-dist=6094');
    } finally {
      delete process.env.OBJECTSTACK_CLIENT_DIST;
    }

    expect(injected.resolve.alias[CLIENT_PACKAGE_NAME]).toBe(installedClientDir);
    expect(injected.server.fs.allow).toEqual([
      repoRoot,
      path.dirname(installedClientDir),
      path.resolve(path.dirname(installedClientDir), '..'),
    ]);
    // …and the baseline evaluation is untouched by the second one, which is
    // what makes the inert case above meaningful.
    expect(baseline.resolve.alias[CLIENT_PACKAGE_NAME]).toBeUndefined();
  });
});

describe('objectui#6094: a BROKEN override is refused, naming the variable', () => {
  it('refuses a path that does not exist', () => {
    const missing = path.join(makeFixtureRoot(), 'no-such-client');
    expect(() => resolveClientDistInjection(missing)).toThrow(/OBJECTSTACK_CLIENT_DIST/);
    expect(() => resolveClientDistInjection(missing)).toThrow(/does not exist/);
  });

  // The card's reproduction, both spellings. The entry-file row is the one that
  // matters most: a check parameterised over a package directory, handed a
  // file, is exactly where "silently does nothing" hides.
  const brokenShapes = [
    ['directory', (root: string) => root],
    ['`dist/` directory', (root: string) => path.join(root, 'dist')],
    ['entry file', (root: string) => path.join(root, 'dist/index.mjs')],
  ] as const;

  it.each(brokenShapes)(
    'refuses an out-of-tree copy given as a %s, naming every unresolved dependency',
    (_label, pick) => {
      const copy = outOfTreeClientCopy();
      const value = pick(copy);
      expect(fs.existsSync(value)).toBe(true);

      let thrown: Error | undefined;
      try {
        resolveClientDistInjection(value);
      } catch (error) {
        thrown = error as Error;
      }
      expect(thrown).toBeDefined();
      const message = thrown!.message;

      // 1. It names the variable — the card's actual complaint.
      expect(message).toContain('OBJECTSTACK_CLIENT_DIST');
      // 2. It names the dependencies that do not resolve, both of them: these
      //    are the packages owning the three bare specifiers that survived into
      //    the bundle (`@objectstack/core/logger`, `@objectstack/spec/api`,
      //    `@objectstack/spec/data`).
      expect(message).toContain('@objectstack/core');
      expect(message).toContain('@objectstack/spec');
      // 3. It names the package directory the walk judged, so a reader can see
      //    WHICH tree was searched — the fact that decides whether the fix is
      //    "install deps there" or "point somewhere else".
      expect(message).toContain(fs.realpathSync(copy));
      // 4. It is the dependency verdict, not the shape verdict: a check that
      //    failed the entry-file row with "not inside a package" would satisfy
      //    (1) while telling the reader nothing true.
      expect(message).toMatch(/do(es)? not resolve from/);
    }
  );

  it('refuses a bare `dist/` copied out with no manifest anywhere above it', () => {
    // The other half of the card's reproduction: copy only `dist/`, and there
    // is no `package.json` in any ancestor — so there is no manifest to read
    // dependencies from, and the refusal has to say THAT rather than invent a
    // dependency verdict.
    const root = makeFixtureRoot();
    fs.cpSync(path.join(fs.realpathSync(installedClientDir), 'dist'), path.join(root, 'dist'), {
      recursive: true,
      dereference: true,
    });
    for (const value of [path.join(root, 'dist'), path.join(root, 'dist/index.mjs')]) {
      expect(() => resolveClientDistInjection(value)).toThrow(/OBJECTSTACK_CLIENT_DIST/);
      expect(() => resolveClientDistInjection(value)).toThrow(/is not inside a/);
      expect(() => resolveClientDistInjection(value)).toThrow(/@objectstack\/client/);
    }
  });

  it('refuses a path whose nearest manifest is some OTHER package', () => {
    // Without the name match the walk would stop at the first `package.json`
    // above the value and validate THAT package's dependencies — a check that
    // always passes, on the wrong subject. `apps/console` is a real package
    // with real, resolvable dependencies, so it would pass exactly that way.
    const consoleDir = path.join(repoRoot, 'apps/console');
    expect(() => resolveClientDistInjection(consoleDir)).toThrow(/is not inside a/);
    expect(() => resolveClientDistInjection(consoleDir)).toThrow(/OBJECTSTACK_CLIENT_DIST/);
  });

  it('refuses an unreadable manifest instead of skipping past it', () => {
    const dir = path.join(makeFixtureRoot(), 'client');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), '{ not json');
    expect(() => resolveClientDistInjection(dir)).toThrow(/is not readable JSON/);
    expect(() => resolveClientDistInjection(dir)).toThrow(/OBJECTSTACK_CLIENT_DIST/);
  });

  it('fails the console config LOAD, before any module is bundled', async () => {
    // Where the refusal lands is the whole value of the card: at config
    // evaluation, with the variable named — not a build later, in a resolve
    // error naming a specifier the reader never typed.
    const copy = outOfTreeClientCopy();
    process.env.OBJECTSTACK_CLIENT_DIST = copy;
    try {
      await expect(loadConsoleConfig('?objectstack-client-dist=6094-broken')).rejects.toThrow(
        /OBJECTSTACK_CLIENT_DIST/
      );
    } finally {
      delete process.env.OBJECTSTACK_CLIENT_DIST;
    }
  });
});

/**
 * An injected client stays in `vendor-objectstack`.
 *
 * objectstack's `build-console.sh` always injects its own client, from a
 * workspace path (`<framework>/packages/client`) that the baseline group test —
 * written against `node_modules/@objectstack/` and pnpm's `@objectstack+` store
 * paths — does not match. Unmatched, the client landed in `framework` while
 * `data-adapter` required it at top level, and the console died at boot with
 * `TypeError: u is not a function` (measured on `9f0c84a44`). The fixture below
 * reproduces that layout: a client package outside any `node_modules`, its
 * dependencies reachable from a workspace-root `node_modules`.
 *
 * Reverse verification: with `vendorObjectstackTest` back on the bare
 * `specDistInjection ? … : VENDOR_OBJECTSTACK_TEST` expression, the config case
 * below goes red (the injected module id is not claimed) while the helper cases
 * stay green — the config case is the one that pins the wiring.
 */
describe('an injected client joins the vendor-objectstack group', () => {
  function workspaceClient(): string {
    const root = makeFixtureRoot();
    const clientDir = path.join(root, 'packages', 'client');
    fs.cpSync(fs.realpathSync(installedClientDir), clientDir, { recursive: true, dereference: true });
    for (const dep of ['core', 'spec']) {
      fs.mkdirSync(path.join(root, 'node_modules', '@objectstack', dep), { recursive: true });
    }
    return clientDir;
  }

  const BASELINE = /([\\/]node_modules[\\/]@objectstack[\\/](?!lint[\\/])|[\\/]@objectstack\+(?!lint@))/;

  it('returns the baseline test itself when nothing is injected', () => {
    expect(widenVendorChunkTestForClient(BASELINE, null)).toBe(BASELINE);
  });

  it('claims a module under the injected package, and still everything the baseline claimed', () => {
    const clientDir = workspaceClient();
    const injection = resolveClientDistInjection(clientDir);
    expect(injection).not.toBeNull();
    const moduleId = path.join(fs.realpathSync(clientDir), 'dist', 'index.js').split(path.sep).join('/');

    expect(BASELINE.test(moduleId)).toBe(false);
    const widened = widenVendorChunkTestForClient(BASELINE, injection);
    expect(widened.test(moduleId)).toBe(true);
    expect(widened.test('/r/node_modules/@objectstack/spec/dist/index.mjs')).toBe(true);
    expect(widened.test('/r/node_modules/.pnpm/@objectstack+core@1.0.0/x.js')).toBe(true);
    // A sibling directory that merely shares the prefix is not claimed.
    expect(widened.test(`${fs.realpathSync(clientDir).split(path.sep).join('/')}-other/dist/index.js`)).toBe(false);
  });

  it('widens the vendor-objectstack group of the real console config', async () => {
    const clientDir = workspaceClient();
    const moduleId = path.join(fs.realpathSync(clientDir), 'dist', 'index.js').split(path.sep).join('/');
    const vendorTest = (config: any): RegExp =>
      config.build.rollupOptions.output.advancedChunks.groups.find(
        (g: { name: string }) => g.name === 'vendor-objectstack'
      ).test;

    const baseline = await loadConsoleConfig();
    process.env.OBJECTSTACK_CLIENT_DIST = clientDir;
    let injected: any;
    try {
      injected = await loadConsoleConfig('?objectstack-client-dist=vendor-chunk');
    } finally {
      delete process.env.OBJECTSTACK_CLIENT_DIST;
    }

    expect(vendorTest(baseline).test(moduleId)).toBe(false);
    expect(vendorTest(injected).test(moduleId)).toBe(true);
  });
});
