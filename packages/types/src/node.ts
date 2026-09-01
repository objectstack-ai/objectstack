// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `@objectstack/types/node` — the **node-only** slice of the shared utilities.
 *
 * WHY A SUBPATH AND NOT THE ROOT EXPORT. `@objectstack/types` is a dependency of
 * `@objectstack/hono`, whose whole reason to exist is "edge-compatible REST API
 * server for Cloudflare Workers, Deno, Bun, and Node" — and of the plugin/service
 * layer a `LiteKernel` boots on Workers. The root entry (`src/index.ts`) reaches
 * **zero** `node:` builtins today, and that is a property those consumers depend
 * on: a Workers bundle that pulls in `node:module` fails to build (or dies at
 * first call) even when nothing ever invokes it. Everything here needs
 * `node:module` / `node:url` by definition — it exists to drive Node's own
 * resolver — so it lives behind its own entry point instead.
 *
 * The isolation is structural, not conventional: `tsup` builds `src/index.ts` and
 * `src/node.ts` as separate entries with `splitting: false`, so the root bundle
 * contains no reference to this file, and `node-isolation.test.ts` fails the
 * build if anything reachable from the root ever imports a `node:` builtin. Same
 * arrangement `@objectstack/metadata` already ships for `./node`.
 *
 * ── What lives here ──────────────────────────────────────────────────────────
 *
 * Resolving optional packages from the **host app**, not from the framework
 * package doing the importing.
 *
 * Node ESM resolves a bare `import('pkg')` against the **importer's own
 * realpath**. Framework packages (the CLI, `@objectstack/verify`,
 * `@objectstack/dogfood`) are reached through `link:`/workspace dependencies, so
 * their realpath is inside the *framework* workspace — a bare import from any of
 * them can only ever see packages installed in the framework's own
 * `node_modules`. Every package that lives OUTSIDE that workspace and is supplied
 * by the app being served, verified or tested — a cloud-private package such as
 * `@objectstack/organizations` or `@objectstack/service-ai-studio`, or anything a
 * customer installs into their own project — is therefore invisible to a bare
 * import, no matter what the host app declares in its `package.json`
 * (cloud#1013: `objectstack serve` could never load the enterprise multi-org
 * runtime, so every self-hosted walled-posture deployment hit the ADR-0093 D5
 * fail-fast and exited 1; framework#4700: `bootStack({ multiTenant: true })` told
 * apps to install a package they had already installed, and the dogfood
 * multi-org probes were constant-false).
 *
 * The fix is to resolve from the host app's root and import the resolved
 * absolute path. The importing package's own resolution stays as the fallback,
 * for the framework-owned packages it depends on and the host does not declare
 * — and since #10943 that fallback is the base the CALLER hands in
 * ({@link HostImporterOptions.fallbackImport}), because a fallback written here
 * resolved from `@objectstack/types` and could only ever see
 * `@objectstack/spec`. Same defect class as the paragraph above, one level up:
 * a bare import resolves against the module that CONTAINS it, and this module
 * is not the one doing the asking.
 *
 * Resolution failure is the ONLY thing that falls back. A package the host
 * resolves but that throws while it evaluates is a genuine crash and propagates
 * unchanged: re-importing it bare would replace the real cause with a
 * `MODULE_NOT_FOUND`, which every caller here classifies as "not installed" —
 * turning a broken package into a silent skip (or, on the organizations path,
 * into a fatal message telling the operator to install what is already there).
 *
 * ── #4719: the host's DECLARATION gates the lookup, not its resolvability ────
 *
 * "Resolve from the host app" was implemented as a CJS `createRequire` anchored
 * at the host's `package.json`, and **CJS resolution honours `NODE_PATH`**
 * (`Module.globalPaths`). The first thing a pnpm-generated bin shim does is
 *
 *     export NODE_PATH="<workspace>/node_modules/.pnpm/node_modules"
 *
 * and every `serve` / `dev` child process inherits it. Everything any package in
 * the workspace transitively depends on lives in that hoisted store, so
 * `hostRequire.resolve(pkg)` succeeded for packages the host app had never
 * declared — the answer depended on HOW THE PROCESS WAS LAUNCHED, not on the
 * app. Measured on cloud's `apps/objectos-ee`, which did not declare
 * `@objectstack/organizations`: `pnpm start` (through the shim) booted with the
 * organizations plugin mounted and ADR-0093 D5 silent, while
 * `node node_modules/@objectstack/cli/bin/run.js serve` (no shim, no NODE_PATH)
 * hit the D5 fail-fast and exited 1. Same app, same `package.json`, same
 * posture. D5's own message told operators to "declare it in the app's
 * package.json" — the one thing the CLI never checked.
 *
 * So the host lookup is now gated on the host's **declaration**: a package name
 * is looked up in the host's `node_modules` only when it appears in the host
 * `package.json` (see {@link HOST_DECLARATION_FIELDS}). Reachability through a
 * hoisted store or `NODE_PATH` is deliberately not accepted — it is precisely
 * the accident that made the contract unenforced. This is the "declared =
 * enforced" shape the rest of the repo uses (Prime Directive #10): the
 * declaration is a deliberate authoring act, machine-checkable at the moment of
 * boot, and independent of launcher, package manager and hoist layout.
 *
 * The two failures it separates were, until now, one indistinguishable
 * `MODULE_NOT_FOUND`, with opposite remedies:
 *
 *   - **undeclared** — the app never asked for this package. Remedy: declare it
 *     in the app's `package.json` and install.
 *   - **declared but unresolvable** — the app asked for it and the install is
 *     broken/pruned/unbuilt. Remedy: fix the install. Re-reading the
 *     `package.json` is wasted effort; the declaration is right there.
 *
 * #14041 adds a third, split OUT of the second: **declared, installed, and the
 * package publishes no entry Node can load** — a shape problem in the package
 * itself, which no install action can ever fix (the `HostImportFailureKind`
 * doc carries the split; the "#14041" section note below carries the finder
 * that makes an ESM-only publish load instead of failing at all).
 *
 * {@link hostImportFailureKind} exposes that classification to callers so their
 * fail-fast text can say which one it is (`packages/cli` ADR-0093 D5,
 * `packages/verify` `bootStack`, `packages/qa/dogfood`'s enterprise probe).
 */

import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isModuleNotFoundError } from './module-not-found.js';

