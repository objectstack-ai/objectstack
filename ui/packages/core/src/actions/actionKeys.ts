/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * What an action is allowed to carry — objectstack#4075, all three steps.
 *
 * `ActionDef` used to end with `[key: string]: any`, so it accepted any key of
 * any type. Concretely (objectui#2990): deleting `ActionDef.execute` produced
 * ZERO compile errors even though the field had just been removed, and stale
 * metadata authoring `execute: 'markDone'` type-checked. The same deletion
 * against `@object-ui/types`' `ActionSchema` — which has no index signature —
 * correctly produced `TS2353` at the authoring site. One of the two readers
 * could catch a retired key; the other was structurally incapable.
 *
 * That asymmetry was the issue. An open key set on a DECLARED METADATA CONTRACT
 * is what lets a typo (`targt`, `exectue`) and a tombstoned key (`execute`) both
 * sail through to a runner that then silently does nothing — the objectstack-ai/objectstack#2169 "Mark
 * Done does nothing" shape.
 *
 * This module was step 1 of the staged narrowing: make the key set VISIBLE and
 * warn on anything outside it, without changing a single type. Step 2 promoted
 * the legitimate keys to explicit optional fields; **step 3 removed the index
 * signature**, so `tsc` now rejects a typo or a retired key outright.
 *
 * ── Why this module SURVIVES step 3 ──────────────────────────────────────────
 * Step 1 wrote that the dev-mode warning "can retire" once the index signature
 * came down. Step 3 measured that and kept it, because the two mechanisms cover
 * DISJOINT populations rather than the same one twice:
 *
 *   - `tsc` sees action literals AUTHORED IN CODE. It rejects an unknown key at
 *     the construction site, which is the strongest possible signal — but only
 *     for actions that exist as TypeScript.
 *   - the warning below sees actions that arrive as DATA. objectstack#3903
 *     established that stored `sys_metadata` rows are rehydrated UNPARSED, so
 *     authored metadata reaches `runner.execute()` as a plain object no
 *     compiler ever looked at. That is the population `execute: 'markDone'`
 *     actually lives in, and no type can reach it.
 *
 * Retiring the warning would therefore have re-opened the runtime half of the
 * gap while closing the compile-time half — which is why `executeScript`'s
 * rename-prescription branch also survives, for the same rows and the same
 * reason. What DID retire with the index signature is the inverted pin in
 * `actionKeys.pin.test.ts` that asserted the signature was still there; it now
 * asserts the opposite, which was always its stated completion condition.
 *
 * The lists are pinned by `__tests__/actionKeys.pin.test.ts`, which re-derives
 * each one from its actual source. A hand-maintained list that drifts from the
 * interface it mirrors would be the same "declared ≠ enforced" trap this whole
 * thread is about.
 *
 * ── What the inventory found, and what step 2 did with it ────────────────────
 * Step 1 found `ActionDef` declaring 34 keys against the spec `ActionSchema`'s
 * 36, overlapping on 17. The two halves of the difference were different
 * problems, and step 2 (objectstack#4075) treated them differently:
 *
 * 18 keys the SPEC owns that `ActionDef` never declared — `ai`, `aria`,
 * `bodyExtra`, `bodyShape`, `bulkEnabled`, `component`, `icon`, `locations`,
 * `mode`, `objectName`, `order`, `recordIdField`, `recordIdParam`,
 * `requiredPermissions`, `requiresFeature`, `shortcut`, `variant`, `visible`.
 * These are authored today and used to reach readers through the index
 * signature. **Step 2 promoted all 18 to explicit optional fields**, typed by
 * DERIVATION from `@objectstack/spec`'s `ActionInput` rather than by hand-copied
 * shapes. The `as any` casts `ActionEngine` needed to read `visible`,
 * `locations` and `requiredPermissions` are gone with them — those casts existed
 * only because the fields were undeclared.
 *
 * Two of the 18 landed as `undefined` rather than as usable types, which is the
 * correct outcome: spec 17 retired `shortcut` and `bulkEnabled` as `retiredKey()`
 * tombstones (`z.never()`), so deriving turns "authoring this is a parse
 * rejection" into a compile error at no cost. Hand-copying would have quietly
 * re-legitimized two dead keys — which is why the types are derived.
 *
 * 16 keys `ActionDef` declares that the spec does not own — `actionType`, `api`,
 * `chain`, `chainMode`, `close`, `condition`, `confirm`, `endpoint`, `modal`,
 * `navigate`, `onClick`, `onFailure`, `redirect`, `reload`, `toast`,
 * `actionParams`. (`onSuccess` was the 17th until objectui#5934 retired the
 * runner's chained-callback meaning; the key is now spec-owned and derived,
 * like the 18 below.) Step 2 marked `@deprecated`, with the spec spelling to use
 * instead, ONLY the four the runner itself proves are aliases: `actionType` (→
 * `type`), `api` and `endpoint` (→ `target`; `executeAPI` resolves
 * `api || endpoint || target`), and `navigate` (→ flat `target`/`openIn`;
 * `executeNavigation` already falls back to them). The rest are runner mechanics
 * with no spec counterpart — chaining, toasts, post-execution reload/close — and
 * deprecating them toward a spelling that does not exist would be worse than
 * leaving them declared.
 *
 * ── What step 3 found the first two steps had missed ─────────────────────────
 * Deleting the index signature is the only thing that can name the keys still
 * hiding behind it, and it named five, in two groups:
 *
 * `to` / `external` / `newTab` / `replace` — the `navigation` alias's own
 * spelling. Step 1 had already ruled these legitimate and listed them below in
 * {@link NAVIGATION_ALIAS_KEYS}, but step 2's scope was the SPEC-owned keys, so
 * they were declared as data and never as fields; `executeNavigation` read them
 * through the index signature. Promoted, and deliberately not `@deprecated` —
 * step 2's acceptance ruled on exactly that point.
 *
 * `description` — objectui vocabulary from `@object-ui/types`' renderer view of
 * an action, forwarded by all four action renderers (`check:action-forward-parity`
 * requires it) and read by the param-collection dialog for its subtitle
 * (objectui#4192). Authorable, forwarded, read — and undeclared. These were the
 * only two `TS2353`s the deletion produced across the whole workspace.
 */

/**
 * Every property `ActionDef` declares, in declaration order.
 *
 * Kept as data because TypeScript types do not survive to runtime — `keyof
 * ActionDef` is erased along with the interface, so it cannot hand a runtime
 * classifier a list of anything. `actionKeys.pin.test.ts` re-derives this one
 * from the interface's AST, which is what keeps the data true.
 */
export const ACTION_DEF_KEYS = [
  'type',
  'actionType',
  'name',
  'label',
  // Promoted by step 3 — objectui vocabulary (`@object-ui/types`' renderer view
  // of an action), forwarded by all four action renderers and read by the
  // param-collection dialog, but never declared on `ActionDef`.
  'description',
  'confirmText',
  'confirm',
  'condition',
  'disabled',
  'api',
  'endpoint',
  'method',
  'navigate',
  // The `navigation` alias's own spelling, promoted to real fields by step 3.
  // Listed a second time in `NAVIGATION_ALIAS_KEYS` below, which keeps the
  // separate fact that these four are objectui dialect with a spec-adoption
  // tripwire; this list is only "what the interface declares".
  'to',
  'external',
  'newTab',
  'replace',
  'onClick',
  'reload',
  'close',
  'redirect',
  'toast',
  'successMessage',
  'errorMessage',
  'refreshAfter',
  'undoable',
  'params',
  'actionParams',
  'resultDialog',
  'target',
  'body',
  'openIn',
  'modal',
  'chain',
  'chainMode',
  'onFailure',
  'opensInNewTab',
  'newTabUrl',
  // Promoted out of the index signature by objectstack#4075 step 2 — the 18 keys
  // the spec owns that `ActionDef` had never declared. Their types are derived
  // from `@objectstack/spec`'s `ActionInput`, so this list is the only
  // hand-maintained half, and `actionKeys.pin.test.ts` re-derives it from the
  // interface's AST.
  'locations',
  'visible',
  'requiredPermissions',
  'icon',
  'variant',
  'order',
  'component',
  'objectName',
  'ai',
  // `aria` left this list, with its `ActionDef` field, when `@objectstack/spec`
  // 17.5.0 retired `action.aria` as a `retiredKey()` tombstone (objectui#10929):
  // the derived type had become `undefined`, so the field mirrored nothing. It
  // stays in `SPEC_ACTION_KEYS` below, because `ActionSchema` still declares the
  // tombstone.
  'bodyExtra',
  'bodyShape',
  // The declarative single-record field write (spec 17.3.0). Promoted from
  // inventory-only to declared `ActionDef` fields when the runner learned to
  // read them — the branch that dispatches `operation: 'update'` on the
  // platform action route, ahead of `type`.
  'operation',
  'patch',
  'mode',
  'recordIdField',
  'recordIdParam',
  'requiresFeature',
  // Moved from the runner-native cluster above by objectui#5934: the legacy
  // chained-callback meaning is retired and the key's type now derives the
  // spec's `{ navigate, openIn }` block.
  'onSuccess',
  // Spec 17.6.0's success copy per handler outcome (objectui#11344), declared
  // when the runner learned to read it: the success toast's first rung.
  'outcomeMessages',
  'shortcut',
  'bulkEnabled',
] as const;

/**
 * Every property `@objectstack/spec`'s `ActionSchema` declares.
 *
 * `ActionDef` mirrors that schema, so a key the spec owns is legitimate even
 * when `ActionDef` has not declared it yet — several are read today only through
 * an `as any` cast (`visible` and `locations` in `ActionEngine`), which is the
 * cast this list exists to eventually retire.
 *
 * Pinned rather than read off the schema at runtime: the spec exports
 * `ActionSchema` as a lazy proxy that does not forward `.shape`, so resolving it
 * means walking zod internals (`_def.in` / `_def.innerType`). That is fine in a
 * test and wrong in shipped code — `@object-ui/types` made the same call for
 * `ActionComponent`. The pin test does the walk and fails the day this drifts.
 */
export const SPEC_ACTION_KEYS = [
  // The package-lock / provenance envelope, added to `ActionSchema` in spec
  // 17.0.0-rc.2. Not authorable action vocabulary — it is stamped on a record
  // that came from an installed package — but it IS declared by the schema, so
  // an action carrying it must not be reported as having unknown keys.
  '_lock',
  '_lockDocsUrl',
  '_lockReason',
  '_lockSource',
  '_packageId',
  '_packageVersion',
  '_provenance',
  'ai',
  'aria',
  'body',
  'bodyExtra',
  'bodyShape',
  'bulkEnabled',
  'component',
  'confirmText',
  // Added to `ActionSchema` in @objectstack/spec 17.0.0-rc.6. Listed here purely
  // because this array's contract is "every property the spec's `ActionSchema`
  // declares" — restating the spec, not adopting a feature. `ActionDef` does NOT
  // declare `description` and is not changed: whether the runner or any renderer
  // should READ it is a separate question, and `actionKeys.pin.test.ts`'s
  // `ActionDef` half stays green without it. What this entry buys is that an
  // action carrying a `description` is no longer reported as having an unknown
  // key, which is the only thing the inventory is consulted for.
  'description',
  'disabled',
  'errorMessage',
  'execute',
  // Added to `ActionSchema` in @objectstack/spec 17.5.0 (objectui#11073): the
  // bulk dispatch contract the action's body is written for, in
  // `bulkActionDefs`' own `'perRecord' | 'aggregate'` vocabulary. Listed for the
  // reason `description` is — this array restates the spec's declared keys, so
  // an action carrying it is not reported as having an unknown key. `ActionDef`
  // does NOT declare it and the runner does not read it: the spec's own
  // enforcement is `@objectstack/lint`'s authoring-time check.
  'execution',
  'icon',
  'label',
  'locations',
  'method',
  'mode',
  'name',
  'newTabUrl',
  'objectName',
  // Declared by `ActionSchema` as of @objectstack/spec 17.1.0 (objectui#5328).
  // All four declared action surfaces forward it since objectui#5493/#6304, and
  // `ActionDef` derives its type from the spec since objectui#5934 retired the
  // runner's legacy chained-callback meaning for the same key.
  'onSuccess',
  'openIn',
  'opensInNewTab',
  // Added to `ActionSchema` in @objectstack/spec 17.3.0 (objectui#7122), the
  // declarative single-record field write that mirrors a list view's
  // `bulkActionDefs`: `operation: 'update'` applies `patch` (merged UNDER the
  // collected `params`) to the current record on the data plane AS THE CALLER.
  //
  // Both keys were inventory-ONLY when that bump landed, under the maintainer's
  // 2026-09-05 ruling on it ("record both as justified omissions now; forward
  // only the key a runtime actually reads, once its semantics are read from
  // upstream — no speculative forwarding"). That condition is now met: the
  // runner reads both (`executeUpdateOperation`, dispatched ahead of `type`),
  // `ActionDef` declares both, and every action surface forwards them — which
  // is what `check:action-forward-parity` now requires rather than excuses.
  'operation',
  'order',
  // Added to `ActionSchema` in @objectstack/spec 17.6.0 (objectstack#21095,
  // objectui#11344): success copy per handler outcome, keyed by the snake_case
  // `outcome` the handler returns. `ActionDef` declares it (derived) and the
  // runner reads it as the success toast's first rung, ahead of
  // `successMessage`.
  'outcomeMessages',
  'params',
  'patch',
  'recordIdField',
  'recordIdParam',
  'refreshAfter',
  'requiredPermissions',
  'requiresFeature',
  // Added to `ActionSchema` in @objectstack/spec 17.7.0 (objectui#11717): the
  // organization endpoint (a `MEMBERSHIP_REACH` row) whose membership-grade gate
  // the action follows, which the spec's parse LOWERS into `visible` over
  // `current_user.positions` (the same transform that lowers `requiresFeature`
  // above). Listed for the reason `description` is — this array restates the
  // spec's declared keys, so an action carrying it is not reported as having an
  // unknown key. `ActionDef` does NOT declare it and the runner does not read
  // it; whether it should, beside `requiresFeature`, is not this inventory's
  // question.
  'requiresMembershipReach',
  'resultDialog',
  'shortcut',
  'successMessage',
  'target',
  'type',
  'undoable',
  'variant',
  'visible',
] as const;

/**
 * The `navigation` alias's own spelling of a target, read off the action itself
 * when no nested `navigate` object is present (`ActionRunner.executeNavigation`).
 *
 * A declared objectui-side dialect, not spec vocabulary: `replace` is documented
 * at its read site as "the one thing the `navigation` shape carries that
 * `ActionSchema` has no field for". Listing it here is what keeps it from being
 * silent dialect — the alternative is a warning that cries wolf on a shape the
 * runner itself supports.
 */
export const NAVIGATION_ALIAS_KEYS = ['to', 'external', 'newTab', 'replace'] as const;

/**
 * Keys a HOST composes on the DISPATCH OBJECT at dispatch time — chrome the
 * runtime reads once on its way to the dialog, that no author ever writes and
 * no store ever holds.
 *
 * Distinct from every other list in this module, and the distinction is the
 * whole point: each of the three lists above restates one AUTHORED surface —
 * what `ActionDef` itself declares, what the spec's `ActionSchema` declares,
 * and the `navigation` alias's objectui dialect — so a key joining one of them
 * is a key an author may legally write. This list claims no such derivation and
 * must not acquire one: a key here is the opposite, and writing it in metadata
 * is still a compile error that must stay one. Maintainer ruling
 * 2026-08-22 fixes both halves of that: ⛔ the key is NOT declared on
 * `ActionDef` and ⛔ NOT added to {@link ACTION_DEF_KEYS}; it is declared at the
 * seam, on `packages/app-shell/src/consoleActionDispatch.ts`'s
 * `ConsoleActionDispatch`, and appears HERE only so the dev-mode warning below
 * stops calling it unknown.
 *
 * Why the warning has to know: `classifyActionKeys` sees the object the runner
 * was handed, which is the DISPATCH, not the stored metadata row. With the key
 * absent from the inventory, `warnOnUnknownActionKeys` told the author that a
 * key TWO files read is one "no reader recognizes", and prescribed promoting it
 * to `ActionDef` — the one shape the ruling forbids for it. A diagnostic that
 * fires on the product's own privileged path is how a console gets muted.
 *
 * {@link HOST_STASHED_PARAM_KEYS} below is the same category one level down —
 * host-composed keys inside `params` rather than on the action itself — and
 * cites `DeclaredActionsBar` by name for the same reason this does. Two lists
 * because the two warnings ask different questions of different objects, not
 * because the categories differ.
 *
 * `overrideNotice` — the privileged-override safety copy (objectui#5178),
 * naming the approvers about to be bypassed.
 * - producer: `packages/app-shell/src/views/DeclaredActionsBar.tsx`, on the
 *   `can_act:false && can_override:true` branch.
 * - readers: `packages/app-shell/src/hooks/useConsoleActionRuntime.tsx` and
 *   `packages/app-shell/src/views/RecordDetailView.tsx`, the console's two
 *   param-collection handlers, which render it ahead of the declared
 *   description in the dialog's subtitle.
 *
 * Anything added here must satisfy all three of: composed by a host in code,
 * never read back out of stored metadata, and read by the runtime. A key an
 * AUTHOR is meant to write belongs on `ActionDef` — or, when the spec owns it,
 * in `@objectstack/spec` first — and not in this list. `actionKeys.pin.test.ts`
 * pins the contents exactly, so growing the set is a deliberate, reviewed edit
 * rather than a quiet one.
 */
export const HOST_DISPATCH_ACTION_KEYS = ['overrideNotice'] as const;

/**
 * Keys the spec has TOMBSTONED: still present in `ActionSchema` so the parser can
 * reject them BY NAME with a rename prescription, rather than fail with a bare
 * "unrecognized key".
 *
 * Warned about separately from unknown keys, and more loudly: an unknown key is
 * probably a typo, while a retired key is metadata that used to work. That
 * distinction is why `executeScript` carries a runtime branch returning the
 * rename prescription.
 *
 * Step 1 expected that branch to retire with the index signature. It does not,
 * and the reason is the one in this module's header: `tsc` closed the
 * code-authored half of the gap, while `execute: 'markDone'` lives in stored
 * rows that reach the runner UNPARSED (objectstack#3903). The branch reads the
 * key off an untyped view of the action precisely so that `ActionDef` can go on
 * NOT declaring it — declaring it to make the read compile would re-legitimize
 * a tombstone the spec keeps only in order to reject it by name.
 */
export const RETIRED_ACTION_KEYS: Readonly<Record<string, string>> = {
  execute: '`execute` was removed in @objectstack/spec 17 (objectstack-ai/objectstack#3855) — rename the key to `target`. ' +
    'The value (a script name or expression) is unchanged. ' +
    'Run `os migrate meta --from 16` to rewrite it automatically.',
};

/**
 * Every key an action may legitimately carry today — authored or host-composed.
 *
 * Four inputs, three of them mirrors of an authored surface and the fourth
 * ({@link HOST_DISPATCH_ACTION_KEYS}) the host-composed dispatch chrome. The
 * union is what `classifyActionKeys` consults, and it is deliberately wider
 * than the authored surface: the runner classifies the object it was HANDED,
 * and a host hands it a dispatch. Membership here grants nothing to an author —
 * `ActionDef` is what decides that, and it is closed.
 */
export const KNOWN_ACTION_KEYS: ReadonlySet<string> = new Set<string>([
  ...ACTION_DEF_KEYS,
  ...SPEC_ACTION_KEYS,
  ...NAVIGATION_ALIAS_KEYS,
  ...HOST_DISPATCH_ACTION_KEYS,
].filter((key) => !(key in RETIRED_ACTION_KEYS)));

/** Split an action's own keys into the two things worth saying out loud. */
export function classifyActionKeys(action: object | null | undefined): {
  unknown: string[];
  retired: string[];
} {
  const unknown: string[] = [];
  const retired: string[] = [];
  if (!action || typeof action !== 'object') return { unknown, retired };
  for (const key of Object.keys(action)) {
    if (key in RETIRED_ACTION_KEYS) retired.push(key);
    else if (!KNOWN_ACTION_KEYS.has(key)) unknown.push(key);
  }
  return { unknown, retired };
}

// Warn once per (action, problem), not once per execution: an unrecognized key
// usually sits in metadata driving a button that gets clicked repeatedly, and a
// warning that floods the console is a warning that gets muted.
//
// Keyed by action name as well as by the keys, deliberately. Keying on the keys
// alone would report the FIRST action carrying `targt` and stay silent about
// every other one — sending the author to fix a button that was only the first
// symptom. The memo is bounded by the number of authored actions either way.
const warned = new Set<string>();

/** Reset the warn-once memo. Exported for tests. */
export function resetActionKeyWarnings(): void {
  warned.clear();
}

const isDev = (): boolean =>
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.NODE_ENV !==
  'production';

/**
 * Dev-mode only: name the keys an action carries that no reader will ever look
 * at. Non-breaking by construction — it changes no types and rejects nothing.
 *
 * Silently binding no handler is the objectstack-ai/objectstack#2169 "Mark Done does nothing" shape. The
 * compiler now catches it in action literals AUTHORED IN CODE — objectstack#4075
 * step 3 closed `ActionDef` — but not in the actions that arrive as DATA, which
 * reach the runner unparsed and which no compiler ever looked at. This is the
 * audible half for that population; see this module's header.
 */
export function warnOnUnknownActionKeys(action: object | null | undefined, where = 'ActionRunner'): void {
  if (!isDev()) return;
  const { unknown, retired } = classifyActionKeys(action);
  const name = (action as { name?: unknown; type?: unknown })?.name ?? (action as { type?: unknown })?.type ?? '(unnamed)';

  for (const key of retired) {
    const memo = `retired:${String(name)}:${key}`;
    if (warned.has(memo)) continue;
    warned.add(memo);
    console.warn(`[${where}] action "${String(name)}" carries the retired key \`${key}\`. ${RETIRED_ACTION_KEYS[key]}`);
  }

  if (unknown.length === 0) return;
  const memo = `unknown:${String(name)}:${unknown.slice().sort().join(',')}`;
  if (warned.has(memo)) return;
  warned.add(memo);
  console.warn(
    `[${where}] action "${String(name)}" carries ${unknown.length === 1 ? 'a key' : 'keys'} no reader ` +
      `recognizes: \`${unknown.join('`, `')}\`. Nothing will read ${unknown.length === 1 ? 'it' : 'them'} — ` +
      'check for a typo, or promote the key to an explicit field on `ActionDef` ' +
      '(packages/core/src/actions/ActionRunner.ts), adding it to `ACTION_DEF_KEYS` ' +
      '(packages/core/src/actions/actionKeys.ts) in the SAME commit — the pin test derives one ' +
      'from the other, so either edit alone goes red. Warned rather than rejected because `tsc` ' +
      'only sees actions authored in code: this one may have arrived as DATA, and stored ' +
      '`sys_metadata` rows reach the runner unparsed (objectstack#3903).',
  );
}

/**
 * Keys a HOST stashes into an action's `params` for the runner's own plumbing,
 * rather than an author writing them there as a request payload.
 *
 * {@link warnOnDeprecatedObjectParams} has to tell "the author put the payload in
 * `params`" (the shape objectstack#5777 retires) apart from "a host stashed row
 * context there" (a shape the runner itself asks for, and that is not going
 * away). `DeclaredActionsBar` dispatches `params: { _rowRecord: record }`,
 * `RelatedRecordActionsBridge` does the same, and `ObjectGrid` adds
 * `_selectedIds`; the api handler lifts `recordId` out of the field values
 * before it updates. Warning on those would fire on nearly every declared-action
 * click and prescribe `bodyExtra`, which is the wrong home for all of them.
 *
 * The `_` prefix is the existing convention for the stash — `recordId` is its one
 * unprefixed member, so it is listed rather than inferred.
 */
const HOST_STASHED_PARAM_KEYS: ReadonlySet<string> = new Set(['recordId']);

const isAuthoredParamKey = (key: string): boolean =>
  !key.startsWith('_') && !HOST_STASHED_PARAM_KEYS.has(key);

/**
 * Does this action carry the DEPRECATED object-form `params` — a static request
 * payload written under the key that means "parameter definitions"?
 *
 * The discriminator is `Array.isArray` and the type guard is `api`, mirroring
 * `@objectstack/spec`'s `inline-action-api-params-to-body-extra` conversion
 * (ADR-0087 D2) key for key. Contract parity with the producer is the point: the
 * conversion rewrites exactly this shape to `bodyExtra` at load, so the runner
 * must recognize exactly the same shape as "the thing that got rewritten".
 *
 * The `api` guard is also what keeps the deprecation out of objectstack#6828's
 * territory — object-form `params` on a `type: 'url'` action is a THIRD meaning
 * (`interpolateTarget`'s `${param.X}` scope, `executeUrl`'s `params.newTab`) and
 * `bodyExtra` is NOT its replacement. Do not widen this guard without that
 * ruling.
 */
export function hasDeprecatedObjectParams(action: object | null | undefined): boolean {
  if (!action || typeof action !== 'object') return false;
  const { type, actionType, params } = action as {
    type?: unknown; actionType?: unknown; params?: unknown;
  };
  if ((type ?? actionType) !== 'api') return false;
  if (!params || typeof params !== 'object' || Array.isArray(params)) return false;
  return Object.keys(params).some(isAuthoredParamKey);
}

/**
 * Dev-mode only: name the object-form `params` that `@objectstack/spec` 17 already
 * refuses at the authoring door, and prescribe `bodyExtra`.
 *
 * This is the audible half of the compat window the maintainer's 2026-08-06
 * ruling on objectstack#5777 ordered (direction A — a separate key, no same-name
 * union): the runner keeps READING a non-array `params` as the static payload for
 * one version window, says so, and the arm is deleted at 18. The loud half lives
 * at the producer, where it belongs — spec's `params` field refuses the object
 * form outright with a message naming `bodyExtra`, and the ADR-0087 conversion
 * rewrites sources that still carry it. So a warning is the correct severity
 * HERE: by the time metadata reaches this runner the producer has already had its
 * say, and what is left to catch is a host composing an ActionDef in code.
 *
 * Dev-only and warn-once, matching {@link warnOnUnknownActionKeys} — a warning
 * that floods a production console is a warning that gets muted.
 */
export function warnOnDeprecatedObjectParams(action: object | null | undefined, where = 'ActionRunner'): void {
  if (!isDev()) return;
  if (!hasDeprecatedObjectParams(action)) return;
  const name = (action as { name?: unknown; type?: unknown })?.name ?? '(unnamed)';
  const memo = `deprecated-object-params:${String(name)}`;
  if (warned.has(memo)) return;
  warned.add(memo);
  console.warn(
    `[${where}] action "${String(name)}" carries a static request payload in \`params\`. ` +
      '`params` is the parameter DEFINITION array (fields collected from the user before the ' +
      'action runs), never a payload map — put the payload in `bodyExtra` instead ' +
      '(objectstack#5777). Still read as the payload for one version window; the arm is ' +
      'removed at 18. `bodyExtra` is merged LAST, so it overrides anything left here.',
  );
}
