// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import path from 'path';
import fs from 'fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import chalk from 'chalk';
import { bundleRequire } from 'bundle-require';
import type { Plugin } from 'esbuild';
import { hasStackProvenance, stackConversionsOf, type ConversionNotice } from '@objectstack/spec';
import { printErrorToStderr, printWarningToStderr } from './format.js';

export interface LoadedConfig {
  config: any;
  absolutePath: string;
  duration: number;
  /**
   * The module's NAMED exports that {@link loadConfig} merged onto the
   * default-exported stack, in module order — the provenance half of
   * {@link namedExportRejectionHints}, and empty for the overwhelmingly common
   * config whose only export is the default.
   *
   * It records what the merge DID, not what the schema thinks of it: a name the
   * stack schema declares (`onEnable`, `functions`) and a name it does not
   * (`collectPackageDirs`) are both listed here, because the loader cannot tell
   * them apart and the parse that can runs several steps later.
   */
  namedExports: readonly string[];

  /**
   * The module's named exports the merge DROPPED, in module order, because the
   * default-exported stack already declares that key — the {@link namedExports}
   * mirror, and empty for every config that authors each stack key once.
   *
   * These names reached no artifact and no parse. That is the whole reason the
   * field exists: a merged key is answerable downstream (the strict parse sees
   * it, {@link namedExportRejectionHints} explains it), whereas a dropped one is
   * visible nowhere but here, so a caller that wants to say anything about it
   * has to be handed it. {@link loadConfig} also reports them on stderr, so the
   * finding does not depend on a caller opting in.
   */
  shadowedNamedExports: readonly string[];

  /**
   * Whether the module's DEFAULT export was built by a stack producer —
   * `defineStack` (either mode) or `composeStacks` — read with
   * `hasStackProvenance` (`@objectstack/spec`) off `mod.default` itself.
   *
   * Read HERE, before the named-export merge, because the merge builds a new
   * object with a spread and the provenance mark is non-enumerable: `config`
   * never carries it once any named export is merged, so asking `config` would
   * answer `false` for a correct `defineStack` project that also exports
   * `onEnable`. `false` for a plain object literal, a spread or JSON copy of a
   * built stack, and a module with no default export at all.
   *
   * `os validate` and `os build` refuse on `false` (`STACK_PROVENANCE_MISSING`,
   * `refuseUnbuiltStack`); every other command reads the config as before.
   */
  stackProvenance: boolean;

  /**
   * The ADR-0087 D2 conversions the stack producer applied while building the
   * DEFAULT export — `stackConversionsOf` (`@objectstack/spec`) read off
   * `mod.default` itself, beside {@link stackProvenance} and for the same
   * reason: the record rides beside the mark, non-enumerable, so the
   * named-export merge below drops it just as it drops the mark.
   *
   * `defineStack` converts at load, so `config` is already canonical and a
   * command re-running the conversion pass over it finds nothing the producer
   * converted. This is the only place those conversions can be read from:
   * `os validate` / `os build` fold it into their `conversions` field and the
   * `--strict` gate. `[]` for an unbuilt export and for a source that needed
   * no conversion.
   */
  stackConversions: readonly ConversionNotice[];
}

/**
 * Keep workspace packages and known native/driver deps external so they
 * are resolved at runtime via real Node ESM dynamic imports. Bundling
 * them through esbuild collapses each package's `createRequire(import.meta.url)`
 * chain into inline `require(...)` calls that throw in pure-ESM mode.
 *
 * Shared between `loadConfig()` and `serve.ts`'s direct `bundleRequire` call.
 */
export const BUNDLE_REQUIRE_EXTERNALS: (string | RegExp)[] = [
  /^@objectstack\//,
  'sql.js',
  'knex',
  'better-sqlite3',
  'pg',
  'mysql',
  'mysql2',
  'mongodb',
  'tedious',
  'oracledb',
  'sqlite3',
  'libsql',
  '@libsql/client',
];

/**
 * The refusal `resolveConfigPath()` throws when no config file can be resolved.
 *
 * Three fields, each with exactly one consumer, and the split is the point:
 *
 *   • `message` — PLAIN. It is what every `--json` catch-all copies into its
 *     envelope, so it must not carry terminal decoration: `chalk.white(abs)`
 *     in a payload is an ESC-bracket-37m / ESC-bracket-39m pair inside a JSON
 *     string the moment
 *     the run happens to have colour on.
 *   • `display` — the same sentence WITH that decoration, for the stream a
 *     human reads. Defaults to `message` where there is nothing to decorate.
 *   • `hints` — the lines printed under the refusal. Carried on the error
 *     rather than printed and forgotten, so the renderer below is the only
 *     place that knows their shape.
 *
 * `reportedToStderr` is read structurally by {@link isReportedError}, never
 * through `instanceof`: a command's catch-all must not print this refusal a
 * second time on stdout, and a structural marker survives a tree where `dist/`
 * and `src/` copies of this module can both be live.
 *
 * ⛔ No `code` and no `httpStatus` field, deliberately. `errorCodeFields()`
 * reads exactly those two names off a thrown error, so adding either here
 * would mint an ADR-0112 code for this refusal through the back door — the one
 * thing the #15547 ruling forbids. What a bare `{ error }` with neither field
 * should look like is #15549's question, not this file's.
 */
export class ConfigRefusalError extends Error {
  /** The refusal sentence with the decoration the text face has always shown. */
  readonly display: string;
  /** The dim lines printed under the refusal, in order. */
  readonly hints: readonly string[];
  /** Already written to stderr at the throw site — do not render it twice. */
  readonly reportedToStderr = true;

  constructor(message: string, hints: readonly string[], display: string = message) {
    super(message);
    this.name = 'ConfigRefusalError';
    this.display = display;
    this.hints = hints;
  }
}

/**
 * Report a config refusal on stderr and throw it.
 *
 * The four writes are the ones this helper has always made, in the same order,
 * on the same stream, byte for byte — they are just driven off the error object
 * now instead of off four literals. Rendering here rather than in the ten
 * catch-alls is what keeps the diagnostic in BOTH faces: a `--json` run still
 * shows its operator the refusal on stderr while the machine reads the envelope
 * on stdout, which is the shape #15692 established and this change must not
 * undo.
 */