/**
 * Imports a package as the host app would see it.
 *
 * `any` is the module namespace of a package this repo does not compile against
 * (it is not a dependency of the importing package at all) — every call site
 * reads an export off it dynamically, exactly as the bare `import()` it replaces
 * did.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type HostImporter = (pkg: string) => Promise<any>;

/**
 * The importing package's OWN dynamic import — write it literally, in the
 * calling module:
 *
 *     createHostImporter(hostRoot, { fallbackImport: (s) => import(s) })
 *
 * `any` for the same reason {@link HostImporter} uses it: the module namespace
 * belongs to a package this repo does not compile against.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type FallbackImport = (specifier: string) => Promise<any>;

/** Options for {@link createHostImporter}. */
export interface HostImporterOptions {
  /**
   * The resolution base for everything the host app does NOT declare — supplied
   * as the caller's own `import()` rather than as a URL string, because a
   * string base was MEASURED to be unimplementable without a regression. See
   * {@link createHostImporter}'s "why a function" note for both measurements.
   *
   * Omitted ⇒ the fallback resolves from `@objectstack/types`, which sees only
   * `@objectstack/types`'s own dependencies. That default is retained so an
   * out-of-tree caller cannot be broken by this parameter's arrival, and the
   * `undeclared` failure text names it explicitly so the gap reports itself
   * instead of being rediscovered.
   */
  fallbackImport?: FallbackImport;
}

/**
 * A `require` anchored at the **host app's** `package.json` — i.e. the project
 * `objectstack serve` was invoked in, or the app `bootStack` is verifying, whose
 * `node_modules` carries the packages it declares.
 *
 * @param hostRoot Directory holding the host app's `package.json` (default: the
 * process CWD, which is where the CLI reads `objectstack.config.ts` from too).
 */
export function createHostRequire(hostRoot: string = process.cwd()): NodeRequire {
  return createRequire(join(hostRoot, 'package.json'));
}

/**
 * The `package.json` fields whose KEYS count as a host-app declaration (#4719).
 *
 * All four are deliberate authoring acts in the app's own manifest that name the
 * package, which is the signal this gate is built on — not "is it reachable".
 * Why each is in:
 *
 * - `dependencies` — the obvious one: the app runs with it.
 * - `devDependencies` — the app being served / verified / dogfooded IS the
 *   project, not a library someone else consumes, so its dev deps are installed
 *   in exactly the environment this resolver runs in.
 * - `optionalDependencies` — npm/pnpm install them and tolerate an install
 *   failure. "Installed ⇒ declared" holds; and if it did NOT install, the
 *   declared-but-unresolvable branch says so precisely instead of pretending the
 *   app never asked.
 * - `peerDependencies` — an app is nobody's peer, so this is an unusual place to
 *   put an enterprise add-on; but it still NAMES the package on purpose, and
 *   `packages/cli`'s own edition gate (`serve`'s AI-service opt-in, #1597) has
 *   read all four since it was written. Accepting three here and four there
 *   would fork "declared" into two dialects for one question — the shape Prime
 *   Directive #12 exists to prevent. That gate now delegates to this list, so
 *   there is one owner and one answer.
 *
 * `bundleDependencies` is absent on purpose: it is an array of names that must
 * ALSO appear in `dependencies`, so it can never be the only declaration.
 */
export const HOST_DECLARATION_FIELDS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
] as const;

export type HostDeclarationField = (typeof HOST_DECLARATION_FIELDS)[number];

/** What the host app's `package.json` says about one package name. */
export interface HostDeclaration {
  /** Bare package name the specifier belongs to (subpath stripped). */
  packageName: string;
  /** Directory whose `package.json` was consulted. */
  hostRoot: string;
  /** True when {@link packageName} is a key of one of {@link HOST_DECLARATION_FIELDS}. */
  declared: boolean;
  /** Which field carried it (first match, in {@link HOST_DECLARATION_FIELDS} order). */
  field?: HostDeclarationField;
  /** The version range AS WRITTEN — `^1.2.3`, `workspace:*`, `npm:@acme/x@1`, `link:../x`. */
  specifier?: string;
  /** True when `hostRoot` has no readable / parseable `package.json` at all. */
  manifestMissing?: boolean;
}

/**
 * The package a bare specifier belongs to, or `undefined` when the specifier is
 * not a bare package name at all (a relative/absolute path, a `file:`/`data:`
 * URL, or a `node:`-prefixed builtin). Those bypass the declaration gate: they
 * are not things a `package.json` can declare.
 *
 * Subpaths are stripped, so `@objectstack/platform-objects/plugin` is declared
 * by `"@objectstack/platform-objects"`, which is the only key that can exist.
 * Scoped names keep both segments.
 *
 * Alias dependencies need no special case, and that is the point: with
 * `"foo": "npm:bar@1"` the importable specifier is `foo` and the manifest key is
 * `foo`, so keying on the KEY (never the value) is exactly right — `import('bar')`
 * correctly reads as undeclared unless `bar` is itself a key. Same for
 * `workspace:` / `link:` / `file:` specifiers: the key is the name, the value is
 * the package manager's business.
 */
export function packageNameFromSpecifier(specifier: string): string | undefined {
  if (!specifier || specifier.startsWith('.') || specifier.startsWith('/')) return undefined;
  // A URL-ish or protocol-prefixed specifier (`node:fs`, `file:///…`, `data:…`).
  if (/^[a-z][a-z0-9+.-]*:/i.test(specifier)) return undefined;
  const segments = specifier.split('/');
  if (specifier.startsWith('@')) {
    if (segments.length < 2 || !segments[0] || !segments[1]) return undefined;
    return `${segments[0]}/${segments[1]}`;
  }
  return segments[0] || undefined;
}

