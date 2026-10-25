// `OBJECTSTACK_CLIENT_DIST` — resolve `@objectstack/client` at a locally built
// client instead of the one the lockfile installed, and REFUSE the build when
// that override cannot work.
//
// ## What was missing (objectui#6094)
//
// The hook itself is old: `apps/console/vite.config.ts` has aliased
// `@objectstack/client` at `path.resolve(process.env.OBJECTSTACK_CLIENT_DIST)`
// for as long as a developer has needed to exercise a client before it ships.
// Nothing validated that value — no existence check, no manifest read, no
// dependency check — and the hook is aimed, BY DESIGN, at a freshly built,
// not-yet-installed tree, which is exactly the situation where a reachable
// `node_modules` is absent or incomplete.
//
// Measured on `a100f77d3` (vite 8.2.1 + rolldown 1.2.3) with the override
// pointed at a copy of the installed `@objectstack/client@17.2.0` placed
// outside the workspace: `vite build` prints `✓ 8615 modules transformed`,
// renders every chunk, writes `dist/` and lists its gzip sizes. The client's
// three own bare specifiers — `@objectstack/core/logger`, `@objectstack/spec/api`,
// `@objectstack/spec/data` — survive into `assets/framework-*.js` as calls to
// rolldown's `require` shim, which throws in a browser. The build then dies for
// an unrelated reason (`ineffective-dynamic-import-ledger`, objectui#6093);
// with that plugin out of the array, rolldown's own resolve error surfaces
// instead. NEITHER failure names `OBJECTSTACK_CLIENT_DIST`, and both arrive a
// whole build after the value that caused them was read.
//
// That is the same failure mode objectui#5391 was filed about on the SPEC hook,
// where PR #5995 answered it with a fail-fast dependency check.
//
// ## Why this is a sibling module and not a shared helper
//
// Ruled on objectui#6094: the two hooks are not symmetrical. The spec hook
// derives 18 aliases from the override's `exports` map, because a bare prefix
// alias cannot express a map that redirects every subpath into `dist/`. The
// client hook is ONE alias — `@objectstack/client` exports a single entry —
// and its accepted input is wider: a package directory, its `dist/`, or a
// built entry file inside it. Only the dependency check transfers, so it is
// re-stated here rather than extracted; a helper bent across both shapes would
// impose the spec hook's assumptions on this one. If a third hook ever appears,
// that is the moment to abstract.
//
// ## The shape ambiguity is the substance
//
// A dependency check is parameterised over a package DIRECTORY, and this hook
// may be handed a FILE. Detecting that wrongly is not a milder bug than the one
// being fixed — a check that silently does nothing when pointed at
// `dist/index.mjs` is the same defect class, with a green build to hide behind.
// So the resolution is one upward walk (below) that is indifferent to which of
// the three spellings arrived, and the shape is carried into every message so
// the reader can see which one this hook believed it got.

import fs from 'node:fs';
import path from 'node:path';

/** The package this hook overrides. Also the guard against a mis-aimed path. */
export const CLIENT_PACKAGE_NAME = '@objectstack/client';

/** What the caller wires into its Vite config when the override is set. */
export interface ClientDistInjection {
  /**
   * The `resolve.alias` target for `@objectstack/client`.
   *
   * `path.resolve(raw)` — the value the config has always used, deliberately
   * NOT the realpath below. This card adds validation; it does not move the
   * alias, the module ids that follow from it, or the chunk membership those
   * ids decide.
   */
  aliasTarget: string;
  /**
   * Realpath'd directory of the overriding client package — the root the
   * dependency walk runs from, and the only place a realpath is required.
   *
   * Not cosmetic. Under pnpm the installed client is reached through
   * `apps/console/node_modules/@objectstack/client`, a symlink into the store,
   * and its dependencies live beside the store copy
   * (`.pnpm/@objectstack+client@17.2.0_…/node_modules/@objectstack/{core,spec}`).
   * Walking up from the SYMLINK path never passes that directory: it climbs
   * `apps/console/node_modules` → `apps/console` → the repo root, where neither
   * `@objectstack/core` nor a nested `node_modules` for it exists. Measured on
   * this repo: a valid, installed-package override is REJECTED without the
   * realpath — the check would fail the one input it must accept.
   */
  packageDir: string;
  /** Directories the dev server must be allowed to read (out-of-workspace). */
  fsAllow: string[];
}

/**
 * How the raw value pointed at the package — carried into messages so a refusal
 * says which spelling this hook resolved, not just that it refused.
 */
type OverrideShape = 'directory' | 'entry file';

// A function DECLARATION, not a `const` arrow: TypeScript only narrows on a
// never-returning call when the callee is declared this way, and the callers
// below rely on that narrowing to keep their own return types honest.
function fail(message: string): never {
  throw new Error(`OBJECTSTACK_CLIENT_DIST: ${message}`);
}