function refuseConfig(message: string, hints: readonly string[], display?: string): never {
  const error = new ConfigRefusalError(message, hints, display);
  printErrorToStderr(error.display);
  console.error('');
  for (const hint of error.hints) console.error(chalk.dim(hint));
  throw error;
}

/**
 * The filenames {@link resolveConfigPath} auto-detects, in the order it tries
 * them.
 */
const CONFIG_FILE_CANDIDATES = [
  'objectstack.config.ts',
  'objectstack.config.js',
  'objectstack.config.mjs',
] as const;

/**
 * The config file auto-detection would load from `cwd` (default
 * `process.cwd()`), or `null` when there is none: {@link resolveConfigPath}'s
 * search WITHOUT its refusal.
 *
 * For the caller that treats "no project here" as an answer rather than an
 * error: `os generate` works outside a project too, and reads the manifest
 * only when there is one to read. Sharing the candidate list is what keeps
 * that caller from ever finding a different file than the one `os validate`
 * then loads.
 */
export function findConfigPath(cwd: string = process.cwd()): string | null {
  for (const candidate of CONFIG_FILE_CANDIDATES) {
    const abs = path.resolve(cwd, candidate);
    if (fs.existsSync(abs)) return abs;
  }
  return null;
}

/**
 * Resolve the config file path. Supports:
 * - explicit path (objectstack.config.ts)
 * - auto-detection (searches for objectstack.config.{ts,js,mjs})
 *
 * ## Both refusals THROW, and go to stderr on the way out (#15547)
 *
 * This helper is reached by ten published `--json` faces — `os validate`,
 * `info`, `diff`, `lint`, `compile`, `build` (a subclass of `compile`),
 * `verify`, `migrate meta`, `i18n check`, `i18n extract` — and it has no way
 * to know which run is a `--json` run: the flag is parsed in the command, and
 * `loadConfig()` passes it nothing.
 *
 * It used to print through `printError` and `console.log` — **both stdout** —
 * and then call `process.exit(1)`. #15692 moved the bytes to stderr; the exit
 * stayed, and with it the real defect: **nothing was thrown**, so every
 * command's catch-all `--json` error exit — all of which sit downstream of a
 * throw — never ran, and ten faces answered a missing config with an EMPTY
 * stdout where each of them has already declared it emits an envelope.
 *
 * ⇒ The refusals now throw {@link ConfigRefusalError}. That is not a new
 * contract; it is this path being pulled back onto the contract its callers
 * already published, which is why it adds **zero** accept-set members and
 * **zero** error codes.
 *
 * Three properties hold it in place, and each has a pin:
 *
 *   1. **No face becomes a crash dump.** `os verify` had no `try` at all —
 *      measured, a throw through it produced an oclif error line and no
 *      payload — so it gained the catch-all its nine siblings already had, in
 *      the same landing as the throw.
 *   2. **The text face does not narrow.** The refusal and both hint lines are
 *      still written here, to stderr, byte-identical; the catch-alls skip
 *      re-printing via {@link isReportedError}.
 *   3. **No code is minted.** The thrown error carries neither `code` nor
 *      `httpStatus`, so `errorCodeFields()` contributes nothing and the
 *      envelope is a bare `{ error }`. Whether that shape is right is
 *      **#15549's** open question — ⛔ do not answer it by adding a field here.
 */
export function resolveConfigPath(source?: string): string {
  if (source) {
    const abs = path.resolve(process.cwd(), source);
    if (!fs.existsSync(abs)) {
      refuseConfig(
        `Config file not found: ${abs}`,
        [
          '  Hint: Run this command from a directory with objectstack.config.ts',
          '  Or specify the path: objectstack <command> path/to/config.ts',
        ],
        `Config file not found: ${chalk.white(abs)}`,
      );
    }
    return abs;
  }

  // Auto-detect
  const found = findConfigPath();
  if (found) return found;

  refuseConfig(
    'No objectstack.config.{ts,js,mjs} found in current directory',
    ['  Hint: Run `objectstack init` to create a new project'],
  );
}

/**
 * Every `@objectstack/spec` entrypoint an authored config can reach the
 * `define*` helpers and the {@link STRICT_AUTHORING_FACTORIES} through — the
 * root and every subpath export. Real projects
 * use both: the example apps import `defineView`/`defineApp` from
 * `@objectstack/spec/ui` and `defineHook`/`defineDatasource` from
 * `@objectstack/spec/data`, so a shim that knew only the root package would
 * cover the smaller half of the authored surface.
 */
const SPEC_MODULE_RE = /^@objectstack\/spec(?:\/[\w./-]+)?$/;

/** esbuild namespace the authored-source shim modules live in. */
const AUTHORED_SOURCE_NAMESPACE = 'objectstack-authored-source';

/** The package root, which carries `formatZodError` for the shim's refusal text. */
const SPEC_ROOT_MODULE = '@objectstack/spec';

/** `defineStack`, `defineView`, … — the authoring helpers, by naming convention. */
const DEFINE_HELPER_RE = /^define[A-Z]/;

/** The stack producer: the one `define*` helper whose refused input {@link STACK_COMPOSER} may receive. */
const STACK_PRODUCER = 'defineStack';

/**
 * The stack composer. Not a `define*` helper and not strict at the call about
 * its inputs' contents, so the shim never makes it tolerant — but it REFUSES an
 * input no producer built, and the input the shim hands through for a refused
 * {@link STACK_PRODUCER} call is exactly that. See {@link authoredSourcePlugin}.
 */
const STACK_COMPOSER = 'composeStacks';

/**
 * The one module every generated shim module imports its hand-through record
 * from. It is bundled once per load, so a stack handed through by one
 * entrypoint's `defineStack` is recognised by another entrypoint's
 * `composeStacks`; and each `loadConfig` bundles afresh, so no record outlives
 * the load that made it.
 */
const HANDED_THROUGH_MODULE = 'objectstack:authored-source/handed-through';
const HANDED_THROUGH_FILTER = /^objectstack:authored-source\/handed-through$/;
const HANDED_THROUGH_NAMESPACE = 'objectstack-authored-source-record';