/**
 * Read what the host app's `package.json` declares about `specifier`.
 *
 * Deliberately a plain manifest READ, never a resolution attempt: resolvability
 * is the property #4719 proved unreliable (it moved with `NODE_PATH` and the
 * hoist layout), while the manifest is the same fact in every launcher.
 */
export function readHostDeclaration(
  specifier: string,
  hostRoot: string = process.cwd(),
): HostDeclaration {
  const packageName = packageNameFromSpecifier(specifier) ?? specifier;
  const base: HostDeclaration = { packageName, hostRoot, declared: false };

  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(readFileSync(join(hostRoot, 'package.json'), 'utf8')) as Record<
      string,
      unknown
    >;
  } catch {
    // No manifest ⇒ nothing is declared. Recorded rather than swallowed so the
    // failure text can say "there is no package.json here" instead of the
    // misleading "you did not declare it".
    return { ...base, manifestMissing: true };
  }

  for (const field of HOST_DECLARATION_FIELDS) {
    const entries = manifest[field];
    if (!entries || typeof entries !== 'object') continue;
    const specifierValue = (entries as Record<string, unknown>)[packageName];
    if (specifierValue === undefined) continue;
    return { ...base, declared: true, field, specifier: String(specifierValue) };
  }
  return base;
}

/** Convenience predicate over {@link readHostDeclaration}. */
export function isDeclaredByHost(specifier: string, hostRoot?: string): boolean {
  return readHostDeclaration(specifier, hostRoot).declared;
}

/**
 * Why a {@link HostImporter} could not produce a module.
 *
 * - `undeclared` — the host app's `package.json` never names the package, and
 *   the importing framework package cannot supply it either. Remedy: DECLARE it
 *   in the app and install.
 * - `declared-unresolvable` — the app declares it and it still would not
 *   resolve. Remedy: fix the INSTALL. Re-reading the manifest is wasted effort.
 * - `declared-no-loadable-entry` (#14041) — the app declares it, the install
 *   delivered it, and the package's own `exports` names NO entry Node can load
 *   for the requested subpath — no `require`-condition target (which is why the
 *   CJS resolution refused) and no `import`-condition one for the fallback
 *   either (a `types`-only or `browser`-only publish, or a subpath the map
 *   never names). Remedy: change the PACKAGE — neither the app's manifest nor
 *   its install can ever fix this, which is exactly why it must not share the
 *   `declared-unresolvable` INSTALL wording.
 *
 * An evaluation crash is none of these: it propagates untouched and carries no
 * kind.
 */
export type HostImportFailureKind =
  | 'undeclared'
  | 'declared-unresolvable'
  | 'declared-no-loadable-entry';

/**
 * Property carrying {@link HostImportFailureKind} on a thrown error.
 *
 * A string property, read by {@link hostImportFailureKind} — never `instanceof`.
 * `serve` loads plugins through this importer, so CLI and package can hold
 * different module instances of anything class-shaped; the #4818 comment in
 * `serve.ts` names that trap explicitly.
 */
export const HOST_IMPORT_FAILURE_KIND = 'objectstackHostImportFailureKind';

/** The classification on an error thrown by a {@link HostImporter}, if any. */
export function hostImportFailureKind(err: unknown): HostImportFailureKind | undefined {
  const kind = (err as Record<string, unknown> | null | undefined)?.[HOST_IMPORT_FAILURE_KIND];
  return kind === 'undeclared' ||
    kind === 'declared-unresolvable' ||
    kind === 'declared-no-loadable-entry'
    ? kind
    : undefined;
}

function hostImportError(
  kind: HostImportFailureKind,
  message: string,
  cause: unknown,
): Error {
  // `cause` is assigned rather than passed to the constructor: this package
  // compiles against a lib without the ES2022 `ErrorOptions` overload.
  const err = new Error(message);
  // Every caller classifies "missing vs crashed" through
  // `isModuleNotFoundError`; both of these ARE the missing case, just with
  // different remedies, so they must keep answering true to it.
  return Object.assign(err, {
    cause,
    code: 'MODULE_NOT_FOUND',
    [HOST_IMPORT_FAILURE_KIND]: kind,
  });
}

/**
 * @param callerBaseSupplied Did the caller state its own resolution base
 * ({@link HostImporterOptions.fallbackImport})? When it did not, the fallback
 * ran from `@objectstack/types`, which sees only `@objectstack/spec` — so the
 * absence being reported may be an artefact of the missing base rather than a
 * real one. #10943 kept that default for out-of-tree callers; saying so here is
 * what stops it being silent, because the alternative is a reader re-deriving
 * the whole measurement from a `MODULE_NOT_FOUND` that names nothing.
 */
function undeclaredMessage(
  declaration: HostDeclaration,
  cause: unknown,
  callerBaseSupplied: boolean,
): string {
  const { packageName, hostRoot, manifestMissing } = declaration;
  const detail = cause instanceof Error ? cause.message : String(cause);
  const baseNote = callerBaseSupplied
    ? ''
    : '\n  (the caller did not pass `fallbackImport`, so that fallback resolved from\n' +
      "  @objectstack/types, which can see only its own dependencies — a caller that\n" +
      '  needs its own resolution passes `{ fallbackImport: (s) => import(s) }`, #10943)';
  return (
    `Cannot find package '${packageName}': the host app does not declare it.\n` +
    `  host app: ${hostRoot}\n` +
    (manifestMissing
      ? '  no readable package.json was found there — nothing can be declared\n'
      : `  checked: ${HOST_DECLARATION_FIELDS.join(', ')}\n`) +
    `\n  Declare it in that app's package.json and install it, e.g.\n` +
    `      cd ${hostRoot} && pnpm add ${packageName}\n` +
    '\n  Being merely REACHABLE is not enough and is rejected on purpose (#4719):\n' +
    '  a package hoisted into a workspace store — which is what NODE_PATH points\n' +
    "  at in every pnpm bin shim — used to resolve here regardless of the app's\n" +
    '  package.json, so the same app booted or refused depending on how the\n' +
    '  process was launched. The declaration is the contract.\n' +
    `  (fallback resolution also failed: ${detail})${baseNote}`
  );
}

