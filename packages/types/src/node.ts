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
 * by the app being served, verified or tested — a HOST-SUPPLIED package such as
 * `@objectstack/organizations` or the cloud-private `@objectstack/service-ai-studio`,
 * or anything a customer installs into their own project — is therefore invisible
 * to a bare import, no matter what the host app declares in its `package.json`
 * (cloud#1013: `objectstack serve` could never load the multi-org
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
 *   ⚠️ One sub-case under this kind is NOT an install problem and does not say
 *   it is (#15045): a `link:` / `file:` (or git / tarball) declaration names a
 *   LOCATION rather than a package, so the fallback cannot verify the directory
 *   by NAME. #17046 gave it the second axis — the declared path — so a
 *   correctly linked package now LOADS; what still lands here is the residue
 *   where neither axis ties the directory to the declaration, refused with
 *   {@link unverifiableLocationMessage}'s wording. The KIND is shared
 *   deliberately — the refusal, the `MODULE_NOT_FOUND` code and every consumer
 *   branch are unchanged; minting a fourth kind would widen a published union
 *   for a wording fix. ⛔ A consumer that re-words this kind LOCALLY instead of
 *   deferring to `err.message` therefore still prints its own install remedy
 *   here — the #14270 class, and the reason both seams in `packages/cli` that
 *   got it right interpolate the kind TOKEN only.
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
 * Declaration values whose grammar is `<protocol>:<name>[@<range>]` — the two
 * spellings in which a host DECLARES that a key is an alias for a package with
 * a different name (#14278).
 *
 * `npm:` always names a package: `npm:bar@1`, `npm:@acme/x@^2`, or `npm:bar`
 * with no range at all. `workspace:` names one ONLY in its aliased form
 * (`workspace:bar@*`) — a bare `workspace:*` / `workspace:^1.2.3` is a RANGE,
 * so the key stays the name. Everything else — a plain range, `link:`,
 * `file:`, a git or tarball URL — carries no package name to expect: those
 * name a LOCATION or a version, and the manifest name they install under is
 * not derivable from the declaration at all.
 */
const ALIAS_DECLARATION_PROTOCOLS = [
  { prefix: 'npm:', rangeRequired: false },
  { prefix: 'workspace:', rangeRequired: true },
] as const;

/**
 * The manifest `name` the host's own declaration promises the package it
 * declares will carry — the key itself for an ordinary dependency, the ALIASED
 * package's name for `"foo": "npm:bar@1"` (#14278).
 *
 * ⚠️ Read by BOTH legs, which is why it sits above both rather than inside
 * either. They ask about different directories and it answers the same question
 * for each — *what name does the host say this key is?*
 *
 * - the #14041 fallback ({@link hostInstalledPackageDir}) verifies the one
 *   directory it consults, `<hostRoot>/node_modules/<key>`;
 * - the #13330 succeeding leg ({@link packageRootOf}) recognises the package
 *   root while walking up from the entry the CJS resolver already returned
 *   (#15044).
 *
 * ⚠️ This moves each leg's EXPECTATION, never its strictness. The
 * manifest-name check is what keeps the fallback strictly tighter than the CJS
 * resolution it backs up (#14041's property, #4719's gate): a finder that
 * accepted a directory without confirming it holds the declared package would
 * be a looser finder, and loosening it would trade a confidently-wrong remedy
 * for a wrong LOAD — the worse direction. So the expectation is still authored
 * by the host, read out of the same `package.json` the declaration gate reads;
 * only the sentence it spells changes, from "the key" to "what the host says
 * the key is an alias for". An aliased install pointing at one package still
 * refuses a directory holding another.
 *
 * Anything that does not parse as a bare package name yields no expectation to
 * move to, so the key stays: a `workspace:` range, a `link:` / `file:`
 * location, an alias value carrying a subpath, a malformed value. Deliberate —
 * {@link packageNameFromSpecifier} is the one authority on what a package name
 * is here, and its own documentation blesses the aliased declaration shape.
 *
 * ⚠️ "The key stays" is a statement about THIS axis only. On the #14041
 * fallback leg a location specifier now gets a SECOND one
 * ({@link declaredLocationAxis}, #17046): the host named a directory, so the
 * directory is what gets verified when the name cannot be. On the #13330 leg
 * the residue is still a load rather than a refusal: a `link:` target whose
 * manifest names something else keeps today's `require`-condition entry,
 * unchanged by #15044 and by #17046, and pinned as such.
 */
function declaredManifestName(declaration: HostDeclaration): string {
  const { packageName, specifier } = declaration;
  if (specifier === undefined) return packageName;
  const protocol = ALIAS_DECLARATION_PROTOCOLS.find((p) => specifier.indexOf(p.prefix) === 0);
  if (protocol === undefined) return packageName;
  const value = specifier.slice(protocol.prefix.length);
  // `<name>@<range>`: the LAST `@` separates them, so a scoped name's own
  // leading `@` (index 0) is never mistaken for the separator.
  const at = value.lastIndexOf('@');
  if (at <= 0 && protocol.rangeRequired) return packageName;
  const name = at > 0 ? value.slice(0, at) : value;
  return packageNameFromSpecifier(name) === name ? name : packageName;
}

/**
 * Declaration value prefixes that name a LOCATION on disk or a REMOTE ARTEFACT
 * instead of a package (#15045).
 *
 * The complement of {@link ALIAS_DECLARATION_PROTOCOLS} on the axis that
 * matters to the FALLBACK's diagnostic: an alias protocol names a package, and
 * a plain range leaves the KEY naming it — a registry install lands under its
 * own name, so a directory holding something else there really is a broken
 * install. These do neither. `link:../bar` names a directory whose manifest may
 * say anything; a git or tarball URL names no on-disk location at all and
 * installs under the key with whatever the published manifest carries. For all
 * of them the key is a FALLBACK expectation rather than a promise the host
 * made, so a mismatch is the finder's declared limit and NOT an install fault
 * — which is the whole difference between the two messages below.
 *
 * ⚠️ Read for WORDING only. By itself it moves no expectation and licenses no
 * directory: it is what separates {@link unresolvableMessage}'s INSTALL
 * remedies from {@link unverifiableLocationMessage}'s statement of the limit.
 * The SECOND verification axis (#17046) reads a different, strictly narrower
 * list — {@link LOCATION_DECLARATION_PREFIXES} — because only some of these
 * name a directory there is anything to compare against.
 *
 * An unrecognised spelling falls out as "the key is a promise" and keeps
 * today's INSTALL wording — the conservative direction, matching
 * {@link ALIAS_DECLARATION_PROTOCOLS}'s own default.
 */
const NAMELESS_DECLARATION_PREFIXES = [
  'link:',
  'file:',
  'portal:',
  'git:',
  'git+',
  'github:',
  'gitlab:',
  'bitbucket:',
  'gist:',
  'http:',
  'https:',
] as const;

/**
 * Does the host's declaration leave this key's manifest name UNKNOWABLE from
 * the declaration alone (#15045)? See {@link NAMELESS_DECLARATION_PREFIXES}.
 */
function declarationNamesNoPackage(declaration: HostDeclaration): boolean {
  const { specifier } = declaration;
  if (specifier === undefined) return false;
  if (NAMELESS_DECLARATION_PREFIXES.some((prefix) => specifier.indexOf(prefix) === 0)) return true;
  // npm's protocol-less GitHub shorthand, `<owner>/<repo>[#<ref>]`. It is a
  // repository like `github:owner/repo` and carries no name for the same
  // reason; no semver range spelling contains a `/`, so the two do not
  // overlap. A leading `/` is an absolute path, which is not a shorthand.
  return specifier.indexOf('/') > 0 && specifier.indexOf(':') === -1;
}

/**
 * ── #17046: the SECOND verification axis — the declaration names a DIRECTORY ──
 *
 * The strict subset of {@link NAMELESS_DECLARATION_PREFIXES} whose value is a
 * FILESYSTEM PATH the host itself wrote. Everything else on that list — a git
 * or tarball URL, the bare `owner/repo` shorthand — names a remote artefact
 * and no on-disk location at all, so there is nothing here for it: those keep
 * the refusal, unchanged, and {@link unverifiableLocationMessage} keeps saying
 * so.
 *
 * ⚠️ This list exists because the two questions are NOT the same question.
 * `NAMELESS_…` asks *"does the declaration name a package?"* (a WORDING
 * question, #15045); this one asks *"does the declaration name a directory I
 * can compare against?"* — the question that decides whether a load happens.
 * Merging them would license `github:acme/bar` to be verified against a path
 * nobody wrote.
 */
const LOCATION_DECLARATION_PREFIXES = ['link:', 'file:', 'portal:'] as const;

/**
 * What {@link declaredLocationAxis} measured — kept as a record rather than a
 * boolean because the REFUSAL has to be able to say what it compared, exactly
 * as #15045 made the name axis say what it read.
 */
interface DeclaredLocationAxis {
  /** The declared path, resolved against `hostRoot` — as written, not canonicalised. */
  declaredPath: string;
  /** `realpath(declaredPath)`, or `undefined` when it does not resolve. */
  declaredReal: string | undefined;
  /** `realpath(<hostRoot>/node_modules/<key>)`, or `undefined` when it does not resolve. */
  installedReal: string | undefined;
  /** Both sides canonicalised, and the SAME directory. */
  verified: boolean;
}

/**
 * `realpath(path)`, or `undefined` when it cannot be canonicalised at all.
 *
 * ⚠️ Deliberately NOT the tolerant catch {@link hostInstalledPackageDir} uses,
 * which falls back to the uncanonicalised path so an exotic `realpath` failure
 * cannot un-install a package it already read a manifest out of. Here the
 * canonical form IS the evidence: falling back to the raw string would make
 * the comparison below a raw-string comparison in disguise, which is the one
 * thing #17046's triage ruled out by name.
 */
function canonicalPath(path: string): string | undefined {
  try {
    return realpathSync(path);
  } catch {
    return undefined;
  }
}

/**
 * The `link:` / `file:` / `portal:` path the declaration names, resolved
 * against the host root — or `undefined` when the declaration names no
 * directory.
 *
 * `file://…` URL spellings are declined on purpose: the remaining `//…` is not
 * a path, percent-decoding and the optional authority make it a second
 * grammar, and every unparsed spelling simply keeps today's refusal. Declining
 * costs a load that was already refused; guessing would license a directory
 * nobody named.
 */
function declaredLocationPath(declaration: HostDeclaration): string | undefined {
  const { specifier, hostRoot } = declaration;
  if (specifier === undefined) return undefined;
  const prefix = LOCATION_DECLARATION_PREFIXES.find((p) => specifier.indexOf(p) === 0);
  if (prefix === undefined) return undefined;
  const value = specifier.slice(prefix.length);
  if (value === '' || value.indexOf('//') === 0) return undefined;
  return resolve(hostRoot, value);
}

/**
 * Is `<hostRoot>/node_modules/<key>` the very directory the host's declaration
 * NAMED (#17046)?
 *
 * ## Why this is a second axis and not a hole in the first
 *
 * The #14041 fallback verifies one directory by asking whether its manifest
 * carries the name the declaration promises ({@link declaredManifestName}).
 * A `link:` / `file:` value promises no name, so that axis has nothing to
 * check and the KEY stands in for it — which refuses a *correctly linked*
 * package whose manifest happens to be named something else. That refusal is a
 * false one: the host DID name this directory, in its own manifest, in the
 * same authoring act the declaration gate reads.
 *
 * So the expectation moves the same way #14278 moved it — from the KEY to
 * *what the host actually declared* — only along the other axis: a PATH
 * instead of a NAME. ⛔ It is emphatically NOT "skip the check when the
 * specifier is a location", which would accept any directory sitting at the
 * key and trade a confidently-wrong remedy for a wrong LOAD. Both axes still
 * end at the host's own `package.json`, and a directory the host did not
 * declare is refused by both.
 *
 * ## The comparison, and why each part of it is what it is
 *
 * ⛔ NOT a raw string comparison, and ⛔ not a basename match — the two shapes
 * `packages/cli`'s own `isProcessEntry` (`src/utils/invocation.ts`) ruled out
 * for the same reason, where #10086 found basename matching in the wild and
 * PR #10084 pinned the symlink leg with a real symlink fixture. The DISCIPLINE
 * is reused here; nothing is imported, since `packages/types` sits below
 * `packages/cli`. Both sides are canonicalised with `realpathSync` and
 * compared EXACTLY:
 *
 * - **symlinks** — the whole point. `link:` installs `node_modules/<key>` AS a
 *   symlink, so the left side is a link and the right side is its target;
 *   without `realpath` they never compare equal. Chains, `..` spans and
 *   trailing separators all collapse here too, which is why `resolve()` alone
 *   is not enough on either side.
 * - **pnpm's store layout** — MEASURED, pnpm 10.33: `link:../x` symlinks the
 *   key straight at `../x`, so it verifies; `file:../x` on a DIRECTORY does
 *   not — pnpm routes it through the virtual store
 *   (`.pnpm/<name>@file+..+x/node_modules/<name>`), a hard-linked COPY whose
 *   realpath is inside the host's own `node_modules` and is not the declared
 *   path. That shape keeps today's refusal, deliberately: reading the store's
 *   encoded directory name to recover the origin would be parsing a package
 *   manager's private layout, and accepting "anything under `node_modules`"
 *   is the forbidden relaxation above. npm's `file:` (a symlink) verifies.
 * - **case-insensitive filesystems** — NOT case-folded, and that is the safe
 *   direction rather than an oversight. Folding would accept a path the host
 *   did not write wherever the filesystem is case-SENSITIVE; declining to fold
 *   can only fail to verify a link whose declared spelling differs in case
 *   from the on-disk entry, and failing to verify is exactly today's
 *   behaviour. `realpathSync` (not `.native`) is used because the sibling read
 *   in {@link hostInstalledPackageDir} uses it: comparing two different
 *   canonicalisers is its own defect class.
 *
 * `undefined === undefined` is not a match: an unresolvable side answers
 * `verified: false`, so a declaration pointing at nothing and a key holding
 * nothing do not verify each other.
 */
function declaredLocationAxis(
  declaration: HostDeclaration,
  installedAt: string,
): DeclaredLocationAxis | undefined {
  const declaredPath = declaredLocationPath(declaration);
  if (declaredPath === undefined) return undefined;
  const declaredReal = canonicalPath(declaredPath);
  const installedReal = canonicalPath(installedAt);
  return {
    declaredPath,
    declaredReal,
    installedReal,
    verified: installedReal !== undefined && installedReal === declaredReal,
  };
}

/**
 * The directory of the package named `manifestName` that owns `resolvedFile`.
 *
 * Walked up from the resolved entry rather than computed from the specifier,
 * because the resolver's answer is a REALPATH: under pnpm that is inside
 * `.pnpm/<pkg>@<version>/node_modules/<pkg>`, which is exactly the directory
 * whose `node_modules` the package's own transitive imports resolve against —
 * and exactly what makes one physical copy shared between the app and the
 * framework.
 *
 * ⚠️ `manifestName` is what {@link declaredManifestName} reads out of the
 * host's declaration, NOT the declaration key (#15044). For an aliased install
 * — `{"foo": "npm:bar@1"}` — the realpath this walk climbs is `bar`'s own
 * package directory, whose manifest is named `bar`; matching the key `foo`
 * never succeeded, so the caller fell back to the CJS resolver's answer and an
 * aliased dual-published package silently kept loading its `require` build,
 * beside the `import` build the caller's own ESM chain holds. Matching the
 * key made the walk unable to recognise the very package it had been handed.
 */
function packageRootOf(resolvedFile: string, manifestName: string): string | undefined {
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
      if (manifest.name === manifestName) return dir;
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
 * ⚠️ The two names here are different questions and only look alike (#15044).
 * The package ROOT is recognised by the name the DECLARATION promises
 * ({@link declaredManifestName}); the exports SUBPATH is cut from the
 * declaration KEY, because the key is what the specifier is spelled with —
 * `aliased/plugin` addresses `./plugin` of whatever `aliased` aliases. They
 * coincide for every ordinary dependency, which is why one name served both
 * until an aliased install pulled them apart.
 *
 * @param declaration What the host's `package.json` says about the key — the
 * same value the #14041 fallback leg is handed, so both legs read one
 * expectation from one place.
 * @param cjsResolved What `hostRequire.resolve(specifier)` answered. It is the
 * host-anchored part of the answer and is never second-guessed here; only the
 * CONDITION is re-decided.
 */
function esmEntryForDeclared(
  specifier: string,
  declaration: HostDeclaration,
  cjsResolved: string,
): string | undefined {
  const { packageName } = declaration;
  const root = packageRootOf(cjsResolved, declaredManifestName(declaration));
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
 *     already passed by the time it reaches this catch (#14271 review);
 *   - and that directory is VERIFIED against the host's own declaration
 *     before anything is loaded out of it — by the manifest NAME the
 *     declaration promises, or by the PATH it names (#17046). CJS resolution
 *     asks neither question, which is what "strictly tighter" means here.
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
  /**
   * Present at the key, holding a package named something ELSE, under a
   * declaration that names no package to expect (#15045) — and, when that
   * declaration DID name a directory, not that directory either (#17046).
   * Refused exactly as `absent` is — same kind, same throw — but it is a
   * different measurement and gets its own wording: nothing about the install
   * is broken.
   *
   * `location` is the second axis's own reading, `undefined` when the
   * declaration named no directory to read (a git or tarball URL). It is
   * carried so the refusal can state what it compared instead of asserting a
   * limit it no longer has.
   */
  | {
      outcome: 'unverifiable-location';
      packageDir: string;
      installedName: string;
      location: DeclaredLocationAxis | undefined;
    }
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
 * The `name` of the manifest in `dir`, or `undefined` when there is no readable,
 * parseable `package.json` there or its `name` is not a string.
 *
 * ⚠️ Absent and PRESENT-BUT-NAMED-OTHERWISE both answer `undefined` to the
 * check that consults it, which is correct — neither is the declared package's
 * install. They are different FACTS about the app, though, and #15045 is the
 * card about telling an operator which one was measured.
 */
function manifestNameAt(dir: string): string | undefined {
  try {
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
      name?: unknown;
    };
    return typeof manifest.name === 'string' ? manifest.name : undefined;
  } catch {
    return undefined;
  }
}

/** Where the fallback looks, and the only place it looks: `node_modules/<key>`. */
function hostNodeModulesEntry(declaration: HostDeclaration): string {
  const { packageName, hostRoot } = declaration;
  return join(hostRoot, 'node_modules', ...packageName.split('/'));
}

/**
 * The one directory the fallback finder consults, verified to be the declared
 * package's install and then realpath'd — under pnpm the link target is
 * `.pnpm/<pkg>@<version>/node_modules/<pkg>`, the directory the package's own
 * transitive imports resolve against, exactly as the CJS resolver's realpath
 * answer behaves on the succeeding path.
 *
 * ⚠️ TWO verification axes, either of which is sufficient, and BOTH of which
 * are read out of the host's own `package.json` (#17046):
 *
 * 1. **the NAME** (#14041, moved by #14278) — the manifest at the key carries
 *    the name {@link declaredManifestName} reads out of the declaration;
 * 2. **the LOCATION** ({@link declaredLocationAxis}) — the declaration names a
 *    directory and the key IS that directory, canonically.
 *
 * The second exists because a `link:` / `file:` declaration promises no name,
 * so axis 1 falls back to the KEY and refuses a correctly linked package whose
 * manifest is named something else — a false refusal on a valid setup, where
 * the operator's only recourse is to stop using a supported linking mode.
 *
 * ⛔ The axes are alternatives, never a weakening: a directory the host
 * declared NEITHER by name NOR by path is refused exactly as before, and no
 * specifier that names no directory gains anything. The finder therefore stays
 * strictly tighter than the CommonJS resolution it backs up, which accepts
 * whatever sits at the key without asking either question.
 */
function hostInstalledPackageDir(declaration: HostDeclaration): string | undefined {
  const linked = hostNodeModulesEntry(declaration);
  // Unreadable, unparseable, or named something else — all `undefined`, exactly
  // as before #15045; the CALLER is what now distinguishes them, and only to
  // pick the wording.
  const namedAsDeclared = manifestNameAt(linked) === declaredManifestName(declaration);
  if (!namedAsDeclared && declaredLocationAxis(declaration, linked)?.verified !== true) {
    return undefined;
  }
  try {
    return realpathSync(linked);
  } catch {
    // The manifest read above already succeeded through this path; an exotic
    // realpath failure does not un-install the package. (Unreachable via the
    // location axis, which is `verified` only when this same realpath just
    // succeeded.)
    return linked;
  }
}

/** The #14041 fallback: see the section note above for the shape and the split. */
function declaredCjsResolveFallback(
  specifier: string,
  declaration: HostDeclaration,
): DeclaredCjsResolveFallback {
  const { packageName } = declaration;
  const packageDir = hostInstalledPackageDir(declaration);
  if (packageDir === undefined) {
    // #15045: the finder has REFUSED. Re-read the one directory it consulted so
    // the failure can say which of the two absences it measured. A cold error
    // path that was already about to build a multi-line message, so the second
    // read costs nothing anyone can observe.
    const linked = hostNodeModulesEntry(declaration);
    const installedName = manifestNameAt(linked);
    if (
      installedName !== undefined &&
      installedName !== packageName &&
      declarationNamesNoPackage(declaration)
    ) {
      // #17046: BOTH axes have now failed, so the message says so — carrying
      // the location axis's own measurement when there was one to make.
      return {
        outcome: 'unverifiable-location',
        packageDir: linked,
        installedName,
        location: declaredLocationAxis(declaration, linked),
      };
    }
    return { outcome: 'absent' };
  }

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

/**
 * The wording for {@link DeclaredCjsResolveFallback} `unverifiable-location`
 * (#15045) — a `link:` / `file:` (or git / tarball) install whose linked
 * manifest names something other than the key, and which #17046's location
 * axis could not tie to the declaration either.
 *
 * The refusal it explains is deliberate; what #15045 changed is that it no
 * longer prescribes {@link unresolvableMessage}'s remedies, every one of which
 * is measurably false here: the package IS on disk, so it was neither "never
 * installed" nor pruned away, and its `import` target exists. An operator
 * handed those runs `pnpm install`, watches nothing change, and then goes
 * looking for a build that is not broken.
 *
 * ⚠️ #17046 NARROWED what reaches this text, so the text had to move with it.
 * It used to be able to say the KEY was all the finder had; that is no longer
 * true whenever the declaration names a directory, because
 * {@link declaredLocationAxis} then compares one. What survives here is the
 * residue: a remote artefact (no location to compare), or a location that was
 * compared and came back DIFFERENT — pnpm's `file:` virtual-store copy being
 * the measured example. Both facts are now stated rather than assumed, because
 * a message asserting a limit the finder no longer has is the same defect
 * #15045 removed.
 *
 * The closing remedy is one fact stated from both ends, and it was MEASURED,
 * not reasoned: make the key and the linked manifest's `name` agree — rename
 * either — and the key becomes a true expectation, so this same fallback
 * rescues the load.
 *
 * ⛔ Deliberately NOT offered: "have the package publish a `require`
 * condition". It does make the load succeed, and that is the problem — a dual
 * build resolves through CommonJS, so #13330's condition re-decision runs
 * instead, {@link packageRootOf} fails to recognise the differently-named root
 * for the same reason this finder does, and `?? resolved` hands back the
 * `require` build. The operator gets a load, plus the second-instance split
 * #13330 exists to close, and no warning. A remedy the runtime honours while
 * making things quietly worse is not one worth printing.
 */
function unverifiableLocationMessage(
  declaration: HostDeclaration,
  found: { packageDir: string; installedName: string; location: DeclaredLocationAxis | undefined },
  cause: unknown,
): string {
  const { packageName, hostRoot, field, specifier } = declaration;
  const { packageDir, installedName, location } = found;
  const detail = cause instanceof Error ? cause.message : String(cause);
  // The second axis, reported only when there WAS one to run. Its two lines are
  // the two paths that were compared, canonically — the same "say what you
  // measured" the name lines above owe (#17046).
  const locationLines =
    location === undefined
      ? '  What it IS: this declaration names no on-disk location at all — a git or a\n' +
        '  tarball URL (github:owner/repo, https://.../pkg.tgz) installs under the key with\n' +
        '  whatever the published manifest carries, so the KEY is the only thing this finder\n' +
        '  has to check against, and the manifest above is not it.\n'
      : '  What it IS: a "link:" / "file:" declaration names a LOCATION, not a package, so\n' +
        '  the manifest at the other end may carry any name. This finder therefore checks\n' +
        '  the LOCATION too — and that did not match either:\n' +
        `    the declaration names:  ${location.declaredReal ?? `${location.declaredPath} (does not exist)`}\n` +
        `    the key resolves to:    ${location.installedReal ?? `${packageDir} (does not resolve)`}\n` +
        '  A `file:` directory install under pnpm lands in the virtual store rather than at\n' +
        '  the declared path, and reaches this text for exactly that reason; `link:` points\n' +
        '  at the declared directory and is verified by it.\n';
  return (
    `Cannot load module '${packageName}': the host app DECLARES it ` +
    `(${field}: ${JSON.stringify(specifier)}), a package IS installed at that key, and ` +
    'this ESM fallback cannot confirm it is the declared one.\n' +
    `  host app: ${hostRoot}\n` +
    `  installed at: ${packageDir}\n` +
    `  its package.json is named: ${JSON.stringify(installedName)}\n` +
    `  this finder expected: ${JSON.stringify(packageName)}\n` +
    '\n  This is NOT an install problem, and NOT a declaration problem — the package is\n' +
    '  on disk and the declaration is right, so re-running `pnpm install`, un-pruning a\n' +
    '  deploy and rebuilding a dist all change nothing here.\n' +
    locationLines +
    '  The refusal is deliberate: this fallback stays strictly tighter than the\n' +
    '  CommonJS resolution it backs up, and will not load a directory it cannot tie to\n' +
    '  the declaration — by NAME or by LOCATION. Only a package publishing no `require`\n' +
    '  condition reaches it at all, so nothing that loads today is affected either way.\n' +
    '  What DOES change it — make the two names AGREE, from whichever end you own:\n' +
    `    • declare the linked package under its own name: key ${JSON.stringify(installedName)},\n` +
    '      pointing at the same location, and import it under that name\n' +
    `    • or set the linked package's own "name" to ${JSON.stringify(packageName)}, if that\n` +
    '      directory is yours to edit\n' +
    '  Either way the key becomes the expectation this finder checks, and the load\n' +
    '  succeeds through this same fallback.\n' +
    `  (resolver: ${detail})`
  );
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
        const fallback = declaredCjsResolveFallback(pkg, declaration);
        if (fallback.outcome === 'entry') {
          return import(pathToFileURL(fallback.entry).href);
        }
        if (fallback.outcome === 'unverifiable-location') {
          // #15045: the SAME kind and the SAME throw as every other unrescued
          // outcome below — this branch decides WORDING only. Turning this into
          // a load is the second verification axis the card holds open, and is
          // a contract change, not a diagnostic one.
          throw hostImportError(
            'declared-unresolvable',
            unverifiableLocationMessage(declaration, fallback, cause),
            cause,
          );
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
      //
      // #15044: the whole DECLARATION goes in, not just the key. Recognising
      // the package root by the key made an aliased install unrecognisable to
      // its own re-decision — the walk failed, the `?? resolved` here caught
      // it, and the load silently stayed on the `require` build #13330 exists
      // to move it off. The fallback below the catch has taken the same
      // declaration since #14278; the two legs now expect one name.
      const entry = esmEntryForDeclared(pkg, declaration, resolved) ?? resolved;
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