/**
 * The global-registry symbol name under which the shim keeps, on the stack an
 * ACCEPTED {@link STACK_PRODUCER} call returned, the argument that call was
 * given — and the one name {@link authoredArgumentOf} reads it back by.
 *
 * Owned by this CLI: ⛔ never the producer's own provenance key. The record
 * is not a claim about who built the stack (that mark is the producer's to
 * write); it is this loader's note of what the author wrote, read once, off
 * the default export, by {@link loadConfig}.
 *
 * ## Why a property on the stack, and not the load's hand-through record
 *
 * The record has to cross from the bundled shim to {@link loadConfig}. The
 * only values that cross are the config module's exports, and the default
 * export IS the stack the call returned, so a property on it crosses with it
 * — with no state outside the value, and no lifetime but the value's. The
 * hand-through record ({@link HANDED_THROUGH_MODULE}) is bundled inside the
 * load and is reachable from nothing outside it. A `Symbol.for` key because
 * the shim's code and this module are two module graphs in one process, and
 * the global registry is what both resolve the same symbol from.
 *
 * Non-enumerable, like the producer's own mark: a spread, `JSON.stringify`
 * and a schema parse all leave it behind, and {@link loadConfig} reads it
 * BEFORE its named-export merge spreads the default export into a new object.
 */
const AUTHORED_ARGUMENT_KEY = '@objectstack/cli:authored-source/accepted-argument';

/**
 * The global-registry symbol name under which a non-strict {@link STACK_PRODUCER}
 * call's options ask the producer for its input AS AUTHORED: normalised and
 * marked as every `strict: false` call is, with its load-time ADR-0087 D2
 * conversion pass skipped (#22256).
 *
 * Owned by `@objectstack/spec`, ⛔ not by this CLI: it is the producer's one
 * internal parameter (`stack.zod.ts`, beside `defineStack`), deliberately
 * neither declared on `DefineStackOptions` nor exported, so this module spells
 * its `Symbol.for` name the way the producer's provenance mark is read across
 * two copies of the package. A drifted spelling is not silent: the producer
 * then converts as before, and the composed pins in
 * `test/migrate-meta-composed-load-conversions.test.ts` go red on the very
 * conversion this key exists to keep visible.
 *
 * Read by the `composeStacks` wrap alone ({@link authoredSourcePlugin}).
 */
const SPEC_AUTHORED_INPUT_OPTION = 'objectstack.stack.authoredInput';

/**
 * One strict authoring factory that is not a `define*` helper: the function
 * `member` of the exported value `owner`, which validates its argument AT THE
 * CALL and throws on a shape the current schema refuses.
 */
export interface StrictAuthoringFactory {
  /** The export that carries the factory: `ObjectSchema`, `App`, … */
  readonly owner: string;
  /** The factory on it: `create`. */
  readonly member: string;
  /**
   * The `@objectstack/spec` entrypoint the entry was measured on. The shim does
   * not read it — it wraps the factory on EVERY entrypoint whose `owner` export
   * carries the member — and the pin reads it to prove the entry is still live.
   */
  readonly home: string;
}

/**
 * Every strict authoring factory `@objectstack/spec` exports besides the
 * `define*` helpers: the ONE list the authored-source shim wraps them from.
 *
 * `ObjectSchema.create(…)` is the authoring spelling of every example app's
 * objects, and it is as strict as a `define*` helper — it parses at the call.
 * Unwrapped, a retired key inside it aborted `os migrate meta` at load with a
 * raw `ZodError` array, while the tombstone it printed told the author to run
 * `os migrate meta`.
 *
 * ## Why a written list and not a pattern
 *
 * Measured over all 19 JS entrypoints of `@objectstack/spec`: 18 distinct
 * exported values carry a `create` member (31 export names — each identity
 * factory is exported a second time as its `*Schema`). Five validate — the
 * five below — and thirteen (`ApiEndpoint`, `Task`, `RestServerConfig`, …) are
 * identity factories, `(config) => config`, that refuse nothing and so have
 * nothing to tolerate.
 * The other function members of exported namespaces (`Field.*`, `SCIM.*`,
 * `RLS.*`, `OData.*`) build or read values and validate nothing. So:
 *
 *  - a NAME pattern (`*.create`) would wrap thirteen no-ops and still say
 *    nothing about which factories are strict;
 *  - a SHAPE enumeration at load cannot even see the one this list exists for:
 *    `ObjectSchema` is a lazy-schema Proxy whose `ownKeys` trap throws, so
 *    `Object.keys(ObjectSchema)` never names `create`.
 *
 * The pin beside this file's tests holds the list to the spec surface in both
 * directions: every entry resolves at its `home` and throws on a refused input,
 * and every `create` member spec exports that is NOT listed returns its
 * argument untouched. A new strict factory in spec therefore reddens the pin
 * with its name instead of reopening this defect.
 *
 * ⛔ Unlisted factories are never wrapped. `ObjectSchema.create` itself stays
 * strict everywhere else: this list is read by {@link authoredSourcePlugin}
 * alone, which only `os migrate meta` installs.
 */
export const STRICT_AUTHORING_FACTORIES: readonly StrictAuthoringFactory[] = Object.freeze([
  { owner: 'ObjectSchema', member: 'create', home: '@objectstack/spec/data' },
  { owner: 'App', member: 'create', home: '@objectstack/spec/ui' },
  { owner: 'Dashboard', member: 'create', home: '@objectstack/spec/ui' },
  { owner: 'Report', member: 'create', home: '@objectstack/spec/ui' },
  { owner: 'Action', member: 'create', home: '@objectstack/spec/ui' },
]);

/** What one `@objectstack/spec` entrypoint gives the shim to wrap. */
interface AuthoredSourceHelpers {
  /** Its `define*` helpers, by {@link DEFINE_HELPER_RE}. */
  readonly defineHelpers: readonly string[];
  /** Its {@link STRICT_AUTHORING_FACTORIES}, as owner export → factory members. */
  readonly factories: ReadonlyMap<string, readonly string[]>;
  /** Whether it exports {@link STACK_COMPOSER}. */
  readonly composer: boolean;
}