function unresolvableMessage(declaration: HostDeclaration, cause: unknown): string {
  const { packageName, hostRoot, field, specifier } = declaration;
  const detail = cause instanceof Error ? cause.message : String(cause);
  return (
    `Cannot find module '${packageName}': the host app DECLARES it ` +
    `(${field}: ${JSON.stringify(specifier)}) but it could not be resolved.\n` +
    `  host app: ${hostRoot}\n` +
    '\n  This is an INSTALL problem, not a declaration problem — the declaration is\n' +
    '  already there, so re-reading the package.json will not help. Check:\n' +
    `    • dependencies never installed, or installed before the declaration was added → run \`pnpm install\` in ${hostRoot}\n` +
    '    • a production prune / filtered deploy dropped it (devDependencies and\n' +
    '      optionalDependencies go first)\n' +
    '    • it IS installed but its "main"/"exports" points at a dist that was never built\n' +
    `  (resolver: ${detail})`
  );
}

/**
 * ── #13330: the DECLARED leg must resolve with ESM semantics ─────────────────
 *
 * `hostRequire.resolve(pkg)` is a **CommonJS** resolution, and CJS resolution
 * answers the `require` condition. Every `tsup` dual build in this repo — and
 * essentially every dual build anywhere — publishes
 *
 *     "exports": { ".": { "import": "./dist/index.js", "require": "./dist/index.cjs" } }
 *
 * so that resolve returns `dist/index.cjs`, and `import()`ing a `.cjs` file
 * evaluates the package's **CommonJS** build. Everything that build then
 * `require`s is CJS too, all the way down.
 *
 * The importer's callers are ESM (`packages/cli` is `"type": "module"`), so
 * anything they load through their OWN import chain is the ESM build of the
 * same package. Loading a package here therefore produced a SECOND instance of
 * every module it shares with the caller — with its own module-scope state.
 *
 * That is not a theoretical difference. `serve` loads a cluster driver through
 * this leg; the driver's whole job is the side effect
 * `registerClusterDriver('redis', …)` against `@objectstack/service-cluster`'s
 * module-scope registry. Measured on the EE image, in one process:
 *
 *     ESM instance: redis REGISTERED     <- after a bare import() of the driver
 *     CJS instance: NOT registered       <- after this leg loaded the driver
 *
 * The Runtime reads the ESM instance, so `OS_CLUSTER_DRIVER=redis` on a
 * three-replica deployment died at `defineCluster()` with `Cluster driver
 * "redis" is not registered` while the package was installed, declared and
 * resolvable. Any module-scope registry crossing this seam has the same defect;
 * the cluster driver is simply the one that shipped.
 *
 * The fix is to select the entry the `import` condition names. There is no
 * flagless Node API that resolves a bare specifier against an arbitrary parent
 * (`import.meta.resolve`'s parent argument is ignored without
 * `--experimental-import-meta-resolve` — measured, see `createHostImporter`),
 * so the host-anchored ANSWER still comes from the CJS resolver, and only the
 * CONDITION is re-decided here: the CJS-resolved file locates the package on
 * disk, and the `import` entry of THAT package is what gets imported.
 *
 * Deliberately narrow at the RESOLUTION level — no load that works today
 * resolves differently unless the package itself publishes a valid, existing
 * import-condition target:
 *
 *   - a package with no `exports` map is untouched — CJS resolution already
 *     returned `main`, which is the only entry it publishes;
 *   - a package whose `exports` names no import-condition target (CJS-only) is
 *     untouched, and so is one whose two conditions name the same file;
 *   - anything unreadable, unresolvable or absent on disk falls back to the
 *     CJS-resolved path, i.e. to exactly the pre-#13330 behaviour.
 *
 * That narrowness does NOT extend to EVALUATION: every fallback above keys on
 * the `import` target being absent, unreadable or escaping the package root,
 * so none of them catches an `import` target that is present and broken. A
 * dual-published package whose `import` build throws while its `require` build
 * works used to mask that break by silently loading the CJS build; it now
 * surfaces it. Surfacing a broken published build is arguably the correct
 * reading, but it is a behaviour change, not a no-op.
 *
 * A residual split is still possible above this seam — an app and a framework
 * package holding two PHYSICAL copies of the same package are two instances in
 * any module system, and no resolver condition can merge them. That case is not
 * silent any more: `serve` reads the registry after the load and reports it
 * (`packages/cli/src/commands/serve.ts`, the cluster block).
 */

/**
 * The conditions Node matches on an `import()` here.
 *
 * MEMBERSHIP, not priority: Node walks an exports object's KEYS in insertion
 * order and takes the first that names an active condition, so the manifest
 * decides precedence and this set only decides eligibility. `require` is absent
 * on purpose — selecting it is the defect above.
 */
const ESM_IMPORT_CONDITIONS: ReadonlySet<string> = new Set([
  'node-addons',
  'node',
  'import',
  'default',
]);

/**
 * The conditions a CommonJS `require()` matches — what `hostRequire.resolve`
 * itself answers. Used by the #14041 failure-kind split ONLY as a manifest
 * READ, never as a second resolution: when the CJS resolver has already
 * thrown, "does the map name a `require`-condition target at all?" is what
 * separates a broken install (it names one, the files are missing) from a
 * package that publishes no CommonJS entry in the first place.
 */
const CJS_REQUIRE_CONDITIONS: ReadonlySet<string> = new Set([
  'node-addons',
  'node',
  'require',
  'default',
]);

