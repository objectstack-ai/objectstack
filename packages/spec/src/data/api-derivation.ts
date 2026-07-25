// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * API-method derivation — the spec's ONE source of truth for turning an
 * object's `enable.apiMethods` whitelist into the effective set of operations
 * the automatic API exposes (issue #3391, design in #3026).
 *
 * ## The contract (one sentence)
 *
 * The server is the only adjudicator: each object's effective operation set is
 * resolved from **six primitives** (`get/list/create/update/delete/bulk`) by a
 * single derivation table here — `undefined` = fully open, `[]` = fully closed,
 * a subset = tightened — and every gate (REST, dispatcher, `/me/permissions`
 * annotation, managed-write clamp) consumes THIS table. The frontend renders
 * only the effective result the server hands down; it never reads the raw
 * `apiMethods` nor derives anything itself.
 *
 * ## Two orthogonal axes
 *
 * This module is the **API-tightening axis** (verb → *primitive*): what the
 * automatic API will admit. It is deliberately NOT the same as the UI-intent
 * axis (verb → *affordance*) that `resolveCrudAffordances` /
 * `MANAGED_WRITE_VERB_AFFORDANCE` (objectql `registry.ts`) and
 * `WRITE_OP_AFFORDANCE` (plugin-security `system-write-guard.ts`) implement.
 * Merging the two would blur an authoring-intent (UX affordance) concern into a
 * security (API exposure) concern; they stay separate tables. See ADR-0103.
 *
 * ## Three-state semantics of `apiMethods`
 *
 * | value        | mode           | meaning                                   |
 * |--------------|----------------|-------------------------------------------|
 * | `undefined`  | `unrestricted` | every operation is exposed (default-open) |
 * | `[]`         | `deny-all`     | no operation is exposed (fully closed)    |
 * | `[..subset]` | `restricted`   | only the derived closure of the subset    |
 *
 * ## Derived verbs are never declared standalone
 *
 * The legacy 8 values (`upsert/aggregate/history/search/restore/purge/import/
 * export`) are DERIVED from the primitives — an author who whitelists
 * `['create','update']` gets `upsert`/`import` for free; one who whitelists
 * `['list']` gets `aggregate`/`export`/`search` for free. A standalone legacy
 * value in a whitelist is honored verbatim for one release ("explicit wins",
 * with a registration-time deprecation warning) but is slated for removal in
 * the enum-shrink (P2 of #3391).
 */

import { ApiMethod } from './object.zod';

/**
 * The six irreducible API primitives. Every effective operation is derived
 * from a subset of these — they are the only values an author needs to declare.
 */
export const API_PRIMITIVES = ['get', 'list', 'create', 'update', 'delete', 'bulk'] as const;
export type ApiPrimitive = (typeof API_PRIMITIVES)[number];

/**
 * The eight legacy values that are DERIVED from primitives. Declaring one
 * standalone is deprecated (still honored one release; see
 * `warnDeprecatedExplicitApiMethods` in objectql `registry.ts`).
 */
export const LEGACY_API_METHODS = [
  'upsert', 'aggregate', 'history', 'search', 'restore', 'purge', 'import', 'export',
] as const;
export type LegacyApiMethod = (typeof LEGACY_API_METHODS)[number];

const PRIMITIVE_SET: ReadonlySet<string> = new Set(API_PRIMITIVES);
const LEGACY_SET: ReadonlySet<string> = new Set(LEGACY_API_METHODS);

export function isApiPrimitive(v: string): v is ApiPrimitive {
  return PRIMITIVE_SET.has(v);
}
export function isLegacyApiMethod(v: string): v is LegacyApiMethod {
  return LEGACY_SET.has(v);
}

/**
 * The exposure-relevant slice of an object's `enable` block. Kept loose so both
 * the runtime (which may hand a flat legacy shape) and authored schemas satisfy
 * it. Only `apiMethods` and the feature flags (`searchable`, `trackHistory`)
 * participate in derivation.
 */
export interface EnableLike {
  apiEnabled?: boolean;
  apiMethods?: readonly ApiMethod[] | readonly string[] | null;
  searchable?: boolean;
  trackHistory?: boolean;
  [key: string]: unknown;
}

/** A single derivation rule: which primitives a legacy verb needs, plus a flag gate. */
interface DerivationRule {
  /** ALL listed primitives must be granted (default relation). */
  all?: readonly ApiPrimitive[];
  /** ANY listed primitive suffices — used for the coarse `import` judgement. */
  any?: readonly ApiPrimitive[];
  /** Schema feature flag that must also hold, e.g. `searchable`/`trackHistory`. */
  flag?: (enable: EnableLike) => boolean;
}

/**
 * The derivation table — the spec's single source of truth.
 *
 * - `import` is `any: [create, update]` as a COARSE gate; the precise judgement
 *   is refined by `writeMode` in {@link isApiOperationAllowed}
 *   (insert→create, update→update, upsert→create∧update).
 * - `export` is `list`, additionally gated by the user-level export slot
 *   (`ResolveApiOptions.userExportAllowed`, always `true` this phase — the real
 *   permission bit is a follow-up, wiring it changes no contract here).
 * - `restore`/`purge` map to `delete` but their flag is permanently `false`:
 *   `enable.trash` was retired (#2377/ADR-0049) with no runtime consumer, so
 *   there is no soft-delete state to restore/purge. They return as live derived
 *   verbs only if/when a real recycle bin ships (#1893).
 */
export const API_METHOD_DERIVATION: Record<LegacyApiMethod, DerivationRule> = {
  upsert: { all: ['create', 'update'] },
  import: { any: ['create', 'update'] },
  export: { all: ['list'] },
  aggregate: { all: ['list'] },
  search: { all: ['list'], flag: (e) => e.searchable !== false },
  history: { all: ['get'], flag: (e) => e.trackHistory === true },
  restore: { all: ['delete'], flag: () => false },
  purge: { all: ['delete'], flag: () => false },
};

/**
 * Alias table normalizing the two runtime vocabularies onto the canonical
 * {@link ApiMethod} operation names:
 * - runtime `callData` actions (`query`/`find`→`list`, `batch`→`bulk`);
 * - REST operation literals (already canonical, listed for completeness).
 *
 * Actions with no entry are passed through unchanged and, if unrecognized by
 * the resolver, treated as ungated (custom actions were never gated by
 * `apiMethods`).
 */
export const DATA_ACTION_TO_API_OPERATION: Record<string, ApiMethod> = {
  // runtime callData actions
  get: 'get',
  query: 'list',
  find: 'list',
  list: 'list',
  create: 'create',
  update: 'update',
  delete: 'delete',
  batch: 'bulk',
  bulk: 'bulk',
  // legacy / derived operation literals (identity)
  upsert: 'upsert',
  aggregate: 'aggregate',
  history: 'history',
  search: 'search',
  restore: 'restore',
  purge: 'purge',
  import: 'import',
  export: 'export',
};

/** Options that widen/narrow derivation at resolve time. */
export interface ResolveApiOptions {
  /**
   * User-level export permission slot. `export` derives from `list` AND this
   * flag. Always `true` this phase (there is no user-level export permission
   * bit yet); wiring a real bit in is a zero-contract change (#3391 follow-up).
   */
  userExportAllowed?: boolean;
}

export type ApiMethodsMode = 'unrestricted' | 'restricted' | 'deny-all';

/**
 * The resolved, effective view of an object's API exposure. Carries both the
 * granted primitives and the explicitly-declared legacy values so callers can
 * distinguish "derived" from "author asked for it" (needed by import `writeMode`
 * precision and bulk∧child), and a pre-computed `operations` closure for
 * serialization to the 405 body / `/me/permissions`.
 */
export interface EffectiveApiMethods {
  mode: ApiMethodsMode;
  /** Granted primitives (subset of {@link API_PRIMITIVES}). */
  primitives: ReadonlySet<ApiPrimitive>;
  /** Legacy values the author declared explicitly (honored verbatim, deprecated). */
  explicitLegacy: ReadonlySet<LegacyApiMethod>;
  /** Full effective operation closure (primitives ∪ derived ∪ explicit legacy). */
  operations: ReadonlySet<ApiMethod>;
  /** The user-level export slot captured at resolve time. */
  userExportAllowed: boolean;
}

/** Whether a legacy verb is derivable from the given primitives + flags. */
function isLegacyDerivable(
  legacy: LegacyApiMethod,
  primitives: ReadonlySet<ApiPrimitive>,
  enable: EnableLike,
  userExportAllowed: boolean,
): boolean {
  const rule = API_METHOD_DERIVATION[legacy];
  if (rule.flag && !rule.flag(enable)) return false;
  if (legacy === 'export' && !userExportAllowed) return false;
  if (rule.all) return rule.all.every((p) => primitives.has(p));
  if (rule.any) return rule.any.some((p) => primitives.has(p));
  return false;
}

/** Compute the full effective operation closure for a resolved state. */
function computeOperations(
  mode: ApiMethodsMode,
  primitives: ReadonlySet<ApiPrimitive>,
  explicitLegacy: ReadonlySet<LegacyApiMethod>,
  enable: EnableLike,
  userExportAllowed: boolean,
): Set<ApiMethod> {
  const ops = new Set<ApiMethod>();
  if (mode === 'deny-all') return ops;
  for (const p of primitives) ops.add(p);
  for (const l of explicitLegacy) ops.add(l); // explicit wins
  for (const legacy of LEGACY_API_METHODS) {
    if (ops.has(legacy)) continue;
    if (isLegacyDerivable(legacy, primitives, enable, userExportAllowed)) ops.add(legacy);
  }
  return ops;
}

/**
 * Resolve an object's `enable` block into its effective API exposure. Pure and
 * silent (the deprecation warning for explicit legacy values fires only at
 * registration time — see objectql `registry.ts`).
 *
 * @param enable The object's `enable` capability block (or `undefined`).
 * @param opts   Resolve-time options (e.g. the user-level export slot).
 */
export function resolveEffectiveApiMethods(
  enable?: EnableLike | null,
  opts?: ResolveApiOptions,
): EffectiveApiMethods {
  const userExportAllowed = opts?.userExportAllowed !== false;
  const e: EnableLike = enable ?? {};
  const raw = e.apiMethods;

  // undefined / non-array → unrestricted (default-open, every operation).
  if (raw == null || !Array.isArray(raw)) {
    const primitives = new Set<ApiPrimitive>(API_PRIMITIVES);
    const explicitLegacy = new Set<LegacyApiMethod>();
    const operations = computeOperations('unrestricted', primitives, explicitLegacy, e, userExportAllowed);
    return { mode: 'unrestricted', primitives, explicitLegacy, operations, userExportAllowed };
  }

  // [] → deny-all (fully closed). This is the flipped semantics of #3391: an
  // empty whitelist means "expose nothing", not "no restriction".
  if (raw.length === 0) {
    return {
      mode: 'deny-all',
      primitives: new Set<ApiPrimitive>(),
      explicitLegacy: new Set<LegacyApiMethod>(),
      operations: new Set<ApiMethod>(),
      userExportAllowed,
    };
  }

  // subset → restricted. Partition the declared values into granted primitives
  // and explicitly-declared legacy values.
  const primitives = new Set<ApiPrimitive>();
  const explicitLegacy = new Set<LegacyApiMethod>();
  for (const m of raw) {
    const v = String(m);
    if (isApiPrimitive(v)) primitives.add(v);
    else if (isLegacyApiMethod(v)) explicitLegacy.add(v);
  }
  const operations = computeOperations('restricted', primitives, explicitLegacy, e, userExportAllowed);
  return { mode: 'restricted', primitives, explicitLegacy, operations, userExportAllowed };
}

/** Extra context for a single operation check. */
export interface OperationCheckOptions {
  /**
   * Import write mode (`insert`/`update`/`upsert`), used to refine the coarse
   * `import` derivation into a precise one. Ignored for non-import operations.
   */
  writeMode?: string;
  /**
   * For a bulk request, the child operation being batched (`create`/`update`/
   * `delete`, or `upsert`). When set on a `bulk` check, the object must grant
   * the `bulk` primitive AND the child operation must itself be allowed.
   */
  bulkChild?: string;
}

/**
 * Decide whether a single operation is allowed for a resolved effective state.
 *
 * @param eff       The resolved effective methods (from {@link resolveEffectiveApiMethods}).
 * @param operation A canonical {@link ApiMethod} name (normalize runtime action
 *                  names through {@link DATA_ACTION_TO_API_OPERATION} first).
 * @param opts      `writeMode` (import precision) / `bulkChild` (bulk∧child).
 */
export function isApiOperationAllowed(
  eff: EffectiveApiMethods,
  operation: string,
  opts?: OperationCheckOptions,
): boolean {
  if (eff.mode === 'deny-all') return false;
  const unrestricted = eff.mode === 'unrestricted';

  // bulk ∧ child: the object must grant the `bulk` primitive, and the batched
  // child operation must itself be allowed.
  if (operation === 'bulk' && opts?.bulkChild) {
    if (!unrestricted && !eff.primitives.has('bulk')) return false;
    return isApiOperationAllowed(eff, opts.bulkChild, { writeMode: opts.writeMode });
  }

  if (isApiPrimitive(operation)) {
    return unrestricted || eff.primitives.has(operation);
  }

  if (isLegacyApiMethod(operation)) {
    // Explicitly-declared legacy value → honored verbatim (deprecated).
    if (eff.explicitLegacy.has(operation)) return true;
    // import: refine the coarse any-of into a writeMode-precise judgement.
    // (Unrestricted grants every primitive, so precision is moot → allowed.)
    if (operation === 'import' && opts?.writeMode && !unrestricted) {
      const wm = opts.writeMode;
      if (wm === 'insert') return eff.primitives.has('create');
      if (wm === 'update') return eff.primitives.has('update');
      if (wm === 'upsert') return eff.primitives.has('create') && eff.primitives.has('update');
      // unknown writeMode → fall through to the derived answer below.
    }
    // Otherwise the derived answer. `operations` already folds in the schema
    // flags (searchable/trackHistory) and the permanently-off trash flag, so
    // restore/purge stay closed even for an unrestricted object — the gate
    // decision and the serialized effective set never disagree.
    return eff.operations.has(operation);
  }

  // Unknown/custom operation → not gated by apiMethods (matches prior behavior:
  // actions with no ApiMethod mapping still respect `apiEnabled` only).
  return true;
}

/**
 * The canonical serialization order for effective operations — the declaration
 * order of the {@link ApiMethod} enum. Used for the deterministic 405 `allowed`
 * array and the `/me/permissions` `apiOperations` field.
 */
export const API_METHOD_ORDER: readonly ApiMethod[] = ApiMethod.options;

/**
 * Serialize an effective state's operation closure into a stable, enum-ordered
 * array — the single "effective set" the server hands down (405 body,
 * `/me/permissions`). The frontend consumes this, never the raw whitelist.
 */
export function effectiveOperationsArray(eff: EffectiveApiMethods): ApiMethod[] {
  return API_METHOD_ORDER.filter((m) => eff.operations.has(m));
}