/**
 * The strict authoring surface a given `@objectstack/spec` entrypoint exports —
 * its `define*` helpers and its {@link STRICT_AUTHORING_FACTORIES} — read from
 * the copy **the config itself would import** (resolved from the config's own
 * directory, not the CLI's).
 *
 * A listed factory is read by PROPERTY (`ns[owner][member]`), never by
 * enumerating the owner: `ObjectSchema` is a lazy-schema Proxy, and its
 * `ownKeys` trap throws.
 *
 * Returns nothing to wrap — i.e. "shim nothing" — when the entrypoint cannot
 * be resolved or imported. That is the safe direction: an unshimmed load is
 * exactly today's behaviour, so a project the enumeration cannot read is no
 * worse off than before.
 */
async function authoredSourceHelpersOf(
  specifier: string,
  requireFromConfig: NodeRequire,
): Promise<AuthoredSourceHelpers> {
  try {
    const resolved = requireFromConfig.resolve(specifier);
    const ns = (await import(pathToFileURL(resolved).href)) as Record<string, unknown>;
    const defineHelpers = Object.keys(ns).filter((k) => DEFINE_HELPER_RE.test(k) && typeof ns[k] === 'function');
    const factories = new Map<string, string[]>();
    for (const { owner, member } of STRICT_AUTHORING_FACTORIES) {
      const value = ns[owner];
      if (value === null || (typeof value !== 'object' && typeof value !== 'function')) continue;
      if (typeof (value as Record<string, unknown>)[member] !== 'function') continue;
      factories.set(owner, [...(factories.get(owner) ?? []), member]);
    }
    return { defineHelpers, factories, composer: typeof ns[STACK_COMPOSER] === 'function' };
  } catch {
    return { defineHelpers: [], factories: new Map(), composer: false };
  }
}

/**
 * The helpers every generated shim module opens with.
 *
 * `__tolerant` is the try-real-then-authored wrap; `__tolerantMembers` applies
 * it to a factory member and hands every other member of the owner through
 * untouched — a Proxy rather than a copy, because the owner may itself be a
 * lazy-schema Proxy that cannot be enumerated.
 *
 * `__refusal` renders a raw `ZodError` — whose `message` is its issues as a
 * JSON array — through the project's own `formatZodError`, so the swallowed
 * verdict reads like the loader's `defineStack validation failed` block rather
 * than as a JSON dump. An error that already carries prose keeps its message.
 *
 * `__recordStack` is the hand-over hook the `defineStack` wrap alone passes:
 * it records the stack it hands through, with the options it was called
 * with, in the load's one hand-through record.
 *
 * `__keepAuthored` is the other `defineStack`-only hook, for the call that
 * SUCCEEDS: it keeps the argument beside the stack the real call returned,
 * under {@link AUTHORED_ARGUMENT_KEY}. It runs outside the `try`, so it can
 * never turn an accepted call into a refused one. A call takes exactly one of
 * the two arms, so no argument is both handed through and kept.
 *
 * `__composable` is what the `composeStacks` wrap maps its inputs through, and
 * it gives both arms one shape: what the author wrote, produced again by the
 * real `defineStack` in its `strict: false` mode with its conversion pass
 * skipped ({@link SPEC_AUTHORED_INPUT_OPTION}). A recorded stack is that
 * argument already; a kept one is followed to the end, as
 * {@link authoredArgumentOf} follows it, so a nested `defineStack(defineStack(
 * …))` starts from the inner literal. Every other input — a nested
 * composition, a plain object the author never wrapped — reaches the real
 * `composeStacks` as it was passed.
 */
const AUTHORED_SOURCE_PRELUDE: readonly string[] = [
  `const __refusal = (label, error) =>`,
  `  error && error.name === 'ZodError' && Array.isArray(error.issues)`,
  `    && typeof __specRoot.formatZodError === 'function'`,
  `    ? __specRoot.formatZodError(error, label + ' validation failed')`,
  `    : (error && error.message) || String(error);`,
  `const __tolerant = (label, call, handOver, keep) => (...authored) => {`,
  `  let built;`,
  `  try {`,
  `    built = call(...authored);`,
  `  } catch (error) {`,
  `    console.warn(`,
  `      '[authored-source] ' + label + '(): the current schema refuses this '`,
  `      + 'artifact, so it is handed to the migration chain exactly as authored. '`,
  `      + __refusal(label, error),`,
  `    );`,
  `    if (handOver) handOver(authored);`,
  `    return authored[0];`,
  `  }`,
  `  if (keep) keep(built, authored);`,
  `  return built;`,
  `};`,
  `const __recordStack = (authored) => {`,
  `  if (authored[0] !== null && typeof authored[0] === 'object') __handedThrough.set(authored[0], authored[1]);`,
  `};`,
  `const __authoredKey = Symbol.for(${JSON.stringify(AUTHORED_ARGUMENT_KEY)});`,
  `const __keepAuthored = (built, authored) => {`,
  `  const source = authored[0];`,
  `  if (built === null || typeof built !== 'object' || source === null || typeof source !== 'object') return;`,
  `  if (built === source || !Object.isExtensible(built)) return;`,
  `  if (Object.prototype.hasOwnProperty.call(built, __authoredKey)) return;`,
  `  Object.defineProperty(built, __authoredKey, { value: source, enumerable: false, writable: false, configurable: false });`,
  `};`,
  `const __authoredInput = Symbol.for(${JSON.stringify(SPEC_AUTHORED_INPUT_OPTION)});`,
  `const __keptArgumentOf = (stack) => {`,
  `  const seen = new Set();`,
  `  let current = stack;`,
  `  while (current !== null && typeof current === 'object' && !seen.has(current)`,
  `    && Object.prototype.hasOwnProperty.call(current, __authoredKey)) {`,
  `    seen.add(current);`,
  `    current = current[__authoredKey];`,
  `  }`,
  `  return current;`,
  `};`,
  `const __composable = (stack) => {`,
  `  if (__handedThrough.has(stack)) {`,
  `    return __specRoot.${STACK_PRODUCER}(stack, { ...__handedThrough.get(stack), strict: false, [__authoredInput]: true });`,
  `  }`,
  `  const authored = __keptArgumentOf(stack);`,
  `  return authored === stack ? stack : __specRoot.${STACK_PRODUCER}(authored, { strict: false, [__authoredInput]: true });`,
  `};`,
  `const __tolerantMembers = (owner, ownerName, members) => {`,
  `  const wrapped = new Map(members.map((member) => [`,
  `    member,`,
  `    __tolerant(ownerName + '.' + member, (...authored) => owner[member](...authored)),`,
  `  ]));`,
  `  return new Proxy(owner, {`,
  `    get: (target, prop) => (wrapped.has(prop) ? wrapped.get(prop) : Reflect.get(target, prop)),`,
  `  });`,
  `};`,
];