/**
 * Pick a target from one `exports` node under the given active conditions
 * (membership, not priority — see {@link ESM_IMPORT_CONDITIONS}).
 *
 * A string is a target; an array is a fallback list (first resolvable wins);
 * `null` blocks the subpath; an object is a condition map. Nesting is arbitrary
 * (`{ import: { types: …, default: … } }` is the shape `tsup` emits).
 */
function selectConditionTarget(node: unknown, conditions: ReadonlySet<string>): string | undefined {
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) {
    for (const alternative of node) {
      const hit = selectConditionTarget(alternative, conditions);
      if (hit !== undefined) return hit;
    }
    return undefined;
  }
  if (node === null || typeof node !== 'object') return undefined;
  for (const entry of Object.entries(node as Record<string, unknown>)) {
    if (!conditions.has(entry[0])) continue;
    const hit = selectConditionTarget(entry[1], conditions);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

/**
 * Resolve one subpath (`.`, `./node`, `./forms/x`) of an `exports` field to the
 * relative target its import condition names.
 *
 * A map is recognised by its KEYS: exports whose keys all begin with `.` is a
 * subpath map, anything else is the root-condition sugar for `"."` — the same
 * test Node applies, and the reason `{ "import": …, "require": … }` needs no
 * special case here.
 */
function resolveExportsSubpath(
  exportsField: unknown,
  subpath: string,
  conditions: ReadonlySet<string> = ESM_IMPORT_CONDITIONS,
): string | undefined {
  if (exportsField === undefined) return undefined;

  const keys =
    typeof exportsField === 'object' && exportsField !== null && !Array.isArray(exportsField)
      ? Object.keys(exportsField as Record<string, unknown>)
      : undefined;
  const isSubpathMap =
    keys !== undefined && keys.length > 0 && keys.every((key) => key === '.' || key.indexOf('./') === 0);

  if (!isSubpathMap) {
    return subpath === '.' ? selectConditionTarget(exportsField, conditions) : undefined;
  }

  const map = exportsField as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(map, subpath)) {
    return selectConditionTarget(map[subpath], conditions);
  }

  // Pattern keys (`"./*": "./dist/*.js"`). Node takes the key with the longest
  // static prefix, breaking ties on the longest suffix, and substitutes the
  // matched span into the target's own `*`.
  let best: { prefix: string; suffix: string; target: unknown } | undefined;
  for (const entry of Object.entries(map)) {
    const star = entry[0].indexOf('*');
    if (star < 0 || entry[0].indexOf('*', star + 1) >= 0) continue;
    const prefix = entry[0].slice(0, star);
    const suffix = entry[0].slice(star + 1);
    if (subpath.indexOf(prefix) !== 0) continue;
    if (suffix !== '' && subpath.slice(subpath.length - suffix.length) !== suffix) continue;
    if (subpath.length < prefix.length + suffix.length) continue;
    if (
      best !== undefined &&
      (best.prefix.length > prefix.length ||
        (best.prefix.length === prefix.length && best.suffix.length >= suffix.length))
    ) {
      continue;
    }
    best = { prefix, suffix, target: entry[1] };
  }
  if (best === undefined) return undefined;
  const matched = subpath.slice(best.prefix.length, subpath.length - best.suffix.length);
  const target = selectConditionTarget(best.target, conditions);
  return target === undefined ? undefined : target.split('*').join(matched);
}

/** The `exports` subpath a specifier addresses (`.`, `./plugin`, `./deep/x`). */
function exportsSubpathOf(specifier: string, packageName: string): string {
  return specifier === packageName ? '.' : `.${specifier.slice(packageName.length)}`;
}

/**
 * The directory of the package named `packageName` that owns `resolvedFile`.
 *
 * Walked up from the resolved entry rather than computed from the specifier,
 * because the resolver's answer is a REALPATH: under pnpm that is inside
 * `.pnpm/<pkg>@<version>/node_modules/<pkg>`, which is exactly the directory
 * whose `node_modules` the package's own transitive imports resolve against —
 * and exactly what makes one physical copy shared between the app and the
 * framework.
 */
function packageRootOf(resolvedFile: string, packageName: string): string | undefined {
  let dir = dirname(resolvedFile);
  // Bounded on purpose: a package root is a few segments above its entry, and
  // an unbounded walk on a broken layout would stat every ancestor up to `/`.
  for (let hop = 0; hop < 64; hop += 1) {
    try {
      const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
        name?: unknown;
      };
      // A NESTED manifest — the `{"type":"commonjs"}` marker a dual build drops
      // in `dist/` — carries no name, so it is walked THROUGH, not stopped at.
      if (manifest.name === packageName) return dir;
    } catch {
      // Not a manifest, or not readable. Keep walking.
    }
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
  return undefined;
}

/**
 * The file the `import` condition names for `specifier`, or `undefined` when
 * this seam has nothing to change — see the narrowness list in the #13330 note.
 *
 * @param cjsResolved What `hostRequire.resolve(specifier)` answered. It is the
 * host-anchored part of the answer and is never second-guessed here; only the
 * CONDITION is re-decided.
 */
function esmEntryForDeclared(
  specifier: string,
  packageName: string,
  cjsResolved: string,
): string | undefined {
  const root = packageRootOf(cjsResolved, packageName);
  if (root === undefined) return undefined;

  let exportsField: unknown;
  try {
    exportsField = (
      JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { exports?: unknown }
    ).exports;
  } catch {
    return undefined;
  }
  // No `exports` map ⇒ nothing to choose between: `main` is the only entry the
  // package publishes and CJS resolution already returned it.
  if (exportsField === undefined || exportsField === null) return undefined;

  const subpath = exportsSubpathOf(specifier, packageName);
  const target = resolveExportsSubpath(exportsField, subpath);
  if (typeof target !== 'string' || target.indexOf('./') !== 0) return undefined;

  const entry = resolve(root, target);
  // Node refuses an exports target that escapes its package; so does this.
  if (entry.indexOf(root + sep) !== 0) return undefined;
  return existsSync(entry) ? entry : undefined;
}

