// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * API-method derivation — the spec's ONE source of truth for turning an
 * object's `enable.apiMethods` whitelist into the effective set of operations
 * the automatic API exposes (issue #3391, design in #3026; enum shrink #3543).
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
 * ## Two vocabularies — authored vs effective (#3543)
 *
 * Since the enum shrink, the AUTHORED vocabulary ({@link ApiMethod}) is the six
 * primitives only. The EFFECTIVE vocabulary ({@link ApiOperation}) is wider: it
 * still carries the eight derived verbs, because the wire contract — the 405
 * `allowed` array, `/me/permissions` `apiOperations`, and the REST/dispatcher
 * gate checks — speaks in operations (`export`, `search`, …), not in authored
 * primitives. Authors write primitives; the server derives and serializes
 * operations. Do not narrow {@link ApiOperation} to {@link ApiMethod}: the
 * frontend gates affordances (e.g. the Export button) on derived verbs being
 * present in the effective set.
 *
 * ## Two orthogonal axes
 *
 * This module is the **API-tightening axis** (verb → *primitive*): what the
 * automatic API will admit. It is deliberately NOT the same as the UI-intent
 * axis (verb → *affordance*) that `resolveCrudAffordances` /
 * `MANAGED_WRITE_VERB_AFFORDANCE` (`./managed-api-affordance`, #7521) and
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
 * A PRESENT but non-array `apiMethods` (only producible by a raw/out-of-band
 * metadata write — the Zod path rejects it) resolves to `deny-all`: a policy
 * that exists but cannot be read fails CLOSED (#3545 residual-risk decision,
 * tightened in the #3543 exposure-semantics window).
 *
 * ## Derived verbs are never declared
 *
 * The legacy 8 values (`upsert/aggregate/history/search/restore/purge/import/
 * export`) are DERIVED from the primitives — an author who whitelists
 * `['create','update']` gets `upsert`/`import` for free; one who whitelists
 * `['list']` gets `aggregate`/`export`/`search` for free. Since #3543 they are
 * no longer part of the authored enum: a stored legacy value is stripped at
 * parse (`stripLegacyApiMethods` in `object.zod.ts`, canonicalize-and-warn)
 * and IGNORED by this resolver on un-parsed inputs — both paths converge on
 * the same effective set.
 */

import {
  ApiMethod,
  API_OPERATION_ORDER,
  LEGACY_API_METHODS,
  type ApiOperation,
  type LegacyApiMethod,
} from './object.zod';

/**
 * The six irreducible API primitives. Every effective operation is derived
 * from a subset of these — they are the only values an author needs to declare.
 * Identical to the {@link ApiMethod} enum since the #3543 shrink.
 */
export const API_PRIMITIVES = ['get', 'list', 'create', 'update', 'delete', 'bulk'] as const;
export type ApiPrimitive = (typeof API_PRIMITIVES)[number];

/**
 * @deprecated Renamed {@link API_OPERATION_ORDER} in the #3543 type split —
 * the order is a property of the effective-operation vocabulary, not of the
 * (now six-value) authored enum. Alias kept for import continuity.
 */
export const API_METHOD_ORDER: readonly ApiOperation[] = API_OPERATION_ORDER;

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
 *   verbs only if/when a real recycle bin ships (#3146, parked).
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
 * Alias table normalizing the two producer vocabularies onto the canonical
 * {@link ApiOperation} names:
 * - runtime `callData` actions — of that closed set only `query`/`find` need
 *   normalizing (both → `list`); `get`/`create`/`update`/`delete`/`aggregate`
 *   are already canonical and map to themselves;
 * - REST operation literals (already canonical, listed for completeness).
 *
 * Actions with no entry are passed through unchanged and, if unrecognized by
 * the resolver, treated as ungated (custom actions were never gated by
 * `apiMethods`).
 *
 * [#6259] The `batch: 'bulk'` row was removed, and the line above no longer
 * calls `batch` a runtime `callData` action. It was the one entry with no
 * producer on either side: `callData` branches on a closed set that has not
 * contained `batch` since that arm was retired (#5856), and every REST caller
 * of `apiAccessDenialFromEnable` passes a canonical literal — including the
 * cross-object `POST /batch` route, which spells `batch` in the URL and gates
 * on `'bulk'`. A row nobody can reach still taught the reader (and any AI
 * author) that `batch` is a live runtime spelling, inviting the consumer-side
 * tolerance for a producer-less alias that Prime Directive #12 forbids. The
 * spelling is `bulk`; a `batch` lookup is now `undefined` and falls to the
 * `?? action` pass-through, exactly like any other unrecognized action.
 */
export const DATA_ACTION_TO_API_OPERATION: Record<string, ApiOperation> = {
  // runtime `callData` actions and REST primitives (identity where canonical)
  get: 'get',
  query: 'list',
  find: 'list',
  list: 'list',
  create: 'create',
  update: 'update',
  delete: 'delete',
  bulk: 'bulk',
  // derived operation literals (identity)
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
 * The resolved, effective view of an object's API exposure. Carries the
 * granted primitives and a pre-computed `operations` closure (primitives ∪
 * derived verbs) for gate checks and serialization to the 405 body /
 * `/me/permissions`.
 */
export interface EffectiveApiMethods {
  mode: ApiMethodsMode;
  /** Granted primitives (subset of {@link API_PRIMITIVES}). */
  primitives: ReadonlySet<ApiPrimitive>;
  /** Full effective operation closure (primitives ∪ derived verbs). */
  operations: ReadonlySet<ApiOperation>;
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
  enable: EnableLike,
  userExportAllowed: boolean,
): Set<ApiOperation> {
  const ops = new Set<ApiOperation>();
  if (mode === 'deny-all') return ops;
  for (const p of primitives) ops.add(p);
  for (const legacy of LEGACY_API_METHODS) {
    if (isLegacyDerivable(legacy, primitives, enable, userExportAllowed)) ops.add(legacy);
  }
  return ops;
}

/**
 * Resolve an object's `enable` block into its effective API exposure. Pure and
 * silent (the strip warning for stored legacy values fires at parse time — see
 * `stripLegacyApiMethods` in `object.zod.ts` — and the per-object diagnostic
 * at registration time in objectql `registry.ts`).
 *
 * Legacy/unknown strings in a raw (un-parsed) whitelist are IGNORED — the same
 * strip semantics the Zod path applies — so a whitelist containing ONLY legacy
 * values resolves to `deny-all` on either path.
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

  // undefined/null → unrestricted (default-open, every operation).
  if (raw == null) {
    const primitives = new Set<ApiPrimitive>(API_PRIMITIVES);
    const operations = computeOperations('unrestricted', primitives, e, userExportAllowed);
    return { mode: 'unrestricted', primitives, operations, userExportAllowed };
  }

  // Present but not an array → fails CLOSED (#3545 tightening, see module
  // docs). Arrays keep only the granted primitives; legacy/unknown strings
  // are ignored (strip semantics).
  const declared = Array.isArray(raw)
    ? new Set<ApiPrimitive>(raw.map((m) => String(m)).filter(isApiPrimitive))
    : new Set<ApiPrimitive>();

  // No granted primitives → deny-all (fully closed) — whether authored `[]`,
  // empty after legacy values were stripped/ignored, or a non-array policy.
  // This is the flipped semantics of #3391: an empty whitelist means "expose
  // nothing", not "no restriction".
  if (declared.size === 0) {
    return {
      mode: 'deny-all',
      primitives: new Set<ApiPrimitive>(),
      operations: new Set<ApiOperation>(),
      userExportAllowed,
    };
  }

  // subset → restricted: the derived closure of the granted primitives.
  const operations = computeOperations('restricted', declared, e, userExportAllowed);
  return { mode: 'restricted', primitives: declared, operations, userExportAllowed };
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
 * @param operation A canonical {@link ApiOperation} name (normalize runtime
 *                  action names through {@link DATA_ACTION_TO_API_OPERATION} first).
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
  // actions with no ApiOperation mapping still respect `apiEnabled` only).
  return true;
}

/**
 * Serialize an effective state's operation closure into a stable array in
 * {@link API_OPERATION_ORDER} — the single "effective set" the server hands
 * down (405 body, `/me/permissions`). The frontend consumes this, never the
 * raw whitelist.
 */
export function effectiveOperationsArray(eff: EffectiveApiMethods): ApiOperation[] {
  return API_OPERATION_ORDER.filter((m) => eff.operations.has(m));
}