/**
 * Load an authored config **as authored**, for the one consumer whose input is
 * a source the CURRENT schema is expected to refuse: the `os migrate meta`
 * codemod (#9418).
 *
 * ## The defect this exists to close
 *
 * A retired authorable key is a `retiredKey()` tombstone — `z.never()` carrying
 * the upgrade prescription — so the current schema does not strip it, it
 * REJECTS it. Every `define*` helper in `@objectstack/spec` is a
 * `Schema.parse(config)`, and a real `objectstack.config.ts` calls them: `os
 * init` scaffolds `export default defineStack({ … })`, and larger projects
 * spread `defineView` / `defineAgent` / `defineFlow` across per-artifact
 * modules. So the rejection happens while the config MODULE is being evaluated,
 * inside `bundleRequire` — before `os migrate meta` has run a line of its own.
 *
 * The CLI never had a validation step to reorder: the gate lives in the loaded
 * module. That made the codemod refuse the only input class it exists for, and
 * the refusal it printed was the prescription telling the author to run it —
 * `Run \`os migrate meta --from <N>\`…` ships 144 times across 39 files under
 * `packages/spec/src`, so the upgrade path closed a loop on itself.
 *
 * ## What the shim does
 *
 * Each `@objectstack/spec` entrypoint the config imports is replaced by a
 * generated module that re-exports the real one and wraps its `define*`
 * helpers — and the {@link STRICT_AUTHORING_FACTORIES} it carries, such as
 * `ObjectSchema.create` — as **try-real-then-authored**:
 *
 * ```js
 * export const defineView = (...authored) => {
 *   try { return realDefineView(...authored); } catch { return authored[0]; }
 * };
 * ```
 *
 * A factory is wrapped in place on its owner: `ObjectSchema` stays the real
 * schema for every other member (`parse`, `shape`, …), and only `create` is
 * tolerant. Both kinds are strict at the call, so both must be wrapped for the
 * chain to convert first — a `defineStack` wrap alone never ran, because the
 * `ObjectSchema.create(…)` inside its argument threw before it was called.
 *
 * The narrowness is the point, and it is what keeps this a restoration rather
 * than a widening of what the command accepts:
 *
 *  - **A source that loads today evaluates identically.** The real helper
 *    runs, so every value the module builds is the value it builds today, with
 *    each helper's defaults and transforms (`defineForm` moves `schemaId` into
 *    `data`, …). The one difference is which value the chain starts from: an
 *    accepted `defineStack` call's ARGUMENT, not its result (see "An accepted
 *    `defineStack` call" below).
 *  - **A source the current schema refuses reaches the chain as authored** —
 *    which is precisely the codemod's input. `defineX(config: z.input<typeof
 *    XSchema>)` means the authored argument is by construction a shape
 *    `XSchema` accepts, so handing it on unparsed yields a well-formed
 *    authoring tree rather than an ad-hoc one.
 *  - **Validation is not skipped, it is moved after the conversion.** The
 *    command still parses the MIGRATED stack through
 *    `ObjectStackDefinitionSchema` and reports `schemaValid`, so a source that
 *    is broken for reasons the chain cannot fix is still reported as broken —
 *    just after the codemod has done the part it can.
 *
 * A swallowed verdict is announced on **stderr** rather than dropped: the
 * author deserves to know an artifact bypassed the parse, and stderr keeps a
 * `--json` run's stdout a single parseable document.
 *
 * ## An accepted `defineStack` call: the chain starts from its argument
 *
 * A call the current schema ACCEPTS has already run the producer's load-time
 * ADR-0087 D2 conversion pass when it returns. That pass runs in both of its
 * modes, and no option skips it. So its result is canonical already. Handed
 * to the chain as it was, a conversion the load still applies
 * (`driver: 'mongo'`) had already happened: `applied` came back empty,
 * `--write` wrote nothing, and every later load still printed the notice
 * that sends the author to this command.
 *
 * So the shim keeps the argument beside the stack the call returned
 * ({@link AUTHORED_ARGUMENT_KEY}), and {@link loadConfig} starts the default
 * export from it. That argument is what `defineStack(config: z.input<…>)`
 * accepted, so it is a well-formed authoring tree. The command still parses
 * the MIGRATED stack and reports `schemaValid`. A refused call already hands
 * its argument through as it is, so the two arms leave the chain one input
 * shape: the stack the author wrote.
 *
 * A composed input cannot be substituted this way: `composeStacks` builds each
 * package body from the stack its input's producer RETURNED, and rebuilding the
 * body from the argument here would be a second copy of composition's rule.
 * The next section is how a composed project reaches the same shape.
 *
 * ## A composed project: every wrapped input is produced again, as authored
 *
 * `composeStacks` is not a `define*` helper, so it runs for real, and its
 * first step refuses every input no producer built (`STACK_PROVENANCE_MISSING`,
 * ADR-0130 / #20367 ruling B). The stack a refused `defineStack` call hands
 * through is such an input — unmarked, though the author wrapped it — so
 * without this step a `composeStacks([defineStack({ … }), …])` project with a
 * retired spelling in ANY input was refused with a prescription the author had
 * already followed.
 *
 * So the shim wraps `composeStacks` to hand each input whose `defineStack` call
 * it saw — refused and recorded, or accepted and kept — to the real
 * `defineStack` again, before the real `composeStacks` runs, starting from
 * what the author wrote. It asks in the producer's `strict: false` mode, with
 * the producer's internal parameter that skips the load-time ADR-0087 D2
 * conversion pass ({@link SPEC_AUTHORED_INPUT_OPTION}, #22256). Without that
 * parameter a conversion the load still applies (`driver: 'mongo'`) was
 * applied while the input was produced again, so the chain never listed it
 * and `--write` never wrote it — the one-package defect, inside every package
 * body. With it, composition runs its own rule over the authored inputs, and
 * each `packages[i].manifest` body the chain reads is what input i's author
 * wrote. The producer marks its own output (`strict: false` is a choice made
 * inside it), so nothing here writes the mark; and an input the shim never
 * saw a `defineStack` call build — a plain object the author never wrapped, a
 * spread of a built stack — reaches the real `composeStacks` untouched and is
 * refused there exactly as before.
 *
 * The one-package path keeps handing the authored argument through RAW: it
 * needs no producer at all, since nothing composes it.
 *
 * ⚠️ Deliberately NOT the default for `loadConfig()`. Every other command —
 * `os build`, `os validate`, `os serve` — must keep hearing the rejection: the
 * tombstone IS their upgrade channel. Only the codemod is entitled to read
 * past it.
 */