/**
 * ── #14041: an ESM-only package needs a finder the CJS resolver is not ───────
 *
 * The #13330 note above re-decides the CONDITION for a package the CJS
 * resolver already LOCATED. A package publishing only an `import` condition —
 * `{"exports": {".": {"import": "./dist/index.js"}}}`, ordinary outside this
 * workspace — never gets that far: `hostRequire.resolve` throws
 * `ERR_PACKAGE_PATH_NOT_EXPORTED`, and the declared leg classified EVERY
 * resolver throw as `declared-unresolvable` — an INSTALL-problem message about
 * an install that is fine, prescribing remedies (`pnpm install`, un-prune,
 * rebuild) none of which can ever help.
 *
 * The fallback finder is a `node_modules` lookup anchored at `hostRoot`, and
 * it is deliberately STRICTLY TIGHTER than the CJS resolution it backs up:
 *
 *   - ONE directory — `<hostRoot>/node_modules/<name>` — the single place a
 *     dependency the host declares and installs must physically appear;
 *   - no `NODE_PATH` (the #4719 hole; honouring it here would reopen the
 *     declaration gate from the fallback side);
 *   - no walk above `hostRoot` (CJS resolution climbs every parent's
 *     `node_modules`; a package that exists only up there is someone else's);
 *   - no bare `require`/`import` of the specifier (a second resolver would
 *     re-import every looseness one call at a time);
 *   - Node's invalid-segment refusal, mirrored BEFORE exports resolution
 *     ({@link hasInvalidExportsSubpathSegments}): a subpath carrying `''`,
 *     `.`, `..` or `node_modules` segments is refused exactly as both of
 *     Node's resolvers refuse it — the one validation the specifier has NOT
 *     already passed by the time it reaches this catch (#14271 review).
 *
 * `import.meta.resolve` with a parent URL is NOT the mechanism, on the same
 * measurement the #10943 note below records: without
 * `--experimental-import-meta-resolve` the parent argument is SILENTLY
 * IGNORED, so it answers from the WRONG base with full confidence — the exact
 * failure class this card removes.
 *
 * It fires ONLY inside `hostRequire.resolve`'s catch — a path that was a hard
 * failure before — so no currently-succeeding load can change behaviour.
 *
 * When even this finder cannot produce an entry, the failure KIND is split on
 * one criterion: **can any install action ever help?**
 *
 *   - the package is not in the host's `node_modules`, or its manifest NAMES a
 *     runtime target whose file is missing (a dist never built, a partial
 *     publish) → `declared-unresolvable`, the existing INSTALL wording,
 *     unchanged — it is right for both;
 *   - the package is installed and its manifest names NO runtime entry for the
 *     requested subpath under either the `require` or the `import` conditions
 *     (`types`-only, `browser`-only, an unexported subpath) →
 *     `declared-no-loadable-entry`, a message about the PACKAGE's own shape —
 *     no edit to the app and no install action can change what the package
 *     publishes.
 */
type DeclaredCjsResolveFallback =
  /** Not present in the host's own `node_modules` — the install really is the problem. */
  | { outcome: 'absent' }
  /** Rescued: the `import`-condition entry to load. */
  | { outcome: 'entry'; entry: string }
  /** Present, and its manifest names a runtime target — the FILES are the problem. */
  | { outcome: 'install-broken' }
  /** Present, and its manifest names nothing loadable — the PACKAGE is the problem. */
  | { outcome: 'no-loadable-entry'; packageDir: string }
  /**
   * The SPECIFIER is the problem: its subpath carries segments Node's own
   * resolvers refuse (see {@link hasInvalidExportsSubpathSegments}). Never
   * rescued and never re-worded — it keeps exactly the hard failure and the
   * `declared-unresolvable` kind these specifiers get on the CJS path today.
   */
  | { outcome: 'invalid-specifier' };

/**
 * Mirror of Node's `PACKAGE_TARGET_RESOLVE` invalid-segment refusal, applied
 * to the requested subpath BEFORE any exports resolution in the fallback
 * (#14271 contract review).
 *
 * Both of Node's resolvers refuse an exports subpath whose segments include
 * `''`, `.`, `..` or `node_modules` (case-insensitive) —
 * `ERR_INVALID_MODULE_SPECIFIER`, or `ERR_PACKAGE_PATH_NOT_EXPORTED` when an
 * import-only condition map refuses first. On the resolve-SUCCEEDED path
 * (#13330) the specifier has therefore already been validated by the real
 * resolver before the exports walk here ever sees it. Inside the fallback's
 * catch it has NOT: without this mirror, a pattern key (`./deep/*`) would
 * substitute a traversal span (`../../secret/hidden`) into its target and
 * resolve a NON-EXPORTED file inside the package — the byte-containment check
 * on the resolved entry permits any `..` traversal that lands back inside the
 * package root, by design (it guards escape, not encapsulation). Measured on
 * Node v22.22.2: `require.resolve` of such a specifier throws on both an
 * import-only and a dual-published pattern map, so refusing here keeps the
 * fallback strictly tighter than the CJS resolution it backs up on the
 * VALIDATION axis, exactly as it is on the location axes.
 */
function hasInvalidExportsSubpathSegments(subpath: string): boolean {
  if (subpath === '.') return false;
  // `exportsSubpathOf` yields `./…`; validate every segment after that prefix.
  return subpath
    .slice(2)
    .split(/[/\\]/)
    .some((raw) => {
      const segment = raw.toLowerCase();
      return segment === '' || segment === '.' || segment === '..' || segment === 'node_modules';
    });
}

/**
 * The one directory the fallback finder consults, verified to hold the
 * declared package (a `package.json` whose `name` matches) and then
 * realpath'd — under pnpm the link target is
 * `.pnpm/<pkg>@<version>/node_modules/<pkg>`, the directory the package's own
 * transitive imports resolve against, exactly as the CJS resolver's realpath
 * answer behaves on the succeeding path.
 */