/**
 * Whether an ancestor `node_modules` of `startDir` contains a directory named
 * `name` — an upward directory walk, aimed at `node_modules/<name>`.
 *
 * Deliberately NOT `require.resolve(name, { paths: [startDir] })`, though that
 * reads as the obvious tool. `Module.globalPaths` is consulted REGARDLESS of an
 * explicit `paths` list, and this repo's own `node_modules/.bin/vite` shim
 * exports `NODE_PATH` at pnpm's flat hoist directory — so `require.resolve`
 * reports an override's MISSING dependency as resolved, silently, every time
 * the hook runs through the real `vite` CLI rather than a bare `node`. The same
 * trap is documented at length on the spec hook's copy of this walk
 * (`scripts/vite-objectstack-spec-dist.ts`), which is where it was measured.
 * A plain directory walk consults nothing global.
 */
function packageResolvesFrom(startDir: string, name: string): boolean {
  let dir = startDir;
  for (;;) {
    if (fs.existsSync(path.join(dir, 'node_modules', name))) return true;
    const parent = path.dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

/**
 * The `@objectstack/client` package directory a raw override value names.
 *
 * One walk covers all three accepted spellings, which is the point: a directory
 * starts the walk at itself, a file starts it at its own directory, and the
 * walk stops at the nearest ancestor whose `package.json` IS the client. So
 * `…/client`, `…/client/dist` and `…/client/dist/index.mjs` all resolve to
 * `…/client`, and none of them can quietly resolve to "nothing to check".
 *
 * The `shape` branch below states where the walk starts; it is not what makes
 * the file spelling work. Measured by ablation (see the suite's header): with
 * the branch removed the walk still resolves an entry file correctly, because
 * its first probe — `…/index.mjs/package.json` — simply misses and the next
 * iteration lands on the containing directory. Kept because a reader should not
 * have to derive that, and because the walk's shape is not a contract.
 *
 * The name match is load-bearing rather than decorative. Without it the walk
 * would stop at whatever manifest happens to sit above the value — a framework
 * monorepo root, or this repo — and then dutifully validate THAT package's
 * dependencies: a check that always passes, on the wrong subject, which is the
 * failure this hook exists to end.
 */
function findClientPackageDir(
  raw: string,
  resolved: string,
  shape: OverrideShape
): string {
  let dir = shape === 'directory' ? resolved : path.dirname(resolved);
  const inspected: string[] = [];
  for (;;) {
    const manifestPath = path.join(dir, 'package.json');
    if (fs.existsSync(manifestPath)) {
      inspected.push(manifestPath);
      let name: unknown;
      try {
        name = (JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { name?: unknown }).name;
      } catch (error) {
        fail(`\`${manifestPath}\` is not readable JSON (${(error as Error).message})`);
      }
      if (name === CLIENT_PACKAGE_NAME) {
        try {
          return fs.realpathSync(dir);
        } catch {
          return dir;
        }
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return fail(
    `\`${raw}\` is not inside a \`${CLIENT_PACKAGE_NAME}\` package — resolved to the ${shape} ` +
      `\`${resolved}\` and walked up from there, finding ` +
      `${inspected.length ? inspected.join(', ') : 'no package.json'}. Point the variable at a ` +
      `built \`${CLIENT_PACKAGE_NAME}\` (its directory, its \`dist/\`, or an entry file inside it)`
  );
}

/**
 * Confirms the override's own `dependencies` resolve from `packageDir`.
 *
 * The check that makes the difference between failing HERE, naming the
 * variable, and failing a whole build later naming a specifier the reader has
 * no reason to connect to an override they set in their shell.
 *
 * Deliberately narrow, matching the spec hook's precedent: only the manifest's
 * own `dependencies`. Not transitive ones — this is not a dependency-graph
 * validator, and a broken transitive package fails the same way one frame
 * further in, still at build time. Not `peerDependencies` either: a peer is BY
 * DESIGN supplied by the consuming app rather than living in the override's own
 * tree, so demanding it resolve from `packageDir` would fail a correctly built
 * override and report a non-problem.
 */
function assertClientDependenciesResolve(packageDir: string, shape: OverrideShape): void {
  const manifestPath = path.join(packageDir, 'package.json');
  // Already proven to be valid JSON at this exact path by `findClientPackageDir`,
  // which is the only caller's only route here, so this re-read does not repeat
  // that try/catch.
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { dependencies?: unknown };
  const dependencies = manifest.dependencies;
  if (dependencies === null || typeof dependencies !== 'object' || Array.isArray(dependencies)) return;

  const unresolved = Object.keys(dependencies as Record<string, unknown>).filter(
    (name) => !packageResolvesFrom(packageDir, name)
  );
  if (unresolved.length === 0) return;

  const isSingular = unresolved.length === 1;
  fail(
    `\`${manifestPath}\` declares ${isSingular ? 'a dependency' : 'dependencies'} that ` +
      `${isSingular ? 'does' : 'do'} not resolve from \`${packageDir}\`: ${unresolved.join(', ')} — ` +
      `the override (given as ${a(shape)}) points at a client build with no reachable ` +
      `\`node_modules\` for ${isSingular ? 'it' : 'them'}. Every specifier the client imports from ` +
      `${isSingular ? 'that package' : 'those packages'} would be left unresolved in a browser ` +
      `bundle, which this build reports — when it reports it at all — as a failure naming the ` +
      `specifier and never this variable. Install the override's own dependencies (or point at a ` +
      `build where they are reachable) before setting \`OBJECTSTACK_CLIENT_DIST\``
  );
}

/** `'directory'` → `'a directory'`, `'entry file'` → `'an entry file'`. */
function a(shape: OverrideShape): string {
  return shape === 'entry file' ? `an ${shape}` : `a ${shape}`;
}

/**
 * The `vendor-objectstack` group test, widened so an injected client stays in
 * that group — or `vendorChunkTest` itself, unchanged, when nothing is injected.
 *
 * An injected client resolves OUTSIDE `node_modules`, so the baseline test —
 * written against `node_modules/@objectstack/` and pnpm's `@objectstack+` store
 * paths — stops matching it, exactly as it stops matching an injected spec (the
 * spec hook widens the same test for the same reason). Left unmatched, the
 * client lands wherever its importers pull it. Measured on objectui `9f0c84a44`
 * built by objectstack's `build-console.sh` (which always injects its own
 * client): `chunk-membership.json` put the client's one module in `framework`,
 * while `data-adapter` — no longer recursive since #9488 — imports it, and
 * `framework` imports `data-adapter` back (`packages/react`'s
 * `error-message.ts` → `isApiAccessDeniedError`). The client ships as CJS, so
 * `data-adapter`'s top-level `require` runs before `framework` has defined it
 * and the console dies at boot with `TypeError: u is not a function`. Before
 * #9488 the recursive `data-adapter` group swallowed the client and hid the gap.
 * With the client in `vendor-objectstack` the cycle is gone and the console
 * boots; `chunk-membership.json` then reads `client: { 'vendor-objectstack': 1 }`.
 *
 * Widened, never replaced — the baseline stays whole and the override's
 * directory joins it as one more alternative, matched on a path-separator
 * boundary so a sibling directory sharing the prefix is not claimed.
 *
 * @param vendorChunkTest the config's `vendor-objectstack` group test so far
 * @param injection the resolved override, or `null` when unset
 */
export function widenVendorChunkTestForClient(
  vendorChunkTest: RegExp,
  injection: ClientDistInjection | null,
): RegExp {
  if (!injection) return vendorChunkTest;
  const posixDir = injection.packageDir.split(path.sep).join('/');
  const escaped = posixDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`${vendorChunkTest.source}|${escaped}[\\\\/]`);
}

/**
 * Resolve the override, or `null` when it is unset.
 *
 * Inert when unset, exactly as the plain string alias it replaces was: `null`
 * leaves the caller's alias table and `server.fs.allow` at their baseline
 * values, so a production or CI build is byte-identical to one made before this
 * check existed.
 *
 * Loud when set and wrong. Every way the override can fail — path absent, not a
 * `@objectstack/client` package, an unreadable manifest, a declared dependency
 * that cannot resolve from where the package sits — throws with the offending
 * value named and `OBJECTSTACK_CLIENT_DIST` in the message. There is no
 * tolerant fallback to the installed client on purpose: falling back would
 * rebuild the exact silent skew the hook exists to expose, and the developer
 * who set the variable could not tell the difference.
 *
 * @param raw the `OBJECTSTACK_CLIENT_DIST` value, unset or empty for none
 */
export function resolveClientDistInjection(raw: string | undefined): ClientDistInjection | null {
  if (!raw || !raw.trim()) return null;

  const trimmed = raw.trim();
  const resolved = path.resolve(trimmed);
  if (!fs.existsSync(resolved)) {
    fail(
      `\`${trimmed}\` does not exist (resolved to \`${resolved}\`) — nothing would be aliased at ` +
        `\`${CLIENT_PACKAGE_NAME}\` and the build would fail later, naming the specifier instead ` +
        `of this variable`
    );
  }

  const shape: OverrideShape = fs.statSync(resolved).isDirectory() ? 'directory' : 'entry file';
  const packageDir = findClientPackageDir(trimmed, resolved, shape);
  assertClientDependenciesResolve(packageDir, shape);

  return {
    aliasTarget: resolved,
    packageDir,
    // Unchanged from the pre-check config, deliberately: `path.dirname` of the
    // resolved value plus its parent, which covers `…/<pkg>/dist/index.mjs` →
    // `…/<pkg>` for the entry-file spelling. The dev server serves the override
    // from outside the workspace root, which Vite's default `fs.allow` answers
    // with a 403 and a blank page rather than an error.
    fsAllow: [path.dirname(resolved), path.resolve(path.dirname(resolved), '..')],
  };
}