function authoredSourcePlugin(configPath: string): Plugin {
  const requireFromConfig = createRequire(configPath);
  return {
    name: 'objectstack:authored-source',
    setup(build) {
      build.onResolve({ filter: SPEC_MODULE_RE }, (args) => {
        // The shim re-exports the SAME specifier it stands in for. Left to
        // resolve normally that import would land back here and shim itself
        // forever, so inside the namespace the specifier is handed straight to
        // the runtime — which is also what keeps `__real` the project's own
        // copy of spec rather than the CLI's.
        if (args.namespace === AUTHORED_SOURCE_NAMESPACE) {
          return { path: args.path, external: true };
        }
        return { path: args.path, namespace: AUTHORED_SOURCE_NAMESPACE };
      });

      build.onResolve({ filter: HANDED_THROUGH_FILTER }, (args) => ({
        path: args.path,
        namespace: HANDED_THROUGH_NAMESPACE,
      }));
      build.onLoad({ filter: /.*/, namespace: HANDED_THROUGH_NAMESPACE }, () => ({
        contents: 'export const handedThrough = new WeakMap();',
        loader: 'js',
      }));

      build.onLoad({ filter: /.*/, namespace: AUTHORED_SOURCE_NAMESPACE }, async (args) => {
        const { defineHelpers, factories, composer } = await authoredSourceHelpersOf(args.path, requireFromConfig);
        const spec = JSON.stringify(args.path);
        const lines = [
          `import * as __real from ${spec};`,
          `import * as __specRoot from ${JSON.stringify(SPEC_ROOT_MODULE)};`,
          `import { handedThrough as __handedThrough } from ${JSON.stringify(HANDED_THROUGH_MODULE)};`,
          `export * from ${spec};`,
          ...AUTHORED_SOURCE_PRELUDE,
        ];
        for (const name of defineHelpers) {
          const handOver = name === STACK_PRODUCER ? ', __recordStack, __keepAuthored' : '';
          lines.push(
            `export const ${name} = __tolerant(${JSON.stringify(name)}, (...authored) => __real.${name}(...authored)${handOver});`,
          );
        }
        for (const [owner, members] of factories) {
          lines.push(
            `export const ${owner} = __tolerantMembers(__real.${owner}, ${JSON.stringify(owner)}, ${JSON.stringify(members)});`,
          );
        }
        if (composer) {
          lines.push(
            `export const ${STACK_COMPOSER} = (stacks, ...rest) => __real.${STACK_COMPOSER}(`
              + `Array.isArray(stacks) ? stacks.map(__composable) : stacks, ...rest);`,
          );
        }
        return { contents: lines.join('\n'), loader: 'js' };
      });
    },
  };
}

export interface LoadConfigOptions {
  /**
   * Read the config as AUTHORED rather than as the current schema would have
   * it — see {@link authoredSourcePlugin}. Set by `os migrate meta` only.
   *
   * Two things follow. A refused helper call hands its argument through. And a
   * default export that an ACCEPTED `defineStack` call built is replaced by the
   * argument that call was given ({@link authoredArgumentOf}), before the
   * named exports are merged onto it, so `config` is the stack as written. The
   * producer's mark and conversion record are still read off the built stack.
   *
   * @default false
   */
  authoredSource?: boolean;
}

/**
 * The argument an accepted `defineStack` call was given, read off the stack
 * it returned — or `value` itself when the authored-source shim kept none
 * there (a refused call's hand-through, a composed stack, a plain object, a
 * load without the shim).
 *
 * Followed to the end, so `defineStack(defineStack({ … }))` answers the inner
 * literal: each accepted call's result carries its own argument, and only the
 * innermost one is what the author wrote.
 */
function authoredArgumentOf(value: unknown): unknown {
  const key = Symbol.for(AUTHORED_ARGUMENT_KEY);
  let current = value;
  const seen = new Set<unknown>();
  while (current !== null && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    if (!Object.prototype.hasOwnProperty.call(current, key)) break;
    current = (current as Record<symbol, unknown>)[key];
  }
  return current;
}

/**
 * Load and bundle a config file using bundle-require.
 * Returns the resolved config object, its load time, and the provenance of
 * whatever named exports were merged into it.
 *
 * ## The rule this function establishes: the config file is a MODULE, and the
 * whole module is the stack
 *
 * `objectstack.config.ts` is not read for its `default` export alone. The
 * default is the base, and then **every named export the module has is merged
 * onto it as a TOP-LEVEL STACK KEY**, under the export's own name. That is
 * deliberate and load-bearing: `onEnable` and `functions` are declared stack
 * keys that an app authors as named exports, and unwrapping `mod.default` alone
 * dropped them — which is why `AppPlugin` never invoked the runtime hooks.
 *
 * The consequence is the half nothing said out loud, and #18171 is the card
 * about it: **a named export is legal only when its name is a key
 * `ObjectStackDefinitionSchema` declares.** An `export const collectPackageDirs
 * = …` helper sitting beside the default is not a helper as far as this loader
 * is concerned — it is a top-level stack key called `collectPackageDirs`, and
 * the strict stack parse then refuses it as unrecognised. That refusal is
 * correct and stays correct; what it could not say is WHY a key the author
 * never wrote inside `defineStack()` is being judged as a stack key at all.
 * {@link namedExportRejectionHints} is that missing half, and the
 * `namedExports` returned here is the provenance it reads.
 *
 * ⚠️ Two further shapes, measured on this tree rather than reasoned about.
 * They are documented on the config-authoring docs page so an author can
 * recognise them; ⛔ neither is a pattern to rely on:
 *
 *  - a named export whose name IS a declared stack key the default does not
 *    carry is merged in and ACCEPTED — that is the `onEnable` / `functions`
 *    path, and nothing distinguishes a deliberate hook from a stray export
 *    that happens to collide with a collection name;
 *  - a named export whose name the default export ALREADY carries is still
 *    dropped — the default's value wins — but it is no longer dropped
 *    **silently** (#18419). A second `export const objects = [...]` beside a
 *    `defineStack({ objects })` is not a second declaration, it is a value
 *    nothing ever reads, and the loader now says so on stderr and records it in
 *    {@link LoadedConfig.shadowedNamedExports}. Keep every stack key inside
 *    `defineStack()`.
 */