function hostInstalledPackageDir(packageName: string, hostRoot: string): string | undefined {
  const linked = join(hostRoot, 'node_modules', ...packageName.split('/'));
  try {
    const manifest = JSON.parse(readFileSync(join(linked, 'package.json'), 'utf8')) as {
      name?: unknown;
    };
    if (manifest.name !== packageName) return undefined;
  } catch {
    return undefined;
  }
  try {
    return realpathSync(linked);
  } catch {
    // The manifest read above already succeeded through this path; an exotic
    // realpath failure does not un-install the package.
    return linked;
  }
}

/** The #14041 fallback: see the section note above for the shape and the split. */
function declaredCjsResolveFallback(
  specifier: string,
  packageName: string,
  hostRoot: string,
): DeclaredCjsResolveFallback {
  const packageDir = hostInstalledPackageDir(packageName, hostRoot);
  if (packageDir === undefined) return { outcome: 'absent' };

  let exportsField: unknown;
  try {
    exportsField = (
      JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')) as { exports?: unknown }
    ).exports;
  } catch {
    return { outcome: 'absent' };
  }
  // No `exports` map ⇒ CJS resolution already tried everything such a package
  // publishes (`main`, the index files) and still threw: missing files.
  if (exportsField === undefined || exportsField === null) return { outcome: 'install-broken' };

  const subpath = exportsSubpathOf(specifier, packageName);
  // Refused BEFORE exports resolution — the specifier reaches this walk
  // unvalidated by any real resolver, unlike the #13330 path (see
  // hasInvalidExportsSubpathSegments).
  if (hasInvalidExportsSubpathSegments(subpath)) return { outcome: 'invalid-specifier' };

  const importTarget = resolveExportsSubpath(exportsField, subpath, ESM_IMPORT_CONDITIONS);
  if (typeof importTarget === 'string' && importTarget.indexOf('./') === 0) {
    const entry = resolve(packageDir, importTarget);
    // Node refuses an exports target that escapes its package; so does this.
    if (entry.indexOf(packageDir + sep) === 0 && existsSync(entry)) {
      return { outcome: 'entry', entry };
    }
    // The manifest names an `import` target and the file is not there — a
    // dist never built or a partial publish. An install/build problem, with
    // the existing wording's remedies intact.
    return { outcome: 'install-broken' };
  }

  const requireTarget = resolveExportsSubpath(exportsField, subpath, CJS_REQUIRE_CONDITIONS);
  if (typeof requireTarget === 'string' && requireTarget.indexOf('./') === 0) {
    // The package DOES publish a CommonJS entry for this subpath; the CJS
    // resolver threw over the files behind it, not over the shape.
    return { outcome: 'install-broken' };
  }

  return { outcome: 'no-loadable-entry', packageDir };
}

function noLoadableEntryMessage(
  declaration: HostDeclaration,
  packageDir: string,
  subpath: string,
  cause: unknown,
): string {
  const { packageName, hostRoot, field, specifier } = declaration;
  const detail = cause instanceof Error ? cause.message : String(cause);
  const subpathNote = subpath === '.' ? 'its main entry (".")' : `the subpath '${subpath}'`;
  return (
    `Cannot load module '${packageName}': the host app DECLARES it ` +
    `(${field}: ${JSON.stringify(specifier)}) and it IS installed, but the package ` +
    'publishes no entry that Node can load.\n' +
    `  host app: ${hostRoot}\n` +
    `  installed at: ${packageDir}\n` +
    "\n  This is a problem with the PACKAGE's own published shape, not with the app or\n" +
    '  its install — the declaration is right and the package is on disk, so neither\n' +
    '  re-reading package.json nor re-running `pnpm install` can change anything.\n' +
    '  Measured from its manifest:\n' +
    `    • its "exports" map names no \`require\`-condition entry for ${subpathNote},\n` +
    '      so a CommonJS resolution cannot see it at all\n' +
    '    • and no `import`-condition entry either, so there is nothing for the ESM\n' +
    '      fallback to load\n' +
    '  The remedy lives in the package: it must publish a runtime entry for this\n' +
    '  subpath (an `import` condition suffices here; a dual build adds `require`).\n' +
    '  A publish carrying only `types` / `browser`-style conditions cannot be loaded\n' +
    '  by a Node host at all.\n' +
    `  (resolver: ${detail})`
  );
}