export async function loadConfig(source?: string, options?: LoadConfigOptions): Promise<LoadedConfig> {
  const absolutePath = resolveConfigPath(source);
  const start = Date.now();

  const { mod } = await bundleRequire({
    filepath: absolutePath,
    external: BUNDLE_REQUIRE_EXTERNALS,
    ...(options?.authoredSource
      ? { esbuildOptions: { plugins: [authoredSourcePlugin(absolutePath)] } }
      : {}),
  });

  const baseConfig = mod.default || mod;
  if (!baseConfig) {
    throw new Error(`No default export found in ${path.basename(absolutePath)}`);
  }

  // [#20367 ruling B] Read the producer's mark off the default export ITSELF,
  // before the merge below spreads it into a new object and drops it (the mark
  // is non-enumerable by design). `mod` stands in for a missing default, and a
  // module namespace never carries the mark.
  const stackProvenance = hasStackProvenance(baseConfig);
  // The producer's conversion record rides beside the mark and is dropped by
  // the same spread, so it is read here too, off the same value.
  const stackConversions = stackConversionsOf(baseConfig);
  // `authoredSource`: the stack as WRITTEN. An accepted `defineStack` call has
  // already converted its result at load, so the chain starts from the
  // argument the shim kept beside it. Read off the same value for the same
  // reason: the spread below drops the non-enumerable record too.
  const authoredBase = options?.authoredSource ? authoredArgumentOf(baseConfig) : baseConfig;

  // Preserve named exports (e.g. the `onEnable` runtime hook and `functions`)
  // alongside the default-exported stack. Module-namespace named exports are
  // otherwise dropped when we unwrap `mod.default`, which prevents AppPlugin
  // from invoking runtime hooks.
  //
  // ⛔ This loop is what makes EVERY named export a top-level stack key — see
  // this function's header for the rule and for the two shapes it has that an
  // author cannot see from here. `namedExports` records the names it merged so
  // the refusal several steps downstream can say where the key came from; it is
  // a reading, and changes nothing about which configs load.
  const namedExports: string[] = [];
  const shadowedNamedExports: string[] = [];
  const config = (baseConfig === mod || mod.default == null)
    ? authoredBase
    : (() => {
        const merged: any = { ...(authoredBase as Record<string, unknown>) };
        for (const key of Object.keys(mod)) {
          if (key === 'default') continue;
          // ⛔ `hasOwnProperty`, never `key in merged` (#18419). `in` walks the
          // PROTOTYPE chain, so every `Object.prototype` member answered true
          // for a default export carrying no such key at all: `export const
          // toString = …` was skipped here and therefore never reached the
          // strict parse that refuses an undeclared stack key by name. Measured
          // on this tree, that turned the loud refusal `ProbeNamedExport` gets
          // into an exit-0 build — a spelling-dependent hole in the rule this
          // function's header states, not a property anything wanted.
          if (Object.prototype.hasOwnProperty.call(merged, key)) {
            shadowedNamedExports.push(key);
            continue;
          }
          merged[key] = (mod as any)[key];
          namedExports.push(key);
        }
        return merged;
      })();

  // The drop is REPORTED, never swallowed — see {@link shadowedNamedExportWarning}
  // for why it is an advisory on stderr rather than a refusal, and why it is
  // rendered here rather than by each of the twelve commands that load a config.
  if (shadowedNamedExports.length > 0) {
    const [headline, ...hints] = shadowedNamedExportWarning(shadowedNamedExports);
    printWarningToStderr(headline);
    for (const hint of hints) console.error(chalk.dim(hint));
  }

  return {
    config,
    absolutePath,
    duration: Date.now() - start,
    namedExports,
    shadowedNamedExports,
    stackProvenance,
    stackConversions,
  };
}

/**
 * The lines that turn a strict-stack `unrecognized_keys` refusal into the RULE
 * it enforces, for the keys that got there by being named exports of the config
 * module (#18171).
 *
 * ## What the refusal already says, and what it cannot say
 *
 * `ObjectStackDefinitionSchema` is closed, so an undeclared top-level key is
 * refused by name, with the surface named and the closest declared key
 * suggested. Measured on this tree, an `export const ProbeNamedExport = [1, 2,
 * 3]` appended to an otherwise valid config produces exactly that:
 *
 * ```console
 *   ✗ Validation failed
 *     unrecognized_keys: Unrecognized key(s) on this stack definition: `ProbeNamedExport`.
 * ```
 *
 * That diagnostic is good and this does not touch it. What it cannot reach is
 * the author's actual question — *I never wrote `ProbeNamedExport` inside
 * `defineStack()`, so why is the stack schema judging it?* The schema is handed
 * an object and has no idea one of its keys was a named export a step earlier;
 * {@link loadConfig} is the only place that knows, which is why the explanation
 * is assembled here rather than widened into the spec's error map.
 *
 * ## Why this is a hint and not a refusal
 *
 * ⛔ Nothing here changes what the build accepts. The key is still merged, still
 * reaches the strict parse, and is still refused there — the same run, the same
 * exit code, the same `--json` payload, which is deliberately left untouched so
 * this adds no field to a published envelope. The loud named refusal is the
 * property that makes this class of mistake cheap; the hint only tells the
 * author which of their two files to edit.
 *
 * ## Scope of the match
 *
 * Root-path `unrecognized_keys` issues only, intersected with the names
 * {@link loadConfig} actually merged. A key an author wrote inside
 * `defineStack()` is refused with no hint attached, because for that key the
 * existing message is already the whole truth. An offending key that is BOTH
 * (spelled in the object and exported) cannot exist: the merge skips any name
 * the default export already carries.
 *
 * @param issues the `ZodError.issues` of the failed stack parse
 * @param namedExports {@link LoadedConfig.namedExports} from the same run
 * @returns dim lines to print under the formatted errors, or `[]`
 */
export function namedExportRejectionHints(
  issues: readonly unknown[],
  namedExports: readonly string[],
): string[] {
  if (namedExports.length === 0) return [];
  const merged = new Set(namedExports);

  const offenders: string[] = [];
  for (const issue of issues) {
    const i = issue as { code?: unknown; path?: unknown; keys?: unknown };
    if (i.code !== 'unrecognized_keys') continue;
    // The stack definition is the ROOT of this parse, so its own unrecognised
    // keys carry an empty path. A nested one (a key inside an object, a view, a
    // package body) is a different surface with a different explanation, and
    // reaching it from here would attribute an authoring mistake to a merge
    // that never touched it.
    if (!Array.isArray(i.path) || i.path.length > 0) continue;
    if (!Array.isArray(i.keys)) continue;
    for (const key of i.keys) {
      if (typeof key === 'string' && merged.has(key) && !offenders.includes(key)) {
        offenders.push(key);
      }
    }
  }
  if (offenders.length === 0) return [];

  const one = offenders.length === 1;
  const list = offenders.map((k) => `\`${k}\``).join(', ');
  return [
    `  ${list} ${one ? 'is a NAMED EXPORT' : 'are NAMED EXPORTS'} of your config file, `
      + `${one ? 'it is not a key' : 'not keys'} written inside defineStack().`,
    '  The config file is loaded as a MODULE: every named export is merged onto the default-exported',
    '  stack as a top-level key, so a named export is legal only when its name is a key the stack',
    '  schema declares. A helper exported beside the stack is read as a stack key, and refused above.',
    `  Fix: move ${one ? 'it' : 'them'} into a sibling module (e.g. objectstack.composition.ts) and import `
      + `${one ? 'it' : 'them'} here.`,
  ];
}

/**
 * The advisory {@link loadConfig} prints when the module/stack merge DROPPED a
 * named export because the default-exported stack already declares that key
 * (#18419).
 *
 * ## What was wrong
 *
 * The drop itself is correct — one key, one value, and the default export is
 * the base. What was wrong is that it happened **silently**: `os build` exited
 * 0, the artifact carried the default's value, and the authored export reached
 * no log at any level. An author who wrote `export const objects = [row]`
 * beside a `defineStack({ objects })` shipped an artifact without `row` in it
 * and had nothing to read that said so.
 *
 * ## Why an advisory and not a refusal
 *
 * Decided from this package's own repairs of this exact class, not from taste:
 *
 *  - **#3786 / #11643 — "Undeclared authoring keys — dropped at load".** The
 *    same shape (a build that exits 0 while quietly dropping an authored
 *    value), and `compile.ts` states the disposition in its own comment:
 *    *"Advisory, never fatal."* It is surfaced on the text face and in the
 *    `--json` `warnings` payload, never by failing the run.
 *  - **#4095 — `graftRuntimeMembers`' `orphaned`.** An authored `onEnable` that
 *    finds no bundle to land on is "reported rather than dropped, which is the
 *    failure mode that made this invisible for so long" — `os serve` prints
 *    `⚠ … exports onEnable but no app bundle claimed it` and keeps serving.
 *  - **#18171 — the sibling half of this very loop.** It added the explanation
 *    for a merged-then-refused key and spent nothing on the accept set.
 *
 * A refusal would also have to live in {@link loadConfig} to reach every face,
 * and two of those faces are the ones that exist to read a config the current
 * schema is unhappy with: `os doctor` diagnoses broken projects, and
 * `os migrate meta` is entitled to read PAST a rejection
 * ({@link authoredSourcePlugin}) — a loader-level throw is not something its
 * `authoredSource` option can shim away. Refusing here would close the upgrade
 * path against exactly the legacy configs a collision is most likely to sit in.
 *
 * ## Why it renders on stderr, from the loader
 *
 * {@link loadConfig} is handed no `--json` flag (this file's
 * {@link resolveConfigPath} header states the same fact for the same reason),
 * and twelve commands call it. Printing from the loader is what puts the
 * finding on all twelve faces at once instead of the two that happen to handle
 * named exports today; sending it to **stderr** is what keeps a `--json` run's
 * stdout a single parseable document — the shape {@link refuseConfig} already
 * established here, minus the throw. See {@link printWarningToStderr}.
 *
 * @param shadowed {@link LoadedConfig.shadowedNamedExports}, non-empty
 * @returns the headline first, then the dim lines printed under it
 */
export function shadowedNamedExportWarning(shadowed: readonly string[]): string[] {
  const one = shadowed.length === 1;
  const list = shadowed.map((k) => `\`${k}\``).join(', ');
  return [
    `${list} ${one ? 'is a named export that was DROPPED' : 'are named exports that were DROPPED'} `
      + `— the default-exported stack already declares ${one ? 'that key' : 'those keys'}`,
    '  The config file is loaded as a MODULE: every named export is merged onto the default-exported',
    '  stack as a top-level key, and a key the default export already carries KEEPS the default value,',
    `  so the exported ${one ? 'value is' : 'values are'} read by nothing — not this build, not any other.`,
    `  Fix: declare each stack key once — move the value inside defineStack({ … }), or delete the `
      + `named export${one ? '' : 's'}.`,
  ];
}

/**
 * Check whether a file exists at the given path (relative to cwd).
 */
export function configExists(name: string = 'objectstack.config.ts'): boolean {
  return fs.existsSync(path.resolve(process.cwd(), name));
}