/**
 * Build an importer that loads a package **as the host app declares it**, and
 * otherwise falls back to the importing package's own resolution.
 *
 * Order of operations, and why (#4719):
 *
 * 1. The host `package.json` is READ. Only a declared name is looked up in the
 *    host's `node_modules`. An undeclared name never reaches the host resolver,
 *    so no amount of `NODE_PATH` / hoisting can make it appear to be the app's.
 * 2. Declared but unresolvable is reported AS SUCH — the app asked for it and
 *    the install is broken. It is not retried bare: falling back there would
 *    reintroduce exactly the "some other package happens to supply it" accident
 *    this gate closes, and would report an install problem as an absence.
 * 3. Undeclared falls back to the CALLER's own resolution, which is what keeps
 *    every framework-owned load working (`serve`'s plugin-auth / service-i18n
 *    path, `bootStack`'s service plugins). Bare `import()` is ESM, and ESM does
 *    not honour `NODE_PATH`, so the fallback cannot re-open the hole either.
 *    Only when that fails as module-not-found does the undeclared error
 *    surface; a package that RESOLVES and then throws while evaluating is a
 *    genuine crash and propagates untouched, as before.
 *
 * ── The caller supplies that base, and why it is a FUNCTION (#10943) ─────────
 *
 * Step 3 said "the importing package's own resolution" long before anything
 * made it true. The fallback was a bare `import()` written HERE, and ESM
 * resolves a bare specifier against the module containing the call — so it
 * resolved from `@objectstack/types`, which under a pnpm-isolated layout can
 * see only `@objectstack/types`'s own dependencies. Measured on `main` from an
 * app declaring nothing, `@objectstack/plugin-auth`, `@objectstack/plugin-audit`
 * and `chalk` all resolve from `packages/cli` and all failed through this
 * helper; `@objectstack/spec` — the one dependency this package declares — was
 * the only name that came back OK, which is the whole pattern. Under a hoisted
 * npm/yarn layout the same fallback usually DOES find the caller's
 * dependencies, so the claim was green in some installs and absent in others:
 * the layout-dependence class cloud#1013 and #10645 exist to close, one level
 * up. A declared contract the implementation does not keep is the thing this
 * repo fixes at the producer (Prime Directive #12), so the mechanism moved
 * rather than the sentence.
 *
 * The base arrives as the caller's own `import()` and NOT as a `parentURL` /
 * `import.meta.url` string. Both string spellings were measured on Node
 * v22.22.2 and both are wrong:
 *
 *   - `import.meta.resolve(specifier, parentURL)` — the parent argument is
 *     SILENTLY IGNORED without `--experimental-import-meta-resolve`. Measured:
 *     resolving `@objectstack/plugin-auth` against a `packages/types` parent
 *     returned `packages/cli/node_modules/...`, i.e. the caller's own answer,
 *     byte-identical to passing no parent at all. It would have compiled, run,
 *     and pinned green while ignoring the base — a phantom fix of exactly the
 *     kind this card is about.
 *   - `createRequire(parentURL).resolve(specifier)` — CJS resolution, which
 *     honours `NODE_PATH`. Measured against a store reachable only through
 *     `NODE_PATH`: the CJS resolve found it (with and without the `paths`
 *     option, since GLOBAL_FOLDERS are always appended) while the ESM bare
 *     `import()` did not. That is #4719's hole re-opened on the fallback path,
 *     and it would have falsified the "ESM does not honour NODE_PATH" sentence
 *     three lines above.
 *
 * A function written in the calling module is the only spelling that uses
 * Node's real ESM resolver anchored where the caller actually lives: no flag,
 * no `NODE_PATH`, no second resolution algorithm to drift from the first.
 *
 * @param hostRoot Directory holding the host app's `package.json` (default: the
 * process CWD, which is where the CLI reads `objectstack.config.ts` from too).
 * Note this used to take a pre-built `NodeRequire`; it needs the ROOT now,
 * because a `NodeRequire` cannot be asked where it was anchored and the manifest
 * has to be read from there.
 * @param options {@link HostImporterOptions.fallbackImport} carries the caller's
 * resolution base. Omitting it keeps the pre-#10943 behaviour (this package's
 * own resolution) so no out-of-tree caller changes under its feet.
 */
export function createHostImporter(
  hostRoot: string = process.cwd(),
  options: HostImporterOptions = {},
): HostImporter {
  const hostRequire = createHostRequire(hostRoot);
  const { fallbackImport } = options;
  const importAsCaller: FallbackImport =
    fallbackImport ?? ((specifier) => import(/* webpackIgnore: true */ specifier));
  return async (pkg: string): Promise<any> => {
    // Not a bare package name (a path, a URL, a `node:` builtin) — nothing a
    // manifest could declare. Hand it to the normal resolver untouched.
    //
    // ⚠️ Deliberately NOT re-based onto `fallbackImport` (#10943). Every
    // base-INDEPENDENT spelling here — `file://`, `node:`, `data:`, an absolute
    // path — means the same module whoever imports it, so the base is not a
    // question they can even ask. The one spelling it WOULD move is a RELATIVE
    // one, and where that should resolve from is an open policy question owned
    // by #10944 (`serve` refuses a relative `plugins: [...]` entry rather than
    // silently re-basing it) — with a measured consumer count of zero here:
    // `serve` handles non-package specifiers before this helper is reached, and
    // `bootStack` / the dogfood probe pass package names only. Answering half
    // of another card's undecided question, for nobody, is not a repair.
    if (packageNameFromSpecifier(pkg) === undefined) {
      return import(/* webpackIgnore: true */ pkg);
    }

    const declaration = readHostDeclaration(pkg, hostRoot);

    if (declaration.declared) {
      let resolved: string;
      try {
        resolved = hostRequire.resolve(pkg);
      } catch (cause) {
        // #14041: the CJS resolver cannot see an ESM-only publish at all. Try
        // the strictly-tighter hostRoot node_modules finder before concluding
        // anything — this catch was a hard failure before, so the fallback is
        // strictly additive — and when it cannot help either, report the kind
        // the walk actually measured (see the #14041 section note).
        const fallback = declaredCjsResolveFallback(pkg, declaration.packageName, hostRoot);
        if (fallback.outcome === 'entry') {
          return import(pathToFileURL(fallback.entry).href);
        }
        if (fallback.outcome === 'no-loadable-entry') {
          throw hostImportError(
            'declared-no-loadable-entry',
            noLoadableEntryMessage(
              declaration,
              fallback.packageDir,
              exportsSubpathOf(pkg, declaration.packageName),
              cause,
            ),
            cause,
          );
        }
        throw hostImportError(
          'declared-unresolvable',
          unresolvableMessage(declaration, cause),
          cause,
        );
      }
      // #13330: re-decide the CONDITION, never the host anchor. `resolved`
      // stays the authority on WHERE the package is; this asks that package
      // which entry an `import()` gets, so the caller's ESM chain and this
      // load share one instance of everything the package brings with it.
      const entry = esmEntryForDeclared(pkg, declaration.packageName, resolved) ?? resolved;
      return import(pathToFileURL(entry).href);
    }

    try {
      return await importAsCaller(pkg);
    } catch (cause) {
      // A package that resolved and then exploded is a crash, not an absence.
      if (!isModuleNotFoundError(cause)) throw cause;
      throw hostImportError(
        'undeclared',
        undeclaredMessage(declaration, cause, fallbackImport !== undefined),
        cause,
      );
    }
  };
}
