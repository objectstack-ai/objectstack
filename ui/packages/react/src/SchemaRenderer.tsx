/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React, { forwardRef, useContext, useMemo, useEffect, useReducer, useState, Component, type ForwardRefExoticComponent, type RefAttributes } from 'react';
import type { BaseSchema, DeclaredNode } from '@object-ui/types';
import {
  ComponentRegistry,
  ExpressionEvaluator,
  isObjectUIError,
  type ObjectUIError,
  ERROR_CODES,
  debugLog,
  debugTime,
  debugTimeEnd,
  DebugCollector,
  validateSchema,
  hasDeclaredPredicate,
  hasResponsiveStyles,
  scopeClassFor,
  compileScopedStyles,
  recordSourceDataArmForType,
} from '@object-ui/core';
import { SchemaRendererContext } from './context/SchemaRendererContext.js';
import { useRecordContext } from './context/RecordContext.js';
import { usePredicateScope, PredicateScopeProvider } from './hooks/useExpression.js';
import { useElementApiDataSource } from './element-data-source/useElementApiDataSource.js';
import { ElementDataSourceLoadingPanel } from './element-data-source/ElementDataSourceGate.js';
import { ElementApiDataSourcePanel } from './element-data-source/ElementApiDataSourcePanel.js';
import { usePageVariables } from './hooks/usePageVariables.js';
import { resolveKeyedI18nLabel } from './utils/i18n.js';
import { isConfigBag } from './utils/configBag.js';
import { PARAMS_KEY, isParamsBag, mapParamsLeaves } from './utils/paramsBag.js';
import { isInlineLocaleMap, mapLocaleMapMembers } from './utils/localeMap.js';
import { reportUnevaluatedExpressions } from './utils/unevaluatedExpression.js';
import { reportDroppedPropsBag, reportRefusedPropsPredicate } from './utils/propsBagDiagnostic.js';
import { reportRefusedDataPropSpread } from './utils/refusedDataPropDiagnostic.js';
import { expressionBindableTextKeysFor } from '@objectstack/spec/ui';
import {
  reportUnresolvableVisibilityPredicate,
  reportAdapterOnlyDataPredicate,
} from './utils/visibilityDiagnostic.js';
import type { PredicateGateKind } from './utils/visibilityDiagnostic.js';

/**
 * Dev-mode schema validation.
 *
 * In development, every schema object is validated exactly once (deduped
 * via a WeakSet) using the canonical {@link validateSchema} from
 * `@object-ui/core`. Errors are reported via `console.warn` with the
 * offending JSON path, and the rendered host element gets a
 * `data-obj-schema-invalid` attribute so apps can opt into a visual cue
 * (e.g. red outline) via CSS.
 *
 * In production this is a no-op: the validation pass is skipped entirely
 * and `data-obj-schema-invalid` is never emitted.
 */
const __DEV__ = (() => {
  try {
    return (globalThis as any).process?.env?.NODE_ENV !== 'production';
  } catch {
    return true;
  }
})();

type _ValidationCacheEntry = { valid: boolean; messages: string[] };
const _validationCache: WeakMap<object, _ValidationCacheEntry> =
  typeof WeakMap !== 'undefined'
    ? new WeakMap()
    : ({ set() {}, get() { return undefined; }, has() { return false; } } as any);
const _warnedSchemas: WeakSet<object> =
  typeof WeakSet !== 'undefined' ? new WeakSet() : ({ add() {}, has() { return false; } } as any);

function validateSchemaOnce(schema: any): _ValidationCacheEntry {
  // Render is not a validation door: a dev-only STRUCTURAL check, not the contract — the doors are named in "Render is not a validation door", content/docs/guide/schema-rendering.md.
  if (!__DEV__ || !schema || typeof schema !== 'object') {
    return { valid: true, messages: [] };
  }
  // Return cached result so re-renders (and the post-mount forceUpdate that
  // runs to pick up lazy plugin registrations) preserve the invalid flag.
  // Dedup of the console.warn is handled separately via _warnedSchemas.
  const cached = _validationCache.get(schema);
  if (cached) {
    return cached;
  }
  let entry: _ValidationCacheEntry = { valid: true, messages: [] };
  try {
    const result = validateSchema(schema);
    if (!result.valid) {
      const msgs = result.errors.map(e => `${e.path}: ${e.message}`);
      entry = { valid: false, messages: msgs };
      if (!_warnedSchemas.has(schema)) {
        _warnedSchemas.add(schema);
        console.warn(
          '[ObjectUI] Invalid schema detected:\n' + msgs.join('\n'),
          schema
        );
      }
    }
  } catch (err) {
    // Validator itself failed — surface but don't crash render.
    if (!_warnedSchemas.has(schema)) {
      _warnedSchemas.add(schema);
      console.warn('[ObjectUI] Schema validator threw:', err);
    }
  }
  _validationCache.set(schema, entry);
  return entry;
}

/**
 * What `evaluateCondition` accepts, read off the evaluator rather than
 * re-spelled here — a hand-copied union is the shape that drifts.
 */
type VisibilityPredicate = Parameters<ExpressionEvaluator['evaluateCondition']>[0];

/**
 * The members a type DECLARES, without its index signatures: a key-remapping
 * mapped type over `keyof T` keeps each declared member with its own modifiers
 * and drops the `string` / `number` / `symbol` index keys.
 *
 * Applied to `BaseSchema` by {@link InterpreterWorkingCopy}, so that type's
 * `[key: string]: any` did not ride into the working copy. objectui#8347
 * removed that signature from `BaseSchema`, so this is the identity on it now.
 */
type DeclaredMembersOf<T> = {
  [K in keyof T as string extends K
    ? never
    : number extends K
      ? never
      : symbol extends K
        ? never
        : K]: T[K];
};

/**
 * The two flags the evaluation memo in {@link SchemaRenderer} WRITES onto its
 * working copy (objectui#11349). Both are renderer state, not metadata:
 *
 *   - set only by the memo itself (`shouldHide` sets `_hidden`, the enablement
 *     chain sets `_disabled`, each to `true`);
 *   - read only by this component: `_hidden` by the render pass, which returns
 *     `null`; `_disabled` by the metadata destructure before `createElement`,
 *     which strips BOTH flags and re-emits `_disabled` as the element's
 *     `disabled` prop.
 *
 * ⚠️ The copy starts as `{ ...schema }`, so an authored key of either name
 * would arrive here already set, and nothing refuses one. No producer writes
 * either key: the census is on objectui#11349's pull request. It is a dated
 * reading, and nothing here re-derives it.
 */
interface InterpreterMarkers {
  /** Written by the visibility chain when the node is hidden. */
  _hidden?: boolean;
  /** Written by the enablement chain when the node is disabled. */
  _disabled?: boolean;
}

/**
 * The AUTHORED key the working copy names explicitly, on a ruling
 * (objectui#11349's per-key verdicts). Every other authored key the memo
 * reads (`properties`, `content`, `params`, the text keys, `responsiveStyles`,
 * …) stays `unknown` and narrows at its read site.
 */
interface WorkingCopyAuthoredKeys {
  /**
   * The annotated LEGACY ALIAS of the spec's `properties` config bag. The
   * maintainer's 2026-08-18 ruling (objectui#5123), quoted at
   * {@link propsWithoutCanonicalKeys}, binds it: `properties` wins on BOTH
   * channels, and a key only `props` declares keeps working.
   *
   * Typed as that alias and nothing more: `unknown`, the type `properties`
   * gets from the `Record<string, unknown>` part, because an authored bag may
   * be degenerate (`props: 'not-a-bag'`) and every read narrows it with
   * `isConfigBag` first. Naming it here neither retires it nor widens it.
   */
  props?: unknown;
  // ⛔ No `visibility`. The page component's old spelling of `visibleWhen` is
  // a `retiredKey` tombstone in `@objectstack/spec` 18 (objectstack#23543 F4):
  // every parsing door refuses it by name and stored rows are rehydrated to
  // `visibleWhen`, so this interpreter reads `visibleWhen` only and a raw
  // node still carrying `visibility` gates nothing (objectui#12654).
}

/**
 * The interpreter's WORKING COPY of one node: the shallow copy the evaluation
 * memo in {@link SchemaRenderer} builds with `{ ...schema }`, rewrites in place
 * and hands to the render pass (objectui#11349). The memo writes the evaluated
 * bags, the `properties` hoist and the two markers into it.
 *
 * ## Renderer state, not an authoring site
 *
 * This is the type of a value this component OWNS while it interprets a node.
 * It is ⛔ not the authoring face: that is `BaseSchema`, and the keys named
 * here are ⛔ not declared there. That is the seat's ruling on objectui#11349,
 * option (b). It is ⛔ not exported, and no published `.d.ts` names it.
 *
 * It has four parts:
 *
 *   1. the members `BaseSchema` DECLARES ({@link DeclaredMembersOf});
 *   2. {@link InterpreterMarkers}, the two flags this component writes;
 *   3. {@link WorkingCopyAuthoredKeys}, the authored key a ruling names;
 *   4. `Record<string, unknown>` for every other key. A read of a key
 *      `BaseSchema` does not declare is `unknown` and must NARROW before use.
 *      That is stricter than the `any` this type replaces.
 */
type InterpreterWorkingCopy = DeclaredMembersOf<BaseSchema> &
  InterpreterMarkers &
  WorkingCopyAuthoredKeys &
  Record<string, unknown>;

/**
 * Extract AriaPropsSchema properties from a schema node and convert
 * them to standard HTML ARIA attributes.
 *
 * @objectstack/spec AriaPropsSchema defines:
 *   ariaLabel: string | I18nLabel (→ aria-label)
 *   ariaDescribedBy: string (→ aria-describedby)
 *   role: string (→ role)
 *
 * ⚠️ This reads the FLAT node keys, and resolves `ariaLabel` in objectui's
 * KEYED vocabulary (`resolveKeyedI18nLabel`), which returns `undefined` for an
 * inline locale map. It does not read the NESTED `aria` bag a block's props
 * carry. That bag is read by `resolveInlineAriaProps` (`utils/inlineAria.ts`,
 * objectui#11051), and objectui#4580 Q2-B keeps the two readers separate.
 *
 * It takes the interpreter's working copy (objectui#11349). That copy used to
 * arrive through a `Record<string, any>` parameter, which typed these reads
 * `any`. `ariaLabel` is a `BaseSchema` member. `ariaDescribedBy` and `role`
 * are not, so they read as `unknown` and are forwarded exactly as authored,
 * the same bytes as before. The record is typed to say so.
 */
function resolveAriaProps(schema: InterpreterWorkingCopy): Record<string, unknown> {
  const aria: Record<string, unknown> = {};
  if (schema.ariaLabel) {
    aria['aria-label'] = resolveKeyedI18nLabel(schema.ariaLabel);
  }
  if (schema.ariaDescribedBy) {
    aria['aria-describedby'] = schema.ariaDescribedBy;
  }
  if (schema.role) {
    aria['role'] = schema.role;
  }
  return aria;
}

/**
 * Keys the `properties` hoist deliberately refuses to copy onto the node — they
 * identify WHICH renderer to dispatch to, so an inner `properties.type` (e.g. a
 * tab's visual style `line` | `card` | `pill`) must never shadow the outer
 * component descriptor. See the hoist in the evaluation memo below.
 */
const HOIST_PROTECTED_KEYS = new Set(['type', 'id']);

/**
 * The legacy `props` bag, minus every key the canonical `properties` bag also
 * declares (objectui#5123).
 *
 * A node may spell its config bag `properties` (the spec spelling) or `props`
 * (the annotated legacy alias). A node that writes BOTH used to get a DIFFERENT
 * answer for the same key depending on which channel read it, and the two
 * channels' precedence was exactly OPPOSITE:
 *
 *   - config bag: `readProps()` in the `element:*` family merges
 *     `{ ...schema.props, ...schema.properties }` — `properties` wins.
 *   - React prop: `createElement` below spread `...componentProps` (which
 *     carries the hoisted `properties.*` values) and then
 *     `...(evaluatedSchema.props || {})` LAST, which overwrote them —
 *     `props` won.
 *
 * Measured on one render of one node carrying both:
 * `bagRead(properties.content)="FROM_PROPERTIES"` while
 * `reactPropRead(content)="FROM_PROPS"`. Which one reached the screen depended
 * only on whether the renderer happened to be in the `readProps()` family.
 *
 * Maintainer ruling 2026-08-18: **`properties` wins on BOTH channels — one
 * answer per key.** The config-bag order was already correct and is untouched;
 * this narrowing is the React-prop half. It restores the declared posture
 * (`props` is an annotated legacy alias) rather than changing it.
 *
 * Implemented by REMOVING the overlapping keys from the alias spread rather
 * than by re-spreading `properties` after it. That matters: `properties.*` is
 * already on the node via the hoist, so the values are in `componentProps`
 * having passed the metadata strip. Re-spreading the raw bag would push
 * stripped schema metadata back out as React props — exactly the regression
 * that made a spec-documented `dataSource` binding shadow the injected adapter
 * and break the component (objectstack#5576). Subtracting adds no key to the
 * outgoing bag; it only decides which of two co-present values a key carries.
 *
 * Scope, deliberately narrow — this only moves a reading where BOTH bags
 * declare the same key:
 *   - a key only `props` declares is untouched (the alias keeps working);
 *   - a key only `properties` declares is untouched (it already won);
 *   - `type`/`id` are skipped, because the hoist never copied a canonical value
 *     up for them, so dropping the alias would DELETE the prop rather than
 *     replace it;
 *   - a degenerate (non-object) `properties` is left alone — there is no
 *     canonical bag to prefer, because a degenerate bag declares no key for
 *     either spelling to win. (This bullet used to explain the carve-out by
 *     saying "the hoist and `readProps()` both merely object-spread it". Half
 *     of that stopped being true at objectui#6760, which stopped the hoist from
 *     enumerating a degenerate bag; the carve-out itself is unaffected, since
 *     it never rested on what the hoist does with the value.)
 *
 * Adjacent but NOT decided here: objectui#4795's pending question ② (whether
 * the `properties` envelope is an official `ui:*` authoring channel at all).
 * This is a precedence rule between two co-present spellings and takes no
 * position on whether either should exist.
 */
function propsWithoutCanonicalKeys(
  propsBag: unknown,
  propertiesBag: unknown
): Record<string, any> {
  // A degenerate `props` contributes NO keys (objectui#6752). This used to be a
  // bare `if (!propsBag)`, so a non-object bag was returned as-is and the
  // `createElement` spread below re-enumerated it: measured on `b76ca6764`,
  // `props: 'not-a-bag'` reached the element as nine React props named `0` … `8`.
  // Returning `{}` also makes the declared return type true — the old signature
  // said `Record<string, any>` while this line could hand back a string.
  //
  // This does NOT move objectui#5123's precedence. That rule only decides which
  // of two co-present values a key carries, and a degenerate bag declares no
  // key for either bag to win: the indices were never authored, they are the
  // object spread's reading of a string.
  if (!isConfigBag(propsBag)) return {};
  // Only a real object bag can win a key — the same predicate, for the reason
  // stated there: a degenerate bag must not have its shape reinterpreted here.
  if (!isConfigBag(propertiesBag)) {
    return propsBag;
  }
  let narrowed: Record<string, any> | null = null;
  for (const key of Object.keys(propertiesBag)) {
    if (HOIST_PROTECTED_KEYS.has(key)) continue;
    if (!Object.prototype.hasOwnProperty.call(propsBag, key)) continue;
    // Copy lazily: the overwhelmingly common node declares one bag or neither,
    // and this runs on every render of every node.
    if (!narrowed) narrowed = { ...propsBag };
    delete narrowed[key];
  }
  return narrowed ?? propsBag;
}

/**
 * The visibility-chain keys, in the EXACT precedence order the `shouldHide`
 * IIFE in the evaluation memo consults them (objectui#5756).
 *
 * That chain is one sequence of `if (…) return …` — an early-return chain,
 * not independent checks — so only the FIRST key here found "declared" on a
 * node is ever the one that decides, and every lower-priority key is never
 * even asked. `SHOW` keys ask "is it `!== undefined`?" (their `true` means
 * *shown*, so "absent" already means shown and needs no narrower test);
 * `HIDE` keys ask {@link hasDeclaredPredicate} instead, because their `true`
 * means *hidden* and the wider `!== undefined` test would vanish a node for
 * `hidden: ''` (objectui#3955). See {@link winningVisibilityKey}.
 */
const VISIBILITY_SHOW_KEYS = ['visibleWhen', 'visible', 'visibleOn'] as const;
const VISIBILITY_HIDE_KEYS = ['hidden', 'hiddenOn'] as const;

/**
 * The five legs, as ONE closed type — so a seventh cannot be added to the chain
 * without also being classified below.
 */
type VisibilityChainKey =
  | (typeof VISIBILITY_SHOW_KEYS)[number]
  | (typeof VISIBILITY_HIDE_KEYS)[number];

/**
 * The same five legs as a lookup, so the config-bag evaluation loops below can
 * ask "is this key a visibility predicate?" off the SAME declaration the chain
 * is built from rather than a second list that can drift from it.
 *
 * Since objectui#9107 those loops ask {@link PREDICATE_CHAIN_KEYS} — this set
 * unioned with the enablement chain's — so this one is the VISIBILITY HALF of
 * that union rather than the whole of it. Each chain still has exactly one
 * declaration, which is the property this constant was added for.
 */
const VISIBILITY_CHAIN_KEYS: ReadonlySet<string> = new Set<string>([
  ...VISIBILITY_SHOW_KEYS,
  ...VISIBILITY_HIDE_KEYS,
]);

/**
 * The ENABLEMENT-chain keys — the SECOND predicate chain this file carries, and
 * deliberately not a seventh leg of the visibility chain above (objectui#9107).
 *
 * Split the way this file actually consults them, which is not a polarity split:
 *
 *   * {@link ENABLEMENT_NODE_GATE_KEYS} are the two legs
 *     {@link evaluateEnablementPredicate} consults HERE, in this precedence
 *     order, as one early-return chain — the enablement counterpart of
 *     `shouldHide`. Their `true` means DISABLED, un-negated.
 *   * {@link ENABLEMENT_RENDERER_KEYS} is the legacy, non-spec `enabled` alias.
 *     This component never evaluates it: the node gate does not consult it at
 *     all, and the action renderers (`action:button`, `action:icon`) read it one
 *     layer down off the schema and NEGATE it (`disabled = !isEnabled`). It is
 *     declared here because the config-bag loops below flatten it exactly like
 *     the other two — which is the whole defect — not because anything in this
 *     file decides with it.
 *
 * ## Why a second declaration instead of widening the visibility chain
 *
 * {@link VisibilityChainKey} exists "so a seventh cannot be added to the chain
 * without also being classified below", and {@link visibilityGateKind} is that
 * classification — it hands each leg the consequence copy for ITS polarity.
 * These three keys have neither property: they route through
 * {@link evaluateEnablementPredicate}, which states `'enablement'` at its own
 * call site, and `enabled` is not consulted here at all. Adding them to
 * {@link VISIBILITY_SHOW_KEYS} / {@link VISIBILITY_HIDE_KEYS} to reach the
 * guard would make that closed type assert something false about them, and
 * would silently enrol them in `shouldHide`'s early-return chain and in the
 * visibility consequence copy as a side effect of a config-bag repair.
 *
 * So the two chains stay two declarations, and the GUARD takes their union
 * ({@link PREDICATE_CHAIN_KEYS}) — one lookup, derived, declared nowhere twice.
 * The alternative shape (one flat predicate-chain set that both chains derive
 * FROM) was rejected for the opposite reason: the chains do not share an order,
 * a declared-test or a consequence, so the thing they genuinely share is only
 * the guard's question, and that is exactly what a derived union expresses.
 */
const ENABLEMENT_NODE_GATE_KEYS = ['disabled', 'disabledOn'] as const;
const ENABLEMENT_RENDERER_KEYS = ['enabled'] as const;

/**
 * The two legs the node gate itself consults, as ONE closed type — the
 * enablement counterpart of {@link VisibilityChainKey}, load-bearing for the
 * same reason: a third node-gate leg cannot be handed to
 * {@link evaluateEnablementPredicate} without being declared above, which is
 * the same edit that puts it into the config-bag guard below.
 */
type EnablementNodeGateKey = (typeof ENABLEMENT_NODE_GATE_KEYS)[number];

/**
 * Every key either predicate chain owns, as ONE lookup for the config-bag
 * evaluation loops. DERIVED from the four declarations above and declared
 * nowhere else, so a leg added to either chain is covered by the guard in the
 * same edit that adds it.
 */
const PREDICATE_CHAIN_KEYS: ReadonlySet<string> = new Set<string>([
  ...VISIBILITY_CHAIN_KEYS,
  ...ENABLEMENT_NODE_GATE_KEYS,
  ...ENABLEMENT_RENDERER_KEYS,
]);

/**
 * Every key a NODE GATE in this file actually consults, as ONE lookup for the
 * objectui#9108 refusal below. DERIVED from the same two declarations the gates
 * are built from, so a leg added to either chain is refused under `props` by the
 * same edit that adds it.
 *
 * {@link PREDICATE_CHAIN_KEYS} minus {@link ENABLEMENT_RENDERER_KEYS}, and the
 * subtraction is the whole reason this is a second derivation rather than a
 * reuse: `enabled` is in that union because the config-bag evaluation loops
 * flatten it, but NO gate here consults it - the action renderers read it one
 * layer down off the schema and negate it. Refusing it here would state, of a
 * key this file never asks about, that a gate in this file could not see it.
 * Its own `props` drop is objectui#6708's subject and is reported there.
 */
const NODE_GATE_PREDICATE_KEYS: ReadonlySet<string> = new Set<string>([
  ...VISIBILITY_CHAIN_KEYS,
  ...ENABLEMENT_NODE_GATE_KEYS,
]);

/**
 * Is this value the canonical CEL envelope — `{ dialect: 'cel', source }` —
 * that `@objectstack/spec` normalizes an authored predicate into?
 *
 * Deliberately narrower than "has a `source`": `cron` and `template` envelopes
 * are NOT matched, so the `${…}` / template behaviour of the loops below is
 * byte-for-byte what it was. Only the dialect that `evaluateCondition` routes
 * to the canonical `@objectstack/formula` engine is held back from the
 * flattening described in {@link preservePredicateEnvelope}.
 *
 * The object-shape half is {@link isConfigBag}, ASKED rather than re-spelled:
 * objectui#6761 pins that predicate to one definition, and an envelope is the
 * same question about the same kind of value (a real object, never an array).
 * This is a third READ of that one answer, not a fourth spelling of it.
 */
const isCelEnvelope = (value: unknown): boolean =>
  isConfigBag(value)
  && (value as { dialect?: unknown }).dialect === 'cel'
  && typeof (value as { source?: unknown }).source === 'string';

/**
 * Evaluate ONE value of a node's config bag (`properties` — the spec spelling
 * — or its legacy `props` alias), EXCEPT a CEL predicate envelope, which is
 * returned untouched.
 *
 * ## The defect this closes (objectui#9100)
 *
 * `ExpressionEvaluator.evaluate` unwraps ANY `{ source: string }` object to its
 * bare `source` before it does anything else — that unwrap is what lets a
 * `{ dialect: 'template', source: '${data.total}' }` value interpolate. Applied
 * to a `{ dialect: 'cel' }` PREDICATE it is destructive instead: the envelope
 * is the only thing that tells {@link ExpressionEvaluator.evaluateCondition}
 * to route to the canonical `@objectstack/formula` engine, and the bag loops
 * run BEFORE the hoist, so by the time either consumer sees the key the
 * envelope is gone.
 *
 * Both consumers then read a bare string and both take the legacy JS path:
 *
 *   1. this component's own `shouldHide` chain, off the post-hoist node; and
 *   2. the RENDERER's `toPredicateInput(…)` → `useCondition(…)` call, one
 *      layer down (`record:alert`, the four `action:*` blocks, …), which wraps
 *      the bare string as `${…}` exactly as it is documented to.
 *
 * On the legacy engine a CEL stdlib call is simply not a function, so
 * `has(record.x) && …` throws — and the two polarities of the chain then fail
 * in OPPOSITE directions, both silently:
 *
 *   * on the three SHOW legs the fail-soft `true` is negated to "do not hide",
 *     so a gate authored to conceal renders on every row — measured in a real
 *     browser against a real app instance (the card), where a duplicate-lead
 *     banner showed on 6 of 6 leads whose field was `null`;
 *   * on the two HIDE legs the same `true` sets `_hidden`, so the node is not
 *     on screen at all.
 *
 * Neither is distinguishable from a predicate that said so on purpose. That is
 * what makes this a fail-OPEN visibility gate rather than a rendering glitch.
 *
 * ## Why the fix is HERE and not in the normalizer
 *
 * `toPredicateInput` already preserves a `cel` envelope — that is its whole
 * documented reason to exist (#2661 / #3314) — and the ACTION path that works
 * calls the very same function. Measured: mounting the renderer DIRECTLY with
 * the envelope gates correctly, and only the `SchemaRenderer` route fails, so
 * the envelope dies upstream of every consumer, in the loops below. What makes
 * the action path survive is that those loops are per-value and SHALLOW: an
 * action's predicate sits one level down inside the `actions[]` ARRAY, and
 * `evaluate` returns a non-string untouched, so nothing walks into it. A
 * `record:alert` `properties.visible` is a TOP-LEVEL bag key and is hit
 * head-on. Same normalizer, different depth.
 *
 * ## The enablement chain carries the identical defect (objectui#9107)
 *
 * `disabled` / `disabledOn` / `enabled` sit in the same two bags and are
 * flattened by the same two loops, but they are NOT visibility legs — they
 * route through {@link evaluateEnablementPredicate} and the action renderers'
 * own `useCondition` call. Measured on the pre-fix tree through this component,
 * with a CEL stdlib predicate authored at `properties` top level, and the two
 * halves fail in OPPOSITE directions just as the visibility polarities do:
 *
 *   * `disabled` / `disabledOn` — BOTH a holding and a failing predicate left
 *     the control DISABLED. The flattened source faults on the legacy engine
 *     and `evaluateCondition`'s fail-soft `true` is un-negated here, so every
 *     CEL-authored enablement gate greyed its control out on every row, with
 *     no predicate an author could write to re-enable it.
 *   * `enabled` — BOTH left the control ENABLED, because the renderers negate
 *     that leg (`disabled = !isEnabled`), so the same fail-soft `true` lands on
 *     "not disabled": a control the author disabled stayed pressable.
 *
 * ⇒ neither polarity alone detects this. A disabled-only suite is green on the
 * broken `disabled` legs; an enabled-only suite is green on the broken
 * `enabled` leg. Both are pinned, per key, in
 * `__tests__/SchemaRenderer.enablementEnvelopeConfigBag.test.tsx`.
 *
 * ## Scope
 *
 * Restricted to {@link PREDICATE_CHAIN_KEYS} — the union of the two closed
 * chain declarations this file already carries, which `shouldHide` /
 * {@link winningVisibilityKey} and {@link evaluateEnablementPredicate} already
 * consult. Every consumer of those nine keys takes the envelope by contract
 * (`evaluateCondition`, `toPredicateInput`). A non-predicate key keeps the
 * flattening it has always had.
 *
 * Eight of the nine are stripped by the metadata destructure near
 * `createElement`, so no object value can reach the DOM through them. The
 * ninth, the legacy `enabled` alias, is not stripped — the action renderers
 * read it off the schema, not off React props. Measured on a renderer that
 * spreads what it is handed onto a DOM node: that attribute already carried the
 * raw CEL SOURCE TEXT before this change and carries `[object Object]` after
 * it, which is the same inert shape the `properties` bag itself already puts on
 * every such node, with no React warning in either direction. Both spellings
 * are meaningless to the DOM; the leak is pre-existing and is deliberately NOT
 * repaired here.
 */
const preservePredicateEnvelope = (
  key: string,
  value: unknown,
  evaluate: (v: unknown) => unknown,
): unknown => (PREDICATE_CHAIN_KEYS.has(key) && isCelEnvelope(value) ? value : evaluate(value));

/**
 * Is this value an Expression envelope in the spec's sense: an object carrying
 * a string `dialect` AND a string `source`? (objectui#10288)
 *
 * `@objectstack/spec`'s `ExpressionSchema` declares `dialect` REQUIRED, so every
 * envelope a spec-parsed artifact carries has one. The shape test is the one
 * `@object-ui/core` already applies to a declared `defaultValue`
 * (`isRuntimeDefault`, "Same shape test the engine applies before handing a
 * default to `ExpressionEngine`"), where an object with a `source` and no
 * `dialect` is a literal value, not an instruction. {@link isCelEnvelope} is
 * this question narrowed to one dialect.
 */
const isExpressionEnvelope = (value: unknown): boolean =>
  isConfigBag(value)
  && typeof (value as { dialect?: unknown }).dialect === 'string'
  && typeof (value as { source?: unknown }).source === 'string';

/**
 * Is this config-bag value a DATA OBJECT, which the per-value loops hand to the
 * renderer exactly as authored instead of passing it to
 * `ExpressionEvaluator.evaluate`? (objectui#10288)
 *
 * ## The defect this closes
 *
 * `evaluate` unwraps ANY object with a string `source` to that bare string
 * before it does anything else (see {@link preservePredicateEnvelope}). The
 * loops handed it every value, so an authored data object that happened to
 * carry a `source` field was silently replaced by that one string. Measured
 * through the real `SchemaRenderer` -> `action:button` -> runner:
 * `properties.bodyExtra: { source: 'web', campaign: 'spring' }` reached the
 * handler as `bodyExtra: "web"`, while the same object written at node level
 * (which no loop visits) arrived intact. So the canonical channel was the
 * broken one. That pair is pinned end to end in `@object-ui/components`
 * (`action-config-bag-source-key-10288.test.tsx`), and this guard by
 * `__tests__/SchemaRenderer.configBagDataObject-10288.test.tsx`.
 * Every object-valued key a node carries in `properties` / `props`
 * goes through the same loop, so the defect was never one key's: form
 * `defaultValues`, a declarative `patch`, filter `values` and a detail view's
 * `data` are all keyed by FIELD NAME, and a field named `source` is ordinary.
 *
 * ## What still reaches `evaluate`
 *
 *   - every value that is not an object in {@link isConfigBag}'s sense (a
 *     string, any other primitive, an array), exactly as before: `evaluate`
 *     interpolates a string and returns the rest untouched;
 *   - a spec Expression envelope ({@link isExpressionEnvelope}), so a
 *     `{ dialect: 'template', source: '${…}' }` value interpolates as it always
 *     did;
 *   - every value of a predicate-chain key ({@link PREDICATE_CHAIN_KEYS}),
 *     unchanged. `BaseSchema.visible` / `.hidden` / `.disabled` declare the
 *     dialect-less `{ source }` envelope as an authorable wire form
 *     (`ExpressionWire`, objectui#7530), so on those keys it stays an
 *     expression, and {@link preservePredicateEnvelope} still holds back a CEL
 *     envelope (objectui#9100 / #9107).
 *
 * So the only value whose meaning changes is an object on a non-predicate key
 * with a string `source` and no string `dialect`, and that object now arrives
 * whole. Nothing is walked: a template nested inside a data object stays raw,
 * as it always did for an object without a `source`. The loops stay per-value
 * and shallow, which is the radius the unevaluated-expression diagnostic reads.
 *
 * One object this answers `true` for is not handed over as authored: an inline
 * locale map (`utils/localeMap.ts`, objectui#12936). It is a display string
 * written once per language, so {@link evaluateConfigValueWith} evaluates each
 * member like a plain string on the same key. That is one level, and only for
 * a map whose every key is a locale tag and every value a string, in the
 * spec's own `InlineLocaleMapSchema` sense; every other data object keeps this
 * rule, and the diagnostic reads the members through the same module.
 */
const isDataObjectValue = (key: string, value: unknown): boolean =>
  !PREDICATE_CHAIN_KEYS.has(key) && isConfigBag(value) && !isExpressionEnvelope(value);

/**
 * The scope a page node's values are evaluated against: its `visibleWhen`
 * gate and every other expression the evaluation memo in
 * {@link SchemaRenderer} evaluates on the node. Four roots, in this order:
 *
 * 1. **the ambient predicate scope**: every root `predicateScope` carries (the
 *    host scope `usePredicateScope()` publishes, plus a node's API-bound
 *    `data` once it has answered), spread first;
 * 2. **`current_user`**: aliased to the ambient `user`, so `user.email` and
 *    `current_user.email` read the same value;
 * 3. **`record`**: the page's bound row, ONLY when there is one (a non-array
 *    object). No row binds nothing, so a `record` the ambient scope supplies
 *    is not shadowed by an empty one; a row, written after the spread, wins;
 * 4. **`page`**: the page variables (`PageSchema.variables`) as `page.<var>`.
 *
 * Why each root is (and `data` is not) bound is stated where the memo builds
 * its evaluator from this.
 *
 * The ONE builder of this scope. The memo and {@link evaluateConfigBagInScope}
 * call it, so they cannot build two different scopes (objectui#10290), and it
 * is exported for the `page:tabs` derived badge in `@object-ui/components`,
 * which decides the `visibleWhen` gates in front of a related list the way the
 * tab body decides them (objectui#12987, objectui#12992). A root added here
 * reaches every one of them.
 */
export function buildNodeEvaluationScope(
  predicateScope: Record<string, unknown>,
  boundRecord: unknown,
  pageVariables: unknown,
): Record<string, unknown> {
  return {
    ...predicateScope,
    current_user: predicateScope?.user,
    ...(boundRecord && typeof boundRecord === 'object' && !Array.isArray(boundRecord)
      ? { record: boundRecord }
      : null),
    page: pageVariables,
  };
}

/**
 * Evaluate ONE config value by its key. This is the per-key rule of the
 * evaluation memo (the `params` rule, objectui#7867, is stated there): a
 * `params` bag has every string leaf evaluated, an inline locale map has each
 * member evaluated like a plain string on the same key (objectui#12936,
 * `utils/localeMap.ts`), any other data object is handed over as authored, and
 * every other value is evaluated per value and shallow, with a CEL predicate
 * envelope preserved.
 */
const evaluateConfigValueWith = (
  evaluator: ExpressionEvaluator,
  key: string,
  value: unknown,
): unknown =>
  key === PARAMS_KEY && isParamsBag(value)
    ? mapParamsLeaves(value, (leaf) => evaluator.evaluate(leaf))
    : isDataObjectValue(key, value)
      ? isInlineLocaleMap(value)
        ? mapLocaleMapMembers(value, (member) => evaluator.evaluate(member))
        : value
      : preservePredicateEnvelope(key, value, (v) => evaluator.evaluate(v as any));

/**
 * Evaluate every value of a config bag with {@link evaluateConfigValueWith}.
 * The memo's `properties` loop, as a function. Returns a new object; the
 * authored bag is never mutated.
 */
const evaluateConfigBagWith = (
  evaluator: ExpressionEvaluator,
  bag: Record<string, unknown>,
): Record<string, unknown> => {
  const evaluated: Record<string, unknown> = { ...bag };
  for (const [key, val] of Object.entries(evaluated)) {
    evaluated[key] = evaluateConfigValueWith(evaluator, key, val);
  }
  return evaluated;
};

/**
 * The `properties` evaluation of the {@link SchemaRenderer} memo, for a config
 * bag that does not pass through `SchemaRenderer` (objectui#10290): the same
 * per-key rule, the same `ExpressionEvaluator`, and the same scope, built from
 * the same three inputs. It is not a second template engine.
 *
 * The plain half of `useConfigBagEvaluator()` (`hooks/useConfigBagEvaluator`),
 * which reads those inputs from the contexts the memo reads them from. Call
 * the hook; this function exists because the rule it applies is this module's.
 * (The hook is not declared in this module: a hook here puts this file under
 * the React Compiler lint, which then reports the render-time
 * `performance.now()` / `Date.now()` debug probes below.)
 *
 * A value that is not a config bag is returned unchanged; a bag comes back as a
 * new, evaluated object and the authored one is never mutated.
 */
export function evaluateConfigBagInScope(
  bag: unknown,
  predicateScope: Record<string, unknown>,
  boundRecord: unknown,
  pageVariables: unknown,
): unknown {
  if (!isConfigBag(bag)) return bag;
  const evaluator = new ExpressionEvaluator(
    buildNodeEvaluationScope(predicateScope, boundRecord, pageVariables),
  );
  return evaluateConfigBagWith(evaluator, bag as Record<string, unknown>);
}

/**
 * What a faulting predicate DECIDES on this leg, and which CONSEQUENCE the
 * diagnostic prints for it (objectui#6503, objectui#13299).
 *
 * ## The defect this closes
 *
 * `evaluateCondition` answers an unevaluable predicate with `true` on every
 * path. On the three SHOW legs the chain negated that answer, so the node was
 * SHOWN and the reporter's "the gate did NOT bite" was true (a declared SHOW
 * predicate now fails closed instead, see the last section). On the two HIDE
 * legs the chain returns it UN-negated (see `shouldHide` below), so the same
 * `true` sets `_hidden` and this component returns `null`: the gate bit, and
 * bit harder than on either sibling gate — the node is not on screen at all.
 * Both were routed to `'visibility'`, so an author whose block VANISHED read a
 * line telling them the gate did not bite and went looking for a rendering bug
 * that does not exist. The polarity was documented in
 * `visibilityDiagnostic.ts` and printed anyway; this is the routing that makes
 * the documented split the one that is actually applied.
 *
 * ## Why derived from the two constants, when the reporter refuses to deduce
 *
 * `PredicateGateKind`'s docblock refuses to deduce the gate from `key` INSIDE
 * the reporter, and that refusal stands: the reporter is exported and called
 * from other packages, where an unheard-of spelling would silently inherit
 * some other gate's sentence. Here the caller IS the chain. The two arrays
 * above are the same declaration `shouldHide` and {@link winningVisibilityKey}
 * consult, and {@link VisibilityChainKey} closes the parameter over them, so
 * this is not a second table that can drift from the first — it is the same
 * one, read for a second question. It also removes the failure mode that
 * produced this card: a leg added to the chain and left with a consequence
 * sentence written about a different polarity is now a TYPE error here, not a
 * line of false console copy.
 *
 * The `disabled` / `disabledOn` gate is deliberately not reachable from this
 * function: those legs are not in the visibility chain and route through
 * `evaluateEnablementPredicate`, which states `'enablement'` at its own call
 * site.
 *
 * ## A fault fails CLOSED on every leg (objectui#13299)
 *
 * This function now answers two questions for a faulting predicate, off the
 * same two constants: what the leg DECIDES, and which consequence the report
 * prints. The answer to the first is "not rendered" on every leg whose
 * predicate was declared, the direction objectui#13286 set for a `page:tabs`
 * item: a predicate over the CEL AST bound, a type error, an unbound root or
 * a missing function used to draw the node for a viewer it was written to
 * exclude.
 *
 * - **SHOW legs** (`visibleWhen` / `visible` / `visibleOn`, negated by
 *   `shouldHide`): a DECLARED predicate answers `false`, so the node is
 *   withheld, and the report prints the `'withholding'` consequence. A gate
 *   that declares nothing ({@link hasDeclaredPredicate} is false: `''`,
 *   whitespace, an empty-`source` envelope) keeps the fail-soft `true`, so it
 *   still means "no gate" and the node still shows, with the `'visibility'`
 *   copy, which is true of it.
 * - **HIDE legs** (`hidden` / `hiddenOn`, NOT negated): the fail-soft `true`
 *   already means hidden, so the answer stays `true` and the copy stays
 *   `'concealment'`. They only reach the evaluator declared (`shouldHide`
 *   asks {@link hasDeclaredPredicate} first), so no blank case exists here.
 *
 * `hasDeclaredPredicate` is asked only on this FAULT path: it reports a blank
 * gate as a side effect, and a non-faulting predicate must stay as silent as
 * it was.
 */
const visibilityFaultOutcome = (
  key: VisibilityChainKey,
  raw: VisibilityPredicate,
): { verdict: boolean; gate: PredicateGateKind } => {
  if ((VISIBILITY_HIDE_KEYS as readonly string[]).includes(key)) {
    return { verdict: true, gate: 'concealment' };
  }
  return hasDeclaredPredicate(raw)
    ? { verdict: false, gate: 'withholding' }
    : { verdict: true, gate: 'visibility' };
};

/**
 * Which ONE visibility key actually decides a node's fate, mirroring both the
 * `properties` hoist's precedence (same-named key: `properties.<key>`
 * overwrites a node-level `<key>`) and `shouldHide`'s early-return chain
 * (first-declared-wins across {@link VISIBILITY_SHOW_KEYS} then
 * {@link VISIBILITY_HIDE_KEYS}) — without waiting for either to run.
 *
 * ## Why this exists (objectui#5756)
 *
 * A `${…}` template written as `properties.visible` is evaluated — and
 * collapsed to a plain boolean — by the loop that runs BEFORE the hoist, in
 * the SAME render pass. By the time `shouldHide` runs, the predicate TEXT is
 * gone; there is nothing left to diagnose. Reaching it means asking "does
 * THIS properties key actually decide?" at the one point in the render where
 * the raw text still exists — which means asking the precedence question
 * EARLY, on values the hoist has not yet merged and `shouldHide` has not yet
 * consulted.
 *
 * ## Why the precedence question, and not just "is it in `properties`?"
 *
 * Without it, a `properties.visible` template that a co-declared `visibleWhen`
 * OUTRANKS (exactly `shouldHide`'s own early-return: `visibleWhen` short-
 * circuits before `visible` is ever reached) would be reported even though it
 * decides nothing — a false positive for a leg that never runs. Restricting
 * the report to the WINNING key mirrors what `shouldHide` already does for
 * every OTHER key spelling (objectui#5454's leg-3 reporter is only ever
 * invoked on the leg that is actually consulted, by construction of the same
 * early-return chain) rather than inventing a different posture for this one.
 *
 * ## Why `node.properties` must already be POST-evaluation here
 *
 * The caller runs this AFTER the `properties.*` evaluation loop (so
 * `node.properties.visible` may already be the collapsed boolean, not the raw
 * template) and BEFORE the hoist (so a plain node-level key, untouched by that
 * loop, is still exactly what `shouldHide` will see). That ordering is what
 * makes "declared" answered here agree bit-for-bit with what `shouldHide`
 * answers later — including the corner a naive PRE-evaluation read would get
 * wrong: a template that evaluates to a literal `undefined` (e.g.
 * `${data.missing}` read alone) is `!== undefined` on its RAW text but not on
 * its EVALUATED value, and `shouldHide` falls through to the next key for
 * exactly that reason. Reading pre-eval text here would call `visible` the
 * winner when the real chain does not.
 *
 * Read-only: decides nothing about visibility itself, only which key a
 * DIAGNOSTIC should look at.
 */
function winningVisibilityKey(node: Record<string, unknown>): VisibilityChainKey | undefined {
  const propertiesBag = node.properties;
  const hasPropertiesBag = isConfigBag(propertiesBag);
  const effective = (key: string): unknown =>
    hasPropertiesBag && Object.prototype.hasOwnProperty.call(propertiesBag, key)
      ? (propertiesBag as Record<string, unknown>)[key]
      : node[key];
  for (const key of VISIBILITY_SHOW_KEYS) {
    if (effective(key) !== undefined) return key;
  }
  for (const key of VISIBILITY_HIDE_KEYS) {
    if (hasDeclaredPredicate(effective(key))) return key;
  }
  return undefined;
}

/**
 * The registry key that differs from `type` only in case, when there is one.
 *
 * objectui#5247 ruled Option C — keep lookup strict, make the failure teach.
 * Registry lookup stays exactly case-sensitive (`ComponentRegistry.get` is a
 * plain `Map.get`), so a node typed `Page` still MISSES `page` and still
 * renders the OBJUI-001 panel below. What changes is only what that panel
 * SAYS: when the miss is a case mismatch and nothing else, it names the
 * spelling that would have worked. Making `Page` resolve is the REJECTED
 * option B — it would legalise `PAGE` / `pAge` across docs, the designer,
 * `sdui-intrinsics.d.ts` and every registration site, permanently.
 *
 * The candidate set is read from the LIVE registry — `getKnownTypes()`, which
 * is loaded registrations plus pending `registerLazy` stubs — never from a
 * list typed alongside it. A hand-kept copy goes stale silently and then
 * confidently suggests a type nothing registers any more; objectui#5115
 * measured exactly that drift on the CLI's copy, in both directions at once.
 *
 * Case is the ONLY trigger the ruling grants. This is deliberately not an edit
 * distance: `pge` suggests nothing.
 *
 * `objectui check` emits the same clause from
 * `packages/cli/src/utils/known-type-case-suggestion.ts`. The two surfaces
 * cannot share one implementation because they cannot share a candidate SET:
 * the published CLI runs inside a USER's project and depends on neither
 * `@object-ui/core` nor the plugin packages that register most types, so it
 * answers from the generated `KNOWN_SCHEMA_TYPES` snapshot instead — the
 * measurement is in `scripts/regenerate-known-schema-types.mjs`. Keep the
 * emitted wording in step with that file; both are pinned by tests.
 */
function suggestTypeByCase(type: unknown): string | undefined {
  if (typeof type !== 'string' || type === '') return undefined;
  const wanted = type.toLowerCase();
  for (const candidate of ComponentRegistry.getKnownTypes()) {
    if (candidate !== type && candidate.toLowerCase() === wanted) return candidate;
  }
  return undefined;
}

/**
 * Per-component Error Boundary for SchemaRenderer.
 * Catches render errors in individual components, preventing one broken
 * component from crashing the entire page.
 */
interface SchemaErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class SchemaErrorBoundary extends Component<
  { componentType?: string; children: React.ReactNode; resetKey?: any },
  SchemaErrorBoundaryState
> {
  state: SchemaErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): SchemaErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidUpdate(prevProps: { componentType?: string; resetKey?: any }) {
    // Auto-recover when the upstream component identity or an explicit reset
    // key changes. This makes "Retry" implicit: as soon as the producer of
    // the schema fixes the offending value (e.g. user edits the date field
    // in view config), the broken widget re-mounts cleanly.
    if (
      this.state.hasError &&
      (prevProps.componentType !== this.props.componentType ||
        prevProps.resetKey !== this.props.resetKey)
    ) {
      this.setState({ hasError: false, error: null });
    }
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError && this.state.error) {
      const error = this.state.error;
      const isDev = (globalThis as any).process?.env?.NODE_ENV !== 'production';
      const objuiError = isObjectUIError(error) ? error as ObjectUIError : null;

      return (
        <div className="p-4 border border-orange-400 rounded bg-orange-50 text-orange-700 my-2" role="alert">
          <p className="font-medium">
            Component{this.props.componentType ? ` "${this.props.componentType}"` : ''} failed to render
          </p>
          <p className="text-sm mt-1">{error.message}</p>
          {isDev && objuiError?.code && (
            <p className="text-xs mt-1 text-orange-500">
              Error code: {objuiError.code}
              {objuiError.details?.suggestion ? (
                <span className="block mt-0.5">💡 {String(objuiError.details.suggestion)}</span>
              ) : null}
            </p>
          )}
          <button type="button"
            onClick={this.handleRetry}
            className="mt-2 text-sm underline hover:no-underline"
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * Shared "no data source" fallback. MUST be a module constant: it feeds the
 * `evaluatedSchema` memo below, and a fresh `{}` per render defeats that memo
 * for every SchemaRenderer without a provider above it — re-cloning the schema
 * and re-running the ExpressionEvaluator on each render, and handing a new
 * schema identity to children that memoise on it. For a `kind:'react'` page
 * that identity IS the compile key, so the page was silently remounted and its
 * `useState` wiped (objectui#2954's latent hazard, made real by this line).
 */
const NO_DATA_SOURCE: Record<string, any> = {};

/**
 * One outgoing bag, minus an authored `data` key, on the object arm
 * (objectui#9571, extended to the legacy alias by objectui#9758).
 *
 * ## Why a shared helper and not two copies of four lines
 *
 * `createElement` below spreads the node's own non-metadata keys and the legacy
 * `props` alias bag as two separate spreads, in that order. objectui#9571
 * stripped the first; the alias spread ran AFTER it, so the identical authored
 * key spelled `props: { data }` walked straight back into the seat the ruling
 * had just taken away — the same defect, one alias over (objectui#9758,
 * decision batch #167 item 2, letter 剥, maintainer 「其他同意」). Two call
 * sites answering the same question is exactly how the first carrier survived
 * the first ruling, so the question is asked once, here.
 *
 * ## Identity is the signal, and that is load-bearing
 *
 * The `in` test comes FIRST, so a bag that declares no `data` — the
 * overwhelmingly common one — is handed back ITSELF, with no copy allocated and
 * no key moved. Callers read that same identity (`result !== bag`) to decide
 * whether to warn, so the decision is never computed twice and cannot disagree
 * with what was actually spread.
 *
 * ⛔ The HOST path is NOT routed through here. `...props` — this component's own
 * React props, spread LAST — is how `plugin-list`'s `ListView` and `ObjectView`
 * hand down rows they already fetched; gating that was Option B, and it was
 * REFUSED on objectui#9571. Only the AUTHORED key loses its seat.
 */
function withoutAuthoredDataKey<T extends object>(bag: T, refuse: boolean): T {
  if (!refuse || !('data' in bag)) return bag;
  const { data: _refusedAuthoredData, ...rest } = bag as Record<string, unknown>;
  return rest as T;
}

/**
 * The legacy `props` alias bag, minus an authored `objectFields`
 * (objectui#8818, completing decision batch #70 / objectui#7742).
 *
 * `objectFields` is the object's field catalogue — the predicate layer reads it
 * to decide how a conditional-formatting rule compares a relation field — and
 * batch #70 ruled it a RUNTIME React prop a host injects, never authorable
 * metadata. The metadata strip in `SchemaRenderer` closes the top-level and
 * hoisted `properties` spellings; this closes the third, because the alias bag
 * is spread as its own bag after that strip and never passes through it.
 *
 * Every arm, unconditionally — unlike {@link withoutAuthoredDataKey}, the key
 * has no authorable reading on any type. Identity is preserved when the bag
 * declares no `objectFields`, so the common node allocates nothing.
 *
 * ⛔ The HOST path is NOT routed through here: `...props`, spread LAST, is how
 * a host hands the catalogue down, and it still arrives.
 */
function withoutAuthoredObjectFields<T extends object>(bag: T): T {
  if (!('objectFields' in bag)) return bag;
  const { objectFields: _runtimeOnlyObjectFields, ...rest } = bag as Record<string, unknown>;
  return rest as T;
}

/**
 * The props `SchemaRenderer` DECLARES and reads itself (objectui#4548).
 *
 * ## Why `schema` is spelled as this union and not as a `SchemaNode`
 *
 * The repo carried two competing `SchemaNode` types: `@object-ui/core`'s
 * interface (which requires `type: string`) and `@object-ui/types`' union (then
 * `BaseSchema | string | number | boolean | null | undefined`). This component
 * matched NEITHER. It declared core's — narrower than what it accepts, so every
 * caller holding the types union was wrong and could not be told — while its
 * runtime returns early for strings and nullish, which core's interface forbids.
 * The erasure below hid the mismatch completely: with props collapsed to an
 * index signature, `schema` resolved to `any` and no call site was ever checked.
 *
 * So the contract is STATED HERE, by this component, as what it actually
 * handles: an object schema, a bare string (rendered as text), or nothing at
 * all. `number` / `boolean` are deliberately excluded — the runtime tolerates
 * them defensively (see the primitive guard in the evaluation memo) but no
 * author should be invited to pass them; `toRenderableSchema` (`./schema-input`)
 * is the bridge from a `SchemaNode` that may hold one.
 *
 * ## The object member is `DeclaredNode` (objectui#11466)
 *
 * The object member is `DeclaredNode` from `@object-ui/types`, the same type a
 * node slot takes: the discriminated union, keyed by the literal `type`, of the
 * component schemas that package declares, the spec-declared `AuthoringNode`s
 * (objectui#11364: public blocks, `element:text_input` /
 * `element:record_picker`, a stored page document under its page kind), and
 * the types an application declares in `CustomNodeRegistry`. It has no
 * `type: string` arm, so a node whose `type` no declaration names is refused
 * here, and each node's own keys are judged: since objectui#8347 removed
 * `BaseSchema`'s index signature, a misspelled key is refused while the
 * declared spelling compiles. ⛔ The prop is widened by declared types only,
 * never by an index signature, a `Record` or a `type: string` arm.
 */
export interface SchemaRendererProps {
  schema: DeclaredNode | string | null | undefined;
}

/**
 * The open forwarding surface, named once so it reads as the decision it is.
 *
 * `SchemaRenderer` passes every prop it does not itself read straight through to
 * the component the schema names, which is resolved at RUNTIME from a
 * plugin-extensible registry — so the set of valid keys is not knowable here,
 * and `packages/react/README.md` documents callers relying on it. The `any` is
 * the point: this is a pass-through channel, not a typed prop.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- see doc comment above: the forwarded value is opaque to this component by construction.
type ForwardedProps = Record<string, any>;

/**
 * The renderer loop.
 *
 * ## The explicit type annotation is the contract, and it is deliberate
 *
 * `forwardRef< T, P >` routes `P` through React's `PropsWithoutRef`:
 *
 *     Props extends any ? ('ref' extends keyof Props ? Omit< Props, 'ref' > : Props) : Props
 *
 * A string index signature on `P` puts `string` into `keyof Props`, so
 * `'ref' extends keyof Props` is ALWAYS true, the `Omit` branch always runs, and
 * `Omit` over a type carrying a string index signature keeps ONLY the index
 * signature. Every declared prop is erased — on both sides. This component used
 * to hand `forwardRef` a props type of `{ schema: SchemaNode } & Record< string,
 * any >`, so its own `schema` resolved to `any` at every one of the ~376 call
 * sites in this repo, and was not even REQUIRED: `< SchemaRenderer / >` with no
 * schema at all type-checked (objectui#4548, measured).
 *
 * The fix is NOT to close the surface. This is the renderer loop: it forwards
 * every prop it does not read to the component the schema names, resolved at
 * RUNTIME from a plugin-extensible `ComponentRegistry`. That forwarding is a
 * documented, load-bearing feature — `packages/react/README.md` shows
 * `< SchemaRenderer schema={formSchema} onSubmit={handleSubmit} / >`, and
 * `@object-ui/components`' form renderer consumes that `onSubmit` as a React
 * prop. A closed props type would state a FALSE contract and would force every
 * leaf plugin's props into this package to stay usable.
 *
 * So the two halves are separated deliberately:
 *
 *   * the `forwardRef` TYPE ARGUMENT is the honest `SchemaRendererProps`, with
 *     no index signature — nothing for `PropsWithoutRef` to collapse, so
 *     `schema` survives to the call site typed and required; and
 *   * the open forwarding surface is stated ONCE, here, in this export
 *     annotation. Because the annotation is applied to the already-built
 *     component, `PropsWithoutRef` never runs over it, so `Record< string, any >`
 *     widens the surface WITHOUT erasing anything.
 *
 * The repo-wide guard (`scripts/__tests__/forwardref-props-erasure.guard.test.ts`)
 * judges the TYPE ARGUMENT only, for exactly this reason: an index signature
 * there is an accidental eraser, whereas one here is a stated contract.
 */
export const SchemaRenderer: ForwardRefExoticComponent<
  SchemaRendererProps & ForwardedProps & RefAttributes<unknown>
> = forwardRef<unknown, SchemaRendererProps>(({ schema, ...props }: SchemaRendererProps & ForwardedProps, _ref) => {
  const context = useContext(SchemaRendererContext);
  const dataSource = context?.dataSource || NO_DATA_SOURCE;
  // Ambient host scope (user / features), fed by app-shell's
  // ExpressionProvider. Threaded into `visible`/expression evaluation so
  // component predicates can gate on the signed-in user & deployment flags.
  const ambientScope = usePredicateScope();
  // ── The API binding (objectui#12197) ──────────────────────────────────────
  //
  // `@objectstack/spec`'s `ElementApiDataSourceSchema` declares what a node
  // with `dataSource: { provider: 'api', read: { url }, path? }` does: it reads
  // that one same-origin endpoint with the host's signed-in fetch and binds the
  // selected value, "which the element reads as `data` in its expression holes
  // and its `visibleWhen`". Both are evaluated in the memo below, so this is
  // where the binding is honoured, for every node type: the read is the hook's
  // (`element-data-source/useElementApiDataSource.ts`), and its answer becomes
  // the `data` root of this node's evaluation scope.
  //
  // ⚠️ This is NOT the adapter-as-`data` root objectui#9308 retired. That root
  // published the injected adapter, against which every `data.*` path resolved
  // `undefined`; this one is the value the node's own binding selected, and it
  // exists only on a node that declares one. A node with no API binding is
  // byte-for-byte what it was: `ambientScope` passes through untouched.
  //
  // The answer is also published to the node's SUBTREE through
  // `PredicateScopeProvider` (below), because a block's members are evaluated
  // there — `useConfigBagEvaluator` reads the predicate scope, as does every
  // nested `SchemaRenderer` — so a member's `${data.x}` resolves against the
  // same value as the node's own.
  //
  // The evaluation memo builds its scope from the answer's VALUE (the hook's
  // state) and keys on it, never on a memo's identity (AGENTS.md #10). The
  // subtree's copy is memoised for cost only: an evaluation keyed on it
  // recomputes the same values if React discards it.
  const apiBinding = useElementApiDataSource(schema);
  const apiStatus = apiBinding.status;
  const apiData = apiBinding.data;
  const subtreeScope = useMemo(
    () => (apiStatus === 'ready' ? { ...ambientScope, data: apiData } : ambientScope),
    [ambientScope, apiStatus, apiData],
  );
  // The row the page is about, from `RecordContextProvider` (objectui#5454).
  //
  // `@objectstack/spec` has always DECLARED that a component node's
  // `visibleWhen` binds it — `page.zod.ts`: *"Binds `record`, `current_user`,
  // `page.<var>`"* — and until this change the evaluator below bound no
  // `record` at all, on any block, on any record page. A `record.*` predicate
  // therefore could not resolve; this surface is fail-soft, so it resolved to
  // SHOWN. That is not a gate that misfires, it is a gate that never gates:
  // both polarities of the same predicate returned the same verdict, measured
  // on `record:alert`, `record:path`, `page:card` and `element:text`.
  //
  // Bound as the `record` ROOT ONLY — the exact three roots the describe
  // promises, and nothing else:
  //
  //   * NOT as bare fields. `page:tabs`' item-level predicate spreads the row
  //     flat as well (`containers.tsx`), but that breadth is undeclared on
  //     both surfaces, and contract-first (AGENTS.md #0.1) says bind what the
  //     spec states rather than accrete a second de-facto spelling here.
  //   * NOT over `data`. `data` on this evaluator is the data-source ADAPTER
  //     from `SchemaRendererContext`, which is what `${data.total}` in a
  //     `properties` / `props` / `content` value resolves against — a
  //     documented, pinned binding. Overwriting it with the row would be a
  //     silent interpolation change nobody asked for.
  const recordContext = useRecordContext();
  const boundRecord = recordContext?.data;
  // Page-local state (PageSchema.variables), provided by PageVariablesProvider.
  // Exposed to predicates/bindings under `page.<var>` so an interactive element
  // (e.g. element:record_picker) writing a variable can drive another
  // component's `visible`/`visibility`. Empty object outside a Page.
  const { variables: pageVariables } = usePageVariables();

  // Re-render trigger when the global ComponentRegistry mutates (e.g. a
  // lazy-loaded plugin finishes registering its components).
  const [, forceUpdate] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const unsubscribe = ComponentRegistry.subscribe(forceUpdate);
    // Recheck after mount: if the lazy plugin finished registering between
    // the first render and this effect (e.g. its module was already cached so
    // notify() fired synchronously before subscribe()), we'd otherwise stay
    // stuck on the "Loading…" fallback forever. A one-shot forceUpdate gives
    // the next render a fresh look at the registry.
    forceUpdate();
    return unsubscribe;
  }, []);
  const [lazyError, setLazyError] = useState<Error | null>(null);
  // Stable fallback id for scoping a styled node that didn't declare an `id`.
  const autoStyleId = React.useId();

  // Evaluate schema expressions against the data source
  const evaluatedSchema = useMemo(() => {
    // Nothing to evaluate unless the node is an OBJECT. `!schema` covers the
    // nullish/empty cases and `typeof !== 'object'` covers every primitive —
    // both return the value untouched for the render pass below to place.
    //
    // The `typeof` half is what used to be missing (objectui#4548): the guard
    // named `string` only, so a `number` or `true` fell through to the
    // `{ ...schema }` shallow copy on the next line, spread to an EMPTY object,
    // lost its `type`, and surfaced as the red "Unknown component type:
    // undefined" box — an accident of the spread, not a decision. The declared
    // props type now excludes those primitives outright; this guard is the
    // defence-in-depth behind it, and it is what makes the copy below provably
    // an object spread.
    if (!schema || typeof schema !== 'object') return schema;

    // The scope's host roots, plus the node's API-bound `data` once it has
    // answered (see "The API binding" above).
    const predicateScope: Record<string, unknown> =
      apiStatus === 'ready' ? { ...ambientScope, data: apiData } : ambientScope;

    // The ambient host scope, plus the roots this tier can answer itself.
    // `current_user` is aliased to `user` so both `user.email` and
    // `current_user.email` resolve in component `visible`/`visibleOn`
    // expressions. `page` exposes page-local state so predicates can gate on
    // `page.<var>` (e.g. a record picker's selection toggling another
    // component's visibility).
    //
    // ⛔ `data` is NOT here, and the absence is the decision (objectui#9308,
    // maintainer ruling 2026-09-13 option B). This used to read
    // `data: dataSource` — the host's injected ADAPTER, published as an
    // expression root. `ExpressionProvider` states the governing principle for
    // the tier above: "Every root below is one the engine accepts AND one this
    // tier can actually answer", and objectui#8155 (`app`) and objectui#8166
    // (`data`) applied it there. Against a conformant `DataSource` adapter
    // every `data.*` path resolves `undefined`, so this tier could not answer
    // the root it bound: it published a name that was silently constant on
    // every row. ADR-0089 D3 puts `data` at the METADATA layer
    // (`CANONICAL_ROOT_BY_LAYER = { runtime: 'record', metadata: 'data' }`) and
    // the engine's per-surface `FIELD_RULE_BOUND_ROOTS` is
    // `['record','previous','parent']`. The row is `record`.
    //
    // ⭐ Ordering consequence, and the second half of the same ruling: the
    // spread below used to be followed by `data: dataSource`, so a host that
    // legitimately published `data` through the documented scope channel
    // (`PredicateScopeProvider`) was silently OVERWRITTEN by the adapter.
    // Removing the line un-shadows that channel — a host root named `data` now
    // survives, like every other root a host publishes.
    //
    // `record` is written AFTER the ambient spread so a page's own row wins
    // over anything a host put in the scope — the same precedence
    // `usePredicateRecordContext` states for the `useCondition` tier. And it is
    // written CONDITIONALLY, for the other half of that same rule: no row binds
    // NOTHING rather than an empty object. `{ record: undefined }` would SHADOW
    // a `record` a host had legitimately supplied through the ambient scope
    // (how `action:group`'s dropdown leaf is driven), turning "this surface has
    // no row of its own" into "this surface's row is empty" — only the latter
    // is entitled to shadow.
    //
    // Built by `buildNodeEvaluationScope`, which `useConfigBagEvaluator`
    // shares, so an action container's members evaluate against this same
    // scope (objectui#10290), and which the `page:tabs` badge in
    // `@object-ui/components` calls for its `visibleWhen` gates
    // (objectui#12992).
    const evaluator = new ExpressionEvaluator(
      buildNodeEvaluationScope(predicateScope, boundRecord, pageVariables),
    );
    // Shallow copy: the interpreter's working copy, typed as renderer state
    // rather than as the authoring face (objectui#11349). See
    // `InterpreterWorkingCopy` for what it declares and why.
    const newSchema: InterpreterWorkingCopy = { ...schema };
    // A node whose API binding has not answered is not evaluated: its holes
    // name a `data` that does not exist yet, so evaluating them would report
    // every one as unresolvable and decide its `visibleWhen` against nothing.
    // The render pass below draws the binding's state instead.
    if (apiStatus !== 'absent' && apiStatus !== 'ready') return newSchema;

    /**
     * Evaluate ONE visibility predicate, and make an unresolvable one LOUD
     * (objectui#5454, leg 3 of the 2026-08-21 ruling).
     *
     * ## A fault fails CLOSED (objectui#13299)
     *
     * `evaluateCondition` answers an unresolvable predicate with `true`, on
     * every one of its three internal paths: the CEL envelope fails soft to its
     * `true` fallback, a bare expression that throws is caught and returns
     * `true`, and a `${…}` template that throws returns its own SOURCE TEXT,
     * which is a non-empty string and therefore truthy. Passing
     * `throwOnError: true` changes none of those verdicts — it only converts
     * "could not evaluate" from a value into a throw.
     *
     * Until objectui#13299 this helper reproduced that `true` on a fault, which
     * drew a node behind a faulting `visibleWhen` / `visible` / `visibleOn` for
     * a viewer the predicate was written to exclude. Both branches now answer a
     * fault with {@link visibilityFaultOutcome}'s verdict instead: a DECLARED
     * predicate that faults leaves the node unrendered on every leg (the SHOW
     * legs answer `false`, the HIDE legs keep the `true` that already hid), and
     * a blank gate that declares nothing keeps the fail-soft `true`. A predicate
     * that evaluates decides exactly as before. Form field rules
     * (`visibleWhen` / `readonlyWhen` on a field) do not route through here and
     * keep their documented fail-open.
     *
     * ## Why it needed saying at all
     *
     * A fail-soft surface answers "this predicate is broken" and "this
     * predicate said yes" with the same word. On the negated legs that word is
     * SHOWN, so a `record.*` gate written before objectui#5454 bound the row
     * rendered its block unconditionally and looked exactly like a gate the
     * author had got right. One of the three paths was already loud — the CEL
     * envelope's `evalFieldPredicate` warns (objectstack#5149) — and the other
     * two were mute, so whether an author heard about their own typo depended
     * on which dialect they happened to write it in.
     *
     * Deduped per (node type, key, predicate source): a broken predicate is
     * re-evaluated on every render, and the point is one line, not a wall. The
     * key is the predicate SOURCE TEXT plus the gate it was authored on — never
     * the render and never the schema object — so the same broken predicate
     * rendered over two hundred rows reports once, and a SECOND distinct
     * predicate still reports (objectui#6038 pins both halves).
     *
     * ## Production is loud too, since objectui#6038
     *
     * It was `__DEV__`-only, and the maintainer's 2026-08-25 ruling retired
     * that silence: a gate that stops biting in production used to leave
     * nothing on the console for the bare-string dialect, so a class-1 defect
     * could sit live and undiscovered (measured in objectstack#11254). The
     * `__DEV__` gate below no longer decides WHETHER the fault is reported,
     * only HOW it is detected — see the two branches.
     *
     * ## Defined HERE, ahead of the `properties` evaluation loop below
     *
     * It used to sit just above `shouldHide`, its only caller. objectui#5756
     * added a second call site — inside the `properties` loop below, on the
     * raw (pre-evaluation) text of whichever key that loop is about to collapse
     * — so the definition moved up to be in scope for both. Nothing about the
     * function changed; `shouldHide` below still calls it exactly as before,
     * on the POST-evaluation, POST-hoist schema, for the real verdict.
     */
    const evaluateVisibilityPredicate = (
      raw: VisibilityPredicate,
      key: VisibilityChainKey,
    ): boolean => {
      // WHAT a fault decides on this leg and WHICH consequence it reports
      // (objectui#6503, objectui#13299) come from ONE function, used by both
      // branches, so the production and the development verdict cannot
      // disagree, and neither can their reports about what the fault DID.
      //
      // PRODUCTION STILL MAKES THE SINGLE CALL — it just no longer makes it
      // in silence (objectui#6038, maintainer ruling 2026-08-25, option B).
      //
      // `throwOnError` remains the DEV probe and remains too expensive to ship:
      // on the CEL branch `evaluateCelCondition` implements it by evaluating
      // TWICE (once with each fallback — a value that tracks the fallback both
      // times is a fault), and spec-parsed metadata normalizes `visibleWhen`
      // into a `{ dialect: 'cel' }` envelope, so that branch is the common one
      // in production. Paying for the probe here would double the engine calls
      // for every predicate of every node.
      //
      // `onFault` is the way out of that trade: the evaluator hands back the
      // reason at the point it ALREADY knows the predicate faulted, inside the
      // catch it already runs, so the fault becomes observable at ONE engine
      // call. objectui#6038 made it observable; objectui#13299 also makes it
      // DECIDE: the same callback records the fault on this single call, and
      // a faulted call answers with the fail-closed verdict rather than the
      // evaluator's fail-soft `true` (the objectui#13286 shape, no second
      // `throwOnError` evaluation).
      //
      // The reporter is the SAME one the dev branch below uses: same message,
      // same severity, same dedupe `Set`, same key. Production and development
      // now print the identical line for the identical fault, which is the
      // property the `__DEV__` gate used to cost us.
      if (!__DEV__) {
        let fault: ReturnType<typeof visibilityFaultOutcome> | undefined;
        const verdict = evaluator.evaluateCondition(raw, {
          onFault: (reason) => {
            fault = visibilityFaultOutcome(key, raw);
            // `'page-component'` stated rather than defaulted (objectui#6487):
            // this is the tier whose roots the spec declares for a node gate,
            // and saying so here is what keeps the advice paragraph a decision
            // this call site owns.
            reportUnresolvableVisibilityPredicate(
              newSchema.type,
              newSchema.id,
              key,
              raw,
              reason,
              'page-component',
              fault.gate,
            );
          },
        });
        return fault ? fault.verdict : verdict;
      }
      try {
        const verdict = evaluator.evaluateCondition(raw, { throwOnError: true });
        // objectui#5687 — the NON-throwing half of the same silence, and it is
        // reachable ONLY here, on the branch where the predicate evaluated
        // cleanly. A `data.*` read the adapter cannot answer is not a fault the
        // evaluator can raise: `undefined == 'draft'` is a perfectly good
        // `false`. Verdict untouched — `verdict` is returned exactly as
        // computed, which is what keeps the ruling's "no verdict changes" true
        // by construction rather than by review.
        //
        // objectui#9308: the object handed over is the `data` the HOST
        // published in the ambient scope — the one the evaluator above
        // actually resolved `data.*` against — and no longer the adapter. The
        // renderer binds no `data` of its own, so passing the adapter here
        // would report reads the evaluator never made against it.
        reportAdapterOnlyDataPredicate(
          newSchema.type,
          newSchema.id,
          key,
          raw,
          (predicateScope as any)?.data,
        );
        return verdict;
      } catch (err) {
        const fault = visibilityFaultOutcome(key, raw);
        reportUnresolvableVisibilityPredicate(
          newSchema.type,
          newSchema.id,
          key,
          raw,
          err,
          'page-component',
          fault.gate,
        );
        // The fail-closed answer (objectui#13299) — identical to what the
        // production branch above returns for the same input, because both
        // read it off the same function, which is what keeps the two branches
        // one behaviour rather than two.
        return fault.verdict;
      }
    };

    /**
     * Evaluate ONE enablement predicate (`disabled` / `disabledOn`), and make an
     * unresolvable one LOUD (objectui#6445).
     *
     * ## Why this pair needed its own card at all
     *
     * Six legs of the visibility chain above route through
     * {@link evaluateVisibilityPredicate} and report. These two called
     * `evaluateCondition` BARE, so a faulting `disabled` predicate had never
     * been reported in any build, in any dialect that does not report on its
     * own — the only uninstrumented predicate pair left in this file.
     *
     * And it is the pair where the fail-soft default BITES. `evaluateCondition`
     * answers an unevaluable predicate with `true`; on the negated visibility
     * legs that means SHOWN, here it means GREYED OUT. The asymmetry this file
     * already records for objectui#3862/#3955 cuts the other way for the
     * console: "a greyed-out control is still on screen", so the user has a
     * symptom and the author has nothing to grep for. That is why the reporter
     * is handed a different consequence paragraph (`'enablement'`) rather than
     * the visibility copy, which states the opposite of what this gate did.
     *
     * ## The verdict is byte-for-byte what it was
     *
     * `evaluateCondition(raw)` with an `onFault` callback returns exactly what
     * `evaluateCondition(raw)` returned: `onFault` is invoked for its side
     * effect and its return value is ignored (objectui#6038's seam). Fail-soft
     * is PRESERVED deliberately — flipping it is a shipped-behaviour change on
     * a live surface and is not this card's to make.
     *
     * ## One engine call, both builds — still true after objectui#6504
     *
     * The FAULT report above is unconditional either way: `onFault` alone
     * covers both builds, one engine call, one code path, dev and production
     * print the same line by construction. objectui#6504 adds a SECOND,
     * dev-only check after that same call returns — not a second evaluation,
     * a lexical scan of the already-available predicate source and the
     * already-available `dataSource` — so production keeps its one-call,
     * one-path shape exactly as this docblock described before this leg
     * existed; only development pays for the extra check, and only after a
     * clean (non-faulting) evaluation.
     *
     * ## objectui#5687's diagnostic, extended (objectui#6504, maintainer
     * ruling 2026-08-27 option A)
     *
     * Was deliberately NOT called here — see the card this replaces filed at
     * objectui#6504: the 2026-08-22 ruling was scoped to the visibility gate,
     * and its message text ("a constant `false` hides the node on every row")
     * is not what a constant does to a `disabled` gate. The 2026-08-27 ruling
     * answers both gaps: extend to `disabled` / `disabledOn`, dev-only exactly
     * as the visibility leg is (⛔ always-on was excluded, outside the #5687
     * precedent), with its OWN copy — the constant-`true` direction, since on
     * THIS gate that is the polarity that greys the control out in silence.
     * `ADAPTER_ONLY_GATE_COPY['enablement']` (`visibilityDiagnostic.ts`) is
     * that copy, and it carries the same #5330 dissolution pointer #5687's
     * entry does: both legs retire together when that window closes.
     *
     * ## The `key` parameter is CLOSED (objectui#9107)
     *
     * Typed {@link EnablementNodeGateKey} rather than `string`, mirroring what
     * {@link VisibilityChainKey} does for the sibling chain: the two legs this
     * function serves are declared in ONE place, and the config-bag guard
     * ({@link preservePredicateEnvelope}) reads that same declaration, so a
     * third leg cannot arrive here without the same edit also carrying its CEL
     * envelope through the bag loops.
     *
     * Reachable only on the branch where the predicate evaluated CLEANLY —
     * `faulted` mirrors {@link evaluateVisibilityPredicate}'s try/catch split
     * without paying for a second (`throwOnError`) engine call: `onFault` is
     * already told exactly when the single call it wraps did not produce a
     * clean verdict, so a local flag reuses that same signal instead of
     * re-deriving it. A predicate that faults is the OTHER reporter's case,
     * immediately above, in the same way it already is on the visibility leg.
     */
    const evaluateEnablementPredicate = (raw: VisibilityPredicate, key: EnablementNodeGateKey): boolean => {
      let faulted = false;
      const verdict = evaluator.evaluateCondition(raw, {
        onFault: (reason) => {
          faulted = true;
          reportUnresolvableVisibilityPredicate(
            newSchema.type,
            newSchema.id,
            key,
            raw,
            reason,
            // Stated, not defaulted, for both arguments (objectui#6487,
            // objectui#6445): this is the node tier, whose roots the spec
            // declares, and the gate whose safe default disables the control.
            'page-component',
            'enablement',
          );
        },
      });
      if (__DEV__ && !faulted) {
        // objectui#9308 — same re-aim as the visibility leg above.
        reportAdapterOnlyDataPredicate(
          newSchema.type,
          newSchema.id,
          key,
          raw,
          (predicateScope as any)?.data,
          'enablement',
        );
      }
      return verdict;
    };

    /**
     * Evaluate ONE config value by its key — THE place the `params` rule is
     * stated (objectui#7867, ruling A, maintainer 「其他同意」 2026-09-20):
     * *an action's `params` values are templates, evaluated where `properties`
     * are.*
     *
     * A `params` BAG (a plain object — {@link isParamsBag}) has every string
     * leaf evaluated at any depth, through the same `evaluator` and so against
     * the same scope as every other value in this memo; every other value
     * evaluates exactly as it did (per-value and shallow, with a CEL predicate
     * envelope preserved — {@link preservePredicateEnvelope}). The walk, and
     * what it will not look inside (non-plain objects, keys, cycles, an ARRAY
     * `params`, which is the `ActionParam[]` definition list), are defined once
     * in `utils/paramsBag.ts`, which the unevaluated-expression diagnostic reads
     * too — so what is evaluated and what is reported as left unresolved are
     * one radius, not two.
     *
     * Three carriers, one rule — the ruling names two of them and the third
     * follows its canonical bag, as every per-key rule in these loops does:
     *
     *   1. node-level `params`, immediately below;
     *   2. `properties.params`, in the `properties` loop, BEFORE the hoist —
     *      so the object the hoist copies onto the node (and the renderer
     *      reads as `schema.params`) is the evaluated one, and
     *      `schema.properties.params` agrees with it;
     *   3. `props.params`, in the legacy-alias loop — the two bag loops must
     *      not disagree about a key (objectui#5123, objectui#9100).
     *
     * Each authored value is evaluated exactly once: the node-level leg runs
     * before the hoist, so when `properties.params` wins the hoist it replaces
     * an evaluated node-level bag with an evaluated bag of its own, and nothing
     * already evaluated is evaluated again.
     *
     * Before this, the node-level bag was never evaluated at all, and
     * `properties.params` was ONE value of a shallow loop: measured through the
     * real `SchemaRenderer` -> `action:button` -> runner on a record page bound
     * to `{ id: 'rec_1' }`, both `params.recordId: '${record.id}'` spellings
     * reached the handler raw while `properties.label: 'L-${record.id}'`
     * rendered `L-rec_1`. A template that still cannot resolve keeps its source
     * text (that is the evaluator's own contract) and is reported by the
     * unevaluated-expression diagnostic, so a wrong template stays loud.
     */
    //
    // A DATA OBJECT on any other key ({@link isDataObjectValue},
    // objectui#10288) is handed over as authored: `evaluate` would collapse
    // one that carries a string `source` to that string. An inline locale map
    // is the one object that is not: each member is evaluated like a plain
    // string on the same key (objectui#12936, `utils/localeMap.ts`).
    //
    // The rule itself is `evaluateConfigValueWith`, at module scope, so that
    // `useConfigBagEvaluator` applies the same one to an action container's
    // members (objectui#10290).
    const evaluateConfigValue = (key: string, value: unknown): unknown =>
      evaluateConfigValueWith(evaluator, key, value);

    // Carrier 1 of the `params` rule above: the node-level bag. A non-bag
    // node-level `params` (the `ActionParam[]` definition list, or anything
    // degenerate) is left exactly as authored, as it always was.
    if (isParamsBag(newSchema[PARAMS_KEY])) {
      newSchema[PARAMS_KEY] = evaluateConfigValue(PARAMS_KEY, newSchema[PARAMS_KEY]);
    }

    // Evaluate 'properties' — the SPEC spelling of a node's config bag, of
    // which `props` (evaluated below) is the legacy alias.
    //
    // objectui#4799: only `props` used to be evaluated here. Renderers in the
    // `element:*` namespace read their config out of `schema.properties` FIRST
    // (`readProps()` merges `{ ...schema.props, ...schema.properties }`), so a
    // node written the canonical way handed the renderer the RAW `${…}` source
    // and put it on screen verbatim, while the same node written with the
    // "legacy alias" evaluated correctly. Measured through a real render with
    // `dataSource: { total: 99 }`: `props: { content: '${data.total}' }` → `99`,
    // `properties: { content: '${data.total}' }` → `${data.total}`. That is the
    // inverse of contract-first (AGENTS.md #0.1) — the tolerant spelling was
    // fed and the canonical one starved — so the fix belongs HERE, at the one
    // producer of evaluated schema, not as a second read in each consumer.
    //
    // Order matters: this runs BEFORE the hoist block below, because that block
    // copies every `properties.*` value onto the node's top level (and those
    // copies are spread as React props at render). Evaluating first is what
    // makes one key mean one thing whether it is read as `schema.properties.x`,
    // as `schema.x`, or as the `x` prop. It also leaves the `content` leg below
    // idempotent: a value evaluated here no longer carries a `${…}`.
    //
    // Per-value and SHALLOW, matching the `props` branch exactly:
    // `evaluator.evaluate` returns every non-string untouched, so a nested
    // object/array value is passed through rather than walked (measured: an
    // `aria: { label: '${data.total}' }` nested under EITHER key renders the raw
    // source today). Deepening that is a separate decision and would have to be
    // taken for both spellings at once — not smuggled in on one side here.
    //
    // ONE key is deep, by that separate decision, and on both spellings at once:
    // `params` (objectui#7867, ruling A) — every string leaf of a `params` bag
    // is evaluated, through {@link evaluateConfigValue} above. ONE value shape
    // is one level deep, on any non-predicate key and both spellings: an inline
    // locale map's members (objectui#12936). Every other value keeps the
    // shallow reading this paragraph describes.
    //
    // "Passed through" used to have one exception: `evaluate` unwraps an object
    // with a string `source` to that string, so a data object carrying a
    // `source` field was collapsed rather than passed. Since objectui#10288 an
    // object on a non-predicate key reaches `evaluate` only when it is a spec
    // Expression envelope (it carries a `dialect`); see {@link isDataObjectValue}.
    //
    // Guarded by {@link isConfigBag}: a degenerate value must not have its shape
    // reinterpreted by an object spread. Non-objects skip evaluation and reach
    // the hoist — which, since objectui#6760, refuses them on its own.
    //
    // ⚠️ This guard used to say it was wider than the `props` branch BECAUSE
    // this value feeds the hoist. That reason did not survive measurement
    // (objectui#6752). Ablating this guard to bare truthiness and re-rendering
    // `{ type, properties: 'not-a-bag' }` on `b76ca6764` left the indexed
    // keys the hoist puts on the node completely UNCHANGED — `0` … `8` either
    // way, because the hoist's own `Object.entries` walk enumerated a string's
    // character indices whatever this line did — and moved exactly one thing:
    // whether `schema.properties` still holds the value the author wrote
    // (`'not-a-bag'` guarded, `{ '0': 'n', … }` ablated). So what this buys is
    // the AUTHORED value's shape, which is channel-independent, and the `props`
    // branch below carries the same guard for the same reason.
    //
    // ⭐ That measurement is also why objectui#6760 gave the HOIST its own
    // guard instead of widening this one: this line never reached the indexed
    // keys, so nothing written here could have removed them. With both guards
    // in place the two are in SERIES, not redundant, and re-running the same
    // ablation now reads the opposite way — measured on this card's branch,
    // ablating THIS line to bare truthiness brings `0` … `8` BACK, because the
    // bare spread manufactures a real `{ '0': 'n', … }` bag out of the string
    // and the hoist below then enumerates it legitimately. Each guard is load
    // bearing for a different half: this one keeps the authored value's shape,
    // the hoist's one declines to enumerate a value that never had keys.
    // Snapshotted BEFORE evaluation — objectui#5756's diagnostic below reads
    // the RAW (pre-collapse) text from this reference, since `newSchema.properties`
    // is about to be replaced with the evaluated copy.
    const rawPropertiesBag: Record<string, unknown> | undefined = isConfigBag(
      newSchema.properties
    )
      ? newSchema.properties
      : undefined;

    if (rawPropertiesBag) {
      // objectui#9100 — a CEL predicate envelope survives this loop; see
      // `preservePredicateEnvelope`. objectui#7867 — a `params` bag has every
      // string leaf evaluated (carrier 2 of `evaluateConfigValue`). Every
      // other value evaluates as before. The loop is `evaluateConfigBagWith`,
      // the one `useConfigBagEvaluator` runs over an action container's
      // member (objectui#10290).
      newSchema.properties = evaluateConfigBagWith(evaluator, rawPropertiesBag);
    }

    /**
     * objectui#5756 — the `${…}` HALF of the #5687/#5454 silence, reached at
     * the one point in this render where it still can be: BEFORE the hoist
     * (which would bury it under the node-level keys) and immediately AFTER
     * the loop above (so `newSchema.properties` already reflects which key
     * would win the SAME precedence `shouldHide` applies later — see
     * {@link winningVisibilityKey}).
     *
     * A `${…}`-spelled visibility predicate written inside `properties` is
     * evaluated — and collapsed to a plain boolean — by the loop directly
     * above, before `shouldHide` (and its #5454/#5687 reporter) ever sees it.
     * The bare-string spelling of the SAME gate (`properties: { visible:
     * "data.status == 'draft'" }`) is untouched by that loop (no `${` to
     * interpolate) and reaches `shouldHide` intact, where the existing
     * reporter already catches it — this block exists only to give the
     * template spelling the same fate, not a different one.
     *
     * ## What this does NOT do
     *
     * - **No verdict change.** This call's return value is discarded; the
     *   REAL verdict is still decided by `shouldHide` below, off the
     *   POST-evaluation, POST-hoist schema, exactly as before this card.
     * - **No new report shape.** It is the SAME `evaluateVisibilityPredicate`
     *   `shouldHide` calls — same two reporters, same dedupe `Set`, same
     *   `__DEV__` gate — called one render-step earlier, on the text this
     *   step is about to erase. There is nothing here to duplicate the LATER
     *   call: by the time `shouldHide` runs, this key's value is already the
     *   collapsed boolean, which carries no `data.` text for either reporter
     *   to match — so at most one of the two calls ever fires per predicate.
     * - **Only the WINNING key.** Gated on {@link winningVisibilityKey} so a
     *   `properties.visible` template that a co-declared `visibleWhen`
     *   outranks is not reported for deciding nothing (mirrors #5454's own
     *   leg semantics: its reporter is likewise only ever invoked on the leg
     *   `shouldHide` actually consults).
     * - **Only what would actually collapse.** A bare string (no `${`) is
     *   untouched by the loop above and is left for the existing gate-time
     *   report to catch, unchanged.
     */
    if (__DEV__) {
      const winningKey = winningVisibilityKey(newSchema);
      if (winningKey && rawPropertiesBag && Object.prototype.hasOwnProperty.call(rawPropertiesBag, winningKey)) {
        const rawWinningValue = rawPropertiesBag[winningKey];
        if (typeof rawWinningValue === 'string' && rawWinningValue.includes('${')) {
          // Diagnostic only — the boolean this returns is thrown away.
          evaluateVisibilityPredicate(rawWinningValue as VisibilityPredicate, winningKey);
        }
      }
    }

    // COMPAT: Hoist 'properties' up to schema level
    // This allows support for strict configs that wrap all props in 'properties'.
    // IMPORTANT: never let inner `properties.type` / `properties.id` shadow the
    // outer component descriptor — those identify which renderer to dispatch to
    // (e.g. 'page:tabs'), whereas inner `type` may be a renderer-specific prop
    // (e.g. tab visual style: 'line' | 'card' | 'pill'). Keep `properties`
    // intact on the schema so renderers can still read these collision-prone
    // keys via `schema.properties.<key>`.
    //
    // Guarded by {@link isConfigBag}: a DEGENERATE `properties` contributes no
    // node keys at all (objectui#6760). Measured on `c6732825d`, this branch's
    // base, with no part of that card in the tree: `properties: 'not-a-bag'`
    // reached the element as nine React props named `0` … `8`, and
    // `properties: ['x', 'y']` as `0`, `1`. Nobody authored those keys — they
    // are `Object.entries`' reading of a string's character indices, and the
    // values this loop writes onto the node are spread as React props at the
    // `createElement` below.
    //
    // ## Which arm, and why this one
    //
    // objectui#6760 left two open, both cheap, both reversible, neither on the
    // manual floor (the objectui#6708 census walked every JSON document, every
    // `json` doc fence and every TypeScript object literal and found ZERO
    // authored degenerate config bags):
    //
    //   (a) guard the hoist the way the evaluation memo above is guarded;
    //   (b) rule that the hoist may enumerate whatever it is handed, and say
    //       so here.
    //
    // Arm (a), for three reasons, in the order they were weighed:
    //
    //  1. **One answer per key, whichever channel reads it.** That is
    //     objectui#5123's ruling (maintainer, 2026-08-18), and arm (b) breaks
    //     it in the loudest available place: after objectui#6752,
    //     `props: 'not-a-bag'` contributes no keys, so arm (b) would answer the
    //     SAME authored mistake two ways depending on which of two spellings of
    //     ONE bag the author used — and the reinterpreting half would be
    //     `properties`, the SPEC spelling, while the quiet half is `props`, the
    //     annotated legacy alias. A rule that punishes the canonical spelling
    //     is not a rule anyone can teach.
    //  2. **The reason for the guard was measured, and it is channel-**
    //     **independent.** objectui#6752 established it by ablation rather than
    //     by reading a comment (see the evaluation memo above): what a config-bag
    //     guard buys is the AUTHORED value's shape, which has nothing to do with
    //     which bag or which site is asking. The hoist is a third site asking the
    //     same question about the same authored value; a third answer would be
    //     drift, which is what {@link isConfigBag} exists to end (objectui#6761).
    //  3. **The failure it prevents is silent and lands on generated metadata.**
    //     A degenerate bag is a mistake an author (increasingly, an AI writing
    //     metadata) makes by writing `properties: 'text'` where a bag belongs.
    //     Arm (b) turns that into nine plausible-looking props with no warning
    //     anywhere; arm (a) makes it inert, so the mistake stays legible as the
    //     `properties` value the author actually wrote.
    //
    // What arm (a) does NOT change, measured rather than assumed: a real object
    // bag hoists exactly as before (`type`/`id` still protected above), and
    // `properties: 42` / `properties: true` were already contributing nothing
    // — `Object.entries` yields no entries for them, so this guard only ever
    // moves the string and array cases. Pinned in
    // `__tests__/SchemaRenderer.degeneratePropertiesHoist.test.tsx`.
    if (isConfigBag(newSchema.properties)) {
        const outerType = newSchema.type;
        const outerId = newSchema.id;
        const props = newSchema.properties;
        for (const [k, v] of Object.entries(props)) {
            if (k === 'type' || k === 'id') continue;
            newSchema[k] = v;
        }
        if (outerType !== undefined) newSchema.type = outerType;
        if (outerId !== undefined) newSchema.id = outerId;
        newSchema.properties = props;
    }

    // Evaluate 'content' (common in Text, Button)
    if (typeof newSchema.content === 'string') {
      newSchema.content = evaluator.evaluate(newSchema.content);
    }

    /**
     * Evaluate the SPEC-DECLARED, expression-bindable TOP-LEVEL text keys
     * (objectui#4795 Direction 1, maintainer ruling 2026-08-25).
     *
     * ## The hole this closes
     *
     * A value reaches the screen only if it is BOTH evaluated here AND read
     * back by the renderer off the node. `content` above satisfies both; the
     * other text keys satisfied neither at once, so
     * `{ type: 'statistic', value: '${data.total}' }` — whose renderer reads
     * `schema.value` (`data-display/statistic.tsx`) — put the literal
     * `${data.total}` on screen, and the `props`-envelope workaround the
     * objectui#4786 teaching rewrite retired rendered BLANK instead (evaluated,
     * then spread as a React prop nobody reads). `statistic` is the dashboard
     * workhorse and had no way at all to bind a dynamic value.
     *
     * ## Why this is ONE leg here and not a patch in each renderer
     *
     * The ruling's own implementation caution: the read-back sites must be
     * "converged on evaluated values, not patched per component". They already
     * agree on WHERE to read (the node's top level) — what they lacked was
     * anything writing an evaluated value there. Writing it at the single
     * producer of evaluated schema means `statistic.tsx`, `card.tsx` and
     * `button.tsx` are UNCHANGED by this card and every future top-level reader
     * is covered by construction. Four fixed components and no contract was the
     * failure mode named at dispatch.
     *
     * ## The vocabulary is the spec's, and is consumed rather than copied
     *
     * `@objectstack/spec` declares it (objectstack#9599): the closed set
     * `title` / `label` / `value` / `description`, plus the per-component
     * carriage map saying which of them each component type actually reads
     * back. The 2026-08-18 ruling is explicit that this memo CONSUMES the
     * declaration "rather than hard-coding a twin list" — so the only thing
     * this file knows is the name of the lookup. A row added upstream starts
     * working here with no edit; a row this file invented would be the second
     * dialect the declaration exists to prevent.
     *
     * ## The type string is passed VERBATIM
     *
     * `expressionBindableTextKeysFor` keys on the bare registry name, and the
     * spec states the answer for an unlisted type is the empty set — "closed
     * and mechanically answerable in both directions, never inferred from what
     * a renderer happens to read". So no prefix-stripping normalization: it
     * would look harmless (`ui:statistic` → `statistic`) and would in the same
     * motion grant rows to `element:button` and `page:card`, whose renderers
     * read their config out of the bag via `readProps()` and never touch these
     * keys on the node — re-manufacturing the evaluated-but-not-read-back half
     * of the very table this card exists to close. Measured on this tree: the
     * authored corpus spells these types bare (`statistic` 42, `card` 135,
     * `button` 158 nodes) and `ui:*` zero times, so verbatim is also the
     * spelling authors actually use. `action:button` (5 nodes) has no row and
     * is reported upstream rather than inferred here.
     *
     * ## Ordering and idempotence
     *
     * After the `properties` hoist deliberately, exactly like `content`: a
     * value arriving through that channel was already evaluated by the
     * `properties` leg, so it no longer carries a `${…}` and
     * `evaluator.evaluate` returns it unchanged. The `typeof === 'string'`
     * guard is doing real work rather than mirroring the line above — it stops
     * this loop CREATING an absent key as `undefined`, which would change what
     * `{ ...schema }` spreads and what `key in schema` answers downstream.
     */
    //
    // Read once into a local, so the `typeof` guard narrows the value it
    // hands to `evaluate`. Two of the four keys are `BaseSchema` members, and
    // the other two are `unknown` on the working copy (objectui#11349). The
    // spec's carriage map is their declaration, and the guard narrows them.
    for (const key of expressionBindableTextKeysFor(
      typeof newSchema.type === 'string' ? newSchema.type : '',
    )) {
      const authoredText = newSchema[key];
      if (typeof authoredText === 'string') {
        newSchema[key] = evaluator.evaluate(authoredText);
      }
    }

    // Evaluate 'props' — the legacy alias of the config bag.
    //
    // The guard MIRRORS the `properties` branch above rather than testing bare
    // truthiness (objectui#6752). Same predicate, both channels: a degenerate
    // bag must not have its shape reinterpreted by an object spread.
    //
    // Measured on `b76ca6764` through the real `SchemaRenderer`, before this
    // guard existed: a node written `{ type: 'card', props: 'not-a-bag' }`
    // reached `createElement` carrying NINE React props named `0` … `8`, one
    // per character, because `{ ...'not-a-bag' }` enumerates a string's
    // character indices. Nothing threw and nothing was logged, so the symptom
    // (a component handed nine props it never declared) sits a long way from
    // the `props` value that caused it.
    //
    // This guard is HALF the fix and does not on its own remove those props —
    // also measured, on the same base with only this line widened: the bag
    // reached `propsWithoutCanonicalKeys` as the authored string, was returned
    // unchanged, and `{ ...outgoingPropsBag }` at the `createElement` call
    // re-enumerated it. The other half is that function's own guard. What this
    // line buys is that `schema.props` keeps the value the author wrote instead
    // of the spread's reading of it.
    if (isConfigBag(newSchema.props)) {
      const newProps = { ...newSchema.props };
      for (const [key, val] of Object.entries(newProps)) {
        // objectui#9100, same guard as the `properties` branch above — the two
        // channels must not disagree about whether a `cel` envelope survives,
        // nor (objectui#7867, carrier 3) about how deep a `params` bag goes.
        newProps[key] = evaluateConfigValue(key, val);
      }
      newSchema.props = newProps;
    }

    /**
     * REFUSE, by name, a node-gate predicate parked under the legacy `props`
     * alias (objectui#9108, maintainer ruling 2026-09-13, verbatim 「同意」 on
     * the `domain:spec` seat's recommendation).
     *
     * ## Sited HERE, immediately in front of the two gates
     *
     * This is the one point where the gates' own input is final: the
     * `properties` hoist above has run, both config-bag evaluation loops have
     * run, and neither gate has consulted anything yet. It is also the only
     * placement that survives its own subject - the late diagnostics near
     * `createElement` are downstream of `if (shouldHide) return null`, so a node
     * that parks `visible` under `props` while ALSO hiding through the canonical
     * spelling would never reach them, and the refusal would go missing on the
     * one shape that carries both spellings at once.
     *
     * ## Read-only, and that is the ruled outcome rather than a limitation
     *
     * Nothing below changes. The gates still read the post-hoist node only, so
     * every verdict, every hoisted value and every byte the element receives is
     * what it was - the alias is REFUSED, not honoured. The opposite arm was
     * built and closed (PR objectui#9144): honouring it would have made *"8
     * predicate keys work while the rest stayed silently dropped - and partly
     * working is harder to learn from than not working"*.
     *
     * The bag handed over is {@link propsWithoutCanonicalKeys}'s, the SAME
     * subtraction the outgoing props bag uses, so a key the canonical bag also
     * declares is not reported as parked: there the author is already getting
     * the canonical answer (objectui#5123). The key SET is
     * {@link NODE_GATE_PREDICATE_KEYS}, derived from the two chain declarations
     * above rather than re-listed here.
     */
    reportRefusedPropsPredicate(
      newSchema.type,
      newSchema.id,
      NODE_GATE_PREDICATE_KEYS,
      propsWithoutCanonicalKeys(newSchema.props, newSchema.properties),
    );

    // Evaluate visibility: visibleWhen / visible / visibleOn / hidden / hiddenOn
    const shouldHide = (() => {
      // `visibleWhen` is the single canonical conditional-visibility predicate
      // across every layer since ADR-0089 (show-when-truthy), and it is the one
      // this shape DECLARES: `PageComponentSchema` is a closed object that
      // declares `visibleWhen` (its old `visibility` spelling is retired, see
      // `WorkingCopyAuthoredKeys`) and REFUSES a
      // node-level `visible` outright, with the prescription "move it up one
      // level to the component node's own `visibleWhen` … inside `properties`
      // it is hoisted onto the node by the renderer but evaluated by nothing"
      // (`component.zod.ts`, COMPONENT_NODE_VISIBILITY_KEYS).
      //
      // It is tested FIRST — ahead of `visible` — since objectui#5454. The
      // hoist block above copies every `properties.*` value onto the node, so a
      // node carrying `properties.visible` arrived here with `schema.visible`
      // set, and the `visible` leg used to short-circuit before the DECLARED
      // node predicate was ever consulted. Measured on `record:alert`,
      // `record:path`, `page:card` and `element:text`: `properties.visible`
      // present and truthy made a co-declared `visibleWhen: false` a no-op, so
      // the one key the spec tells authors to write was the one key that could
      // be silently ignored. A declared node predicate now outranks a hoisted
      // renderer prop; when both resolve to "show", both still have to.
      if (newSchema.visibleWhen !== undefined) {
        return !evaluateVisibilityPredicate(newSchema.visibleWhen, 'visibleWhen');
      }
      // `visible` — objectui's own `BaseSchema` tier (`@object-ui/types`), and
      // the landing spot of a hoisted `properties.visible`. Kept ABOVE
      // `BaseSchema`'s deprecated `visibleOn`: re-ranking it would move
      // verdicts for raw metadata that objectui#5454 did not rule on.
      if (newSchema.visible !== undefined) {
        return !evaluateVisibilityPredicate(newSchema.visible, 'visible');
      }
      // `BaseSchema.visibleOn`, @deprecated ADR-0089 → `visibleWhen`.
      // objectui's own node key; the spec's page component never declared it.
      if (newSchema.visibleOn !== undefined) {
        return !evaluateVisibilityPredicate(newSchema.visibleOn, 'visibleOn');
      }
      // Ask "is a `hidden` gate DECLARED?" — not "is the key present?"
      // (objectui#3955). These two legs are the only ones in this chain whose
      // verdict is NOT negated, so the evaluator's single default for "there is
      // nothing to evaluate" (`true`, meaning *visible/enabled*) arrives here
      // meaning HIDE: `hidden: ''` / `null` (`null !== undefined`) / a
      // whitespace-only string / the `{ dialect, source: '' }` envelope
      // `objectstack build` emits for an empty predicate each made the node
      // VANISH, on the generic path, for a value the metadata never used to say
      // anything. Harder to diagnose than its `disabled` twin below
      // (objectui#3862): a greyed-out control is still on screen, a node that
      // never rendered is indistinguishable from metadata that meant it.
      //
      // `hasDeclaredPredicate` is the repo's one definition of "declared"
      // (core's `evaluator/declaredPredicate.ts`) — a local `&& !== ''` here
      // would have been the Nth dialect of one question. The verdict still reads
      // the RAW value; only the gate in front of it narrowed. Not an
      // equivalence, and pinned as a behaviour change: an UNDECLARED `hidden` no
      // longer short-circuits, so a declared `hiddenOn` is finally consulted.
      if (hasDeclaredPredicate(newSchema.hidden)) {
        return evaluateVisibilityPredicate(newSchema.hidden, 'hidden');
      }
      if (hasDeclaredPredicate(newSchema.hiddenOn)) {
        return evaluateVisibilityPredicate(newSchema.hiddenOn, 'hiddenOn');
      }
      return false;
    })();

    if (shouldHide) {
      newSchema._hidden = true;
    }

    // Evaluate disabled: disabled / disabledOn
    //
    // Ask "is a `disabled` gate DECLARED?" — not "is the key present?"
    // (objectui#3862). `!== undefined` was the widest of the three spellings this
    // question used to have, and this is the key where breadth is not free: the
    // evaluation entry answers an empty predicate with `true`, meaning "no
    // condition → visible/enabled", and on `disabled` that `true` means GREYED
    // OUT. So `disabled: ''`, `disabled: null` (`null !== undefined`), a
    // whitespace-only string and the `{ dialect, source: '' }` envelope
    // `objectstack build` emits for an empty predicate each disabled the node —
    // on the GENERIC path, since this block runs for every schema type, and not
    // as an internal flag either: `_disabled` is forwarded below as a real
    // `disabled` prop.
    //
    // The `visible` / `visibleWhen` / `visibleOn` legs above keep
    // `!== undefined` deliberately: their `true` is NEGATED, so an empty predicate
    // already lands on "shown", which is what "no gate" means anyway, and
    // narrowing them would change ALIAS PRECEDENCE rather than fix anything. The
    // `hidden` / `hiddenOn` legs were the exception — not negated, so they carried
    // this same defect with the polarity that makes the node VANISH — and they now
    // read this same definition (objectui#3955).
    //
    // `hasDeclaredPredicate` is the one definition of "declared" (core's
    // `evaluator/declaredPredicate.ts`, objectui#3850's ruling — read there for
    // the scope), shared with the action renderers' `hasDeclaredVisibilityGate`
    // and `ActionRunner`'s execution gates. A local `&& !== ''` here would have
    // been a fourth dialect of one question, which is what objectui#3842 /
    // objectui#3849 spent two PRs merging away. The verdict still reads the RAW
    // value, exactly as before — only the gate in front of it narrowed. An
    // undeclared `disabled` now falls through to `disabledOn` instead of
    // short-circuiting on an empty predicate.
    //
    // Both legs route through `evaluateEnablementPredicate` (objectui#6445), so
    // a predicate that cannot be evaluated is reported instead of silently
    // greying the control out. The verdicts below are unchanged: that helper
    // returns `evaluateCondition`'s own answer, and an UNDECLARED gate never
    // reaches it at all — `hasDeclaredPredicate` still decides that, one line
    // earlier, which is what keeps the objectui#3862 empty-shape rows silent
    // as well as enabled.
    const isDisabled = (() => {
      if (hasDeclaredPredicate(newSchema.disabled)) {
        return evaluateEnablementPredicate(newSchema.disabled, 'disabled');
      }
      if (hasDeclaredPredicate(newSchema.disabledOn)) {
        return evaluateEnablementPredicate(newSchema.disabledOn, 'disabledOn');
      }
      return false;
    })();

    if (isDisabled) {
      newSchema._disabled = true;
    }

    return newSchema;
  }, [schema, dataSource, ambientScope, pageVariables, boundRecord, apiStatus, apiData]);

  /**
   * SDUI scoped styling (ADR-0065): a node's `responsiveStyles` compiles to
   * id-scoped CSS injected as a `<style>` tag, and a scope class is appended to
   * the node's className.
   *
   * ## Why this is a memo, and why it is HERE and not at its use site
   *
   * The scope-class branch rebuilds the schema object (`{ ...evaluatedSchema,
   * className: mergedClassName }`) so renderers that read `schema.className`
   * see the scope class. Unmemoised, that spread allocated a NEW object on
   * every render of this component — even when the `evaluatedSchema` memo
   * directly above it HELD — so every downstream renderer that memoises on
   * `[schema]` (e.g. `ObjectMap`'s `dataConfig` / `mapConfig`, and the whole
   * marker cascade below them) saw a fresh identity and re-ran (objectui#6270).
   * Only nodes taking this branch were affected: a plain node was handed
   * `evaluatedSchema` itself and was already stable.
   *
   * It is hoisted ABOVE the early returns below because it is a HOOK. Its use
   * site sits after `if (!evaluatedSchema) return null`, the `_hidden` return
   * and the unresolved-component returns, so a `useMemo` written there is a
   * CONDITIONAL hook: a node toggling hidden -> visible would call one more
   * hook than the previous render and React would throw "Rendered more hooks
   * than during the previous render". Hoisting is what makes the memo legal,
   * not a stylistic preference.
   *
   * `[evaluatedSchema, autoStyleId]` is the complete dependency set: every
   * value below is a pure function of the evaluated node (`className`, `id`,
   * `responsiveStyles`) and the `useId` fallback. `evaluatedSchema` is itself a
   * fresh object whenever anything it interpolates changes, so a genuinely
   * changed className, value or breakpoint still produces a NEW identity here —
   * memoising cannot make a live value go stale.
   *
   * Non-object / primitive nodes fall through untouched: the render pass below
   * returns them as text before any of this is read.
   */
  const scopedStyling = useMemo(() => {
    const node = evaluatedSchema;
    if (!node || typeof node !== 'object') {
      return { scopeClass: '', scopedCss: '', mergedClassName: undefined, schemaForComponent: node };
    }
    // `unknown` on the working copy (objectui#11349); `hasResponsiveStyles`
    // narrows it to the spec's `ResponsiveStyles` before anything compiles it.
    const responsiveStyles = node.responsiveStyles;
    if (!hasResponsiveStyles(responsiveStyles)) {
      // No scope class: hand the component `evaluatedSchema` ITSELF, which the
      // memo above already keeps stable. Never a copy — a copy here would
      // reintroduce the same instability for every node in the tree.
      return {
        scopeClass: '',
        scopedCss: '',
        mergedClassName: node.className,
        schemaForComponent: node,
      };
    }
    const scopeClass = scopeClassFor(node.id ?? autoStyleId);
    const mergedClassName = [node.className, scopeClass].filter(Boolean).join(' ');
    return {
      scopeClass,
      scopedCss: compileScopedStyles(`.${scopeClass}`, responsiveStyles),
      mergedClassName,
      // Some renderers read `schema.className` directly (e.g. element:text)
      // while others read the `className` prop (e.g. flex/container). Set both
      // so the scope class lands regardless of which channel a renderer honours.
      schemaForComponent: { ...node, className: mergedClassName },
    };
  }, [evaluatedSchema, autoStyleId]);

  if (!evaluatedSchema) return null;
  // If schema is just a string, render it as text
  if (typeof evaluatedSchema === 'string') return <>{evaluatedSchema}</>;
  // Any other primitive that reached here renders as its text too
  // (objectui#4548). The declared props type does not admit `number` /
  // `boolean`, so this is unreachable from typed code and exists for untyped
  // callers and stored metadata; it replaces the empty-spread "Unknown
  // component type: undefined" box, which said nothing true about the input.
  if (typeof evaluatedSchema !== 'object') return <>{String(evaluatedSchema)}</>;
  // The API binding's non-final states (objectui#12197), drawn in place of the
  // node — before its visibility, which may read `data` and so cannot be
  // decided yet. A refused binding names the spec's refusal; nothing was read.
  // The error panel titles itself in the page's language: its translation
  // hook mounts with it, never in this body, which runs for every node.
  if (apiStatus === 'loading') {
    return <ElementDataSourceLoadingPanel testId={String(evaluatedSchema.type)} />;
  }
  if (apiStatus === 'refused' || apiStatus === 'error') {
    return (
      <ElementApiDataSourcePanel
        testId={String(evaluatedSchema.type)}
        state={apiStatus}
        message={apiBinding.error}
      />
    );
  }
  // Handle visibility: if evaluated schema is hidden, render nothing.
  //
  // Reads AFTER the primitive narrowing above (objectui#4548) so the property
  // access is on a known object. Behaviour is unchanged: `_hidden` is only ever
  // set on the object copy built in the memo, so for a string or any other
  // primitive this test was always falsy and fell through to exactly the
  // branches that now precede it.
  if (evaluatedSchema._hidden) return null;

  // Dev-mode validation: log once per schema object, attach visual flag
  // when invalid. Production path returns { valid: true, messages: [] }
  // without doing any work.
  const _validation = __DEV__ ? validateSchemaOnce(schema) : { valid: true, messages: [] };

  debugLog('schema', 'Rendering schema node', { type: evaluatedSchema.type, id: evaluatedSchema.id });
  
  const Component = ComponentRegistry.get(evaluatedSchema.type);

  if (!Component) {
    // If a lazy loader is registered for this type, kick it off — the
    // registry will notify us via subscribe() once the plugin module's
    // top-level register() side-effects have run.
    if (!lazyError && ComponentRegistry.hasLazy(evaluatedSchema.type)) {
      const pending = ComponentRegistry.loadLazy(evaluatedSchema.type);
      if (pending) {
        pending.catch((err: unknown) => {
          setLazyError(err instanceof Error ? err : new Error(String(err)));
        });
        return (
          <div
            className="p-2 text-sm text-muted-foreground animate-pulse"
            role="status"
            aria-live="polite"
            data-lazy-loading={evaluatedSchema.type}
          >
            Loading <code>{evaluatedSchema.type}</code>…
          </div>
        );
      }
    }

    debugLog('schema', 'Component not found in registry', { type: evaluatedSchema.type });
    const errorInfo = ERROR_CODES['OBJUI-001'];
    // objectui#5247 — the lookup above still missed and this node still fails.
    // The suggestion only names the spelling that would have resolved.
    const caseSuggestion = suggestTypeByCase(evaluatedSchema.type);
    return (
      <div className="p-4 border border-red-500 rounded text-red-500 bg-red-50 my-2" role="alert">
        <p className="font-medium">
          Unknown component type: <strong>{evaluatedSchema.type}</strong>
          {caseSuggestion !== undefined ? (
            <>
              {" — did you mean '"}
              <strong>{caseSuggestion}</strong>
              {"'?"}
            </>
          ) : null}
        </p>
        {lazyError && (
          <p className="text-xs mt-1">Failed to load plugin: {lazyError.message}</p>
        )}
        {(globalThis as any).process?.env?.NODE_ENV !== 'production' && (
          <p className="text-xs mt-1">💡 {errorInfo.suggestion} (OBJUI-001)</p>
        )}
        <pre className="text-xs mt-2 overflow-auto">{JSON.stringify(evaluatedSchema, null, 2)}</pre>
      </div>
    );
  }

  // Note: We don't forward the ref to the Component because components in the registry
  // may not support refs. The SchemaRenderer itself can still receive refs for its own use.
  
  // Extract schema metadata properties that should NOT be passed as React props
  const {
    type: _type,
    children: _children,
    body: _body,
    schema: _schema,
    visible: _visible,
    visibleWhen: _visibleWhen,
    visibleOn: _visibleOn,
    hidden: _hidden,
    hiddenOn: _hiddenOn,
    disabled: _disabled,
    disabledOn: _disabledOn,
    // stripped: `PageComponentSchema.dataSource` is the spec's per-element data
    // BINDING (`{ object, view, filter, sort, limit }`) — schema metadata, like
    // `visibleWhen` above, not a visual prop. Renderers that consume it read
    // `schema.dataSource` (element:record_picker, list-view); it must not be
    // spread as a React prop, because several data-bound blocks take the
    // injected data-source ADAPTER under that very name. Spreading it shadowed
    // the adapter with a plain `{ object, view }` object, so the first
    // `dataSource.find(…)` threw `dataSource.find is not a function` and the
    // block reported "Couldn't load records" — writing the binding the spec
    // documents BROKE the component (objectstack#5576). An explicit React
    // `dataSource` prop is unaffected: it arrives via `...props`, spread last.
    dataSource: _dataSource,
    // stripped: `BaseSchema.testId` is the author's stable-locator handle, and
    // this renderer is what makes its declaration true — it is re-emitted as
    // `data-testid` beside `data-obj-id` below (objectui#8268, ADR-0054 C4).
    // Leaving it in the spread was the defect: React does not recognise a
    // `testId` DOM prop, so it landed as a non-standard lowercase `testid`
    // attribute that no test-library query helper looks for, while React's own
    // dev warning told the author to spell it `testid` — steering them further
    // from the documented `data-testid`.
    testId: _testId,
    // stripped: a RUNTIME prop a host injects, never authorable metadata —
    // decision batch #70 (objectui#7742); objectui#8818 closes the key here.
    // The `props` alias carrier is closed by `withoutAuthoredObjectFields`.
    objectFields: _objectFields,
    _hidden: __hidden,    // stripped: internal visibility flag
    _disabled: __disabled, // stripped: internal disabled flag
    responsiveStyles: _responsiveStyles, // stripped: compiled to scoped CSS, not a DOM prop
    ...componentProps
  } = evaluatedSchema;

  // Dev-build loud diagnostic (objectui#4795, Direction 3): an unevaluated
  // `${…}` about to be placed verbatim in front of a user.
  //
  // Sited HERE, after the metadata destructure, on purpose. `componentProps` is
  // the set of values the node OFFERS the component — spread as React props
  // below, and the same values renderers read as `schema.<key>`. Everything the
  // destructure stripped is schema METADATA:
  // `visible` / `visibleWhen` / `hidden` / `disabled` / … hold raw predicate
  // SOURCE by design (they are evaluated as conditions, never placed), so
  // scanning before the strip would report every correctly-authored predicate
  // in the repo. The strip list is therefore the diagnostic's exclusion list,
  // for free and without a second copy of it to drift.
  //
  // ⚠️ It scans `componentProps` and the raw `props` / `properties` bags, NOT
  // the narrowed bags the objectui#9571 / objectui#9758 strips build below.
  // Deliberate, and the objectui#8268 `testId` precedent applied a second time:
  // `data` loses its PROPS seat on the object arm, but it is still authored,
  // still evaluated, and still read off the schema by the block — so an
  // unevaluated expression inside it is still in front of a user, and excluding
  // it here would narrow objectui#4795's coverage by one key for exactly the
  // blocks the ruling touches. That holds for BOTH carriers: an authored
  // `props: { data: '${…}' }` is still reported after objectui#9758 refused it
  // a prop seat.
  //
  // Read-only: it reports what evaluation already produced and changes nothing
  // about what is rendered — no DOM attribute either, so no snapshot moves.
  if (__DEV__) {
    // `testId` is stripped above but stays in THIS scan set. The strip list is
    // this diagnostic's exclusion list because every other member holds raw
    // predicate SOURCE by design; `testId` holds a literal, so excluding it
    // would silently narrow objectui#4795's coverage by one key — measured on
    // `93127bd6f`, an authored `testId: '${data.x}'` was reported before this
    // change, and must still be.
    reportUnevaluatedExpressions(
      schema as object,
      evaluatedSchema.type,
      evaluatedSchema.id,
      _testId === undefined ? componentProps : { ...componentProps, testId: _testId },
      evaluatedSchema.properties,
      evaluatedSchema.props
    );
  }

  // The legacy `props` alias, narrowed exactly as objectui#5123 ruled: for a
  // key BOTH bags declare, `properties` wins here as it already wins in
  // `readProps()`, so one key has one answer on both channels.
  //
  // HOISTED out of the `createElement` call below (objectui#6708) so the
  // diagnostic and the spread read the SAME bag. It is the same pure call with
  // the same arguments producing the same object in the same spread position —
  // nothing about what any renderer receives moves — but it removes the one way
  // this diagnostic could go wrong: reporting a set of keys that is not the set
  // actually handed to the component.
  //
  // objectui#9758 narrows it once more, for the same key and on the same arm as
  // the strip below — see {@link withoutAuthoredDataKey}. The arm is read ONCE,
  // here, and handed to both call sites: two independent lookups of the same
  // question is the shape that let the alias keep the seat in the first place.
  const refusesAuthoredDataProp =
    recordSourceDataArmForType(evaluatedSchema.type) === 'view-data';
  // objectui#8818 strips `objectFields` HERE, before the `data` strip below:
  // that strip's diagnostic decides by identity, so it must compare against a
  // bag this strip has already settled.
  const aliasBagAsAuthored = withoutAuthoredObjectFields(
    propsWithoutCanonicalKeys(evaluatedSchema.props, evaluatedSchema.properties)
  );
  const outgoingPropsBag = withoutAuthoredDataKey(aliasBagAsAuthored, refusesAuthoredDataProp);
  if (__DEV__ && outgoingPropsBag !== aliasBagAsAuthored) {
    reportRefusedDataPropSpread(evaluatedSchema.type, evaluatedSchema.id);
  }

  // Dev-build diagnostic (objectui#6708, maintainer ruling 2026-08-29, option
  // 2): those keys are spread as React props and never hoisted onto the node,
  // so a renderer that reads its config from `schema` — every family except
  // `element:*`'s `readProps()` — drops them without a word.
  //
  // Sited HERE, beside its objectui#4795 neighbour and after the metadata
  // destructure, for the same reason: this is the point where what leaves this
  // component for the renderer is finally known. Read-only — it reports what
  // the line above already computed and changes nothing that is rendered.
  //
  // The AUTHORED bag comes from `schema`, not `evaluatedSchema`: the evaluation
  // memo rebuilds `props` with an object spread, which turns a degenerate
  // `props: 'text'` into `{ '0': 't', … }` long before this line. See
  // `collectDroppedPropsKeys`.
  //
  // ⚠️ It reads the POST-strip bag (objectui#9758), and that direction is the
  // opposite of its objectui#4795 neighbour above ON PURPOSE. This message
  // states that the key "is spread as React props on the created element" and
  // tells the author to "write them under `properties` instead" — after the
  // strip BOTH sentences are false for `data` on this arm: it is not spread,
  // and the canonical spelling loses the seat as well. Its subject stops being
  // true, so it stops naming the key, and `reportRefusedDataPropSpread` is what
  // tells the author instead. The objectui#4795 scan reads the WIDER bag for
  // the mirror-image reason: an unevaluated `${…}` is still in front of a user
  // after the strip, so its subject survives.
  if (__DEV__) {
    reportDroppedPropsBag(
      evaluatedSchema.type,
      evaluatedSchema.id,
      (schema as { props?: unknown } | null | undefined)?.props,
      outgoingPropsBag
    );
  }

  /**
   * objectui#9571 (ruling objectui#8348 Q2-C, decision batch #136 item 3,
   * maintainer 「同意」): an authored `data` key does NOT take a React prop seat
   * on a block whose published `data` row is the OBJECT arm (`ViewData`).
   *
   * ## The defect this closes
   *
   * The spread below hands every non-metadata node key to the component, so an
   * authored `data` reached such a block TWICE — as `schema.data`, which the
   * shared ladder judges against the block's row (`resolveRecordSourceConfig`,
   * objectui#8348), and as the `data` PROP, which `ObjectGrid` (`passedData`),
   * `ObjectMap` (`dataProp`) and `ObjectGantt` each lift with an unconditional
   * `Array.isArray` at HIGHER priority than that ladder. The ruling had one
   * carrier it did not reach, and it was the one that wins: a bare array under
   * `data` still drew through this renderer after the ladder had retired it.
   *
   * ## ⛔ The HOST path is NOT touched, and that is the ruled half
   *
   * Option B — gating the PROP on the arm — was refused, because the prop is how
   * a host (`plugin-list`'s `ListView`, `ObjectView`) hands down rows it already
   * fetched. Only the AUTHORED key loses its seat: `...props` below is this
   * component's own React props, spread LAST, so a host rendering
   * `<SchemaRenderer data={rows} …/>` still delivers `rows`, and a host that
   * renders the block component directly never passes through here at all.
   *
   * ## Scope is the ARM, not a block list
   *
   * `recordSourceDataArmForType` answers per registered type, and every type it
   * does not list keeps today's behaviour verbatim. ⛔ No allowlist of block
   * NAMES is minted here — that is the second de-facto contract AGENTS.md #0.1
   * forbids, and the ruling is stated over the arm, not over a census.
   *
   * ## Byte-identical when nothing is authored
   *
   * The `in` test comes FIRST, so a node that authors no `data` is handed
   * `componentProps` itself — the same object, in the same spread position, with
   * no copy allocated. Same discipline as the conditional `data-testid` below,
   * and for the same measured reason.
   *
   * ## ⚠️ TWO bags reach the spread, and this one is only the first
   *
   * objectui#9758: the legacy `props` alias bag is spread AFTER this one, so for
   * the first ruling's whole life an author who spelled the identical key
   * `props: { data: [...] }` kept the seat this block takes away — the arm
   * predicate was right and the corpus was one bag short. Both bags now go
   * through {@link withoutAuthoredDataKey} with the ONE arm reading computed
   * above (decision batch #167 item 2, letter 剥, maintainer 「其他同意」).
   * ⛔ Still no validator refusal: whether the alias exists at all is
   * objectui#4795's pending question ②, and nothing else it carries moves.
   */
  const outgoingComponentProps = withoutAuthoredDataKey(
    componentProps,
    refusesAuthoredDataProp
  );
  if (__DEV__ && outgoingComponentProps !== componentProps) {
    reportRefusedDataPropSpread(evaluatedSchema.type, evaluatedSchema.id);
  }

  // SDUI scoped styling (ADR-0065) — computed in the memo hoisted above the
  // early returns; see the doc comment there for why it cannot live here.
  const { scopeClass, scopedCss, mergedClassName, schemaForComponent } = scopedStyling;

  // Extract AriaPropsSchema properties for accessibility
  const ariaProps = resolveAriaProps(evaluatedSchema);

  // Debug-mode enhancements: extra data attributes + perf tracking
  const isDebug = context?.debug || context?.debugFlags?.enabled;
  const debugAttrs: Record<string, string> = {};
  if (isDebug) {
    debugAttrs['data-debug-type'] = evaluatedSchema.type;
    if (evaluatedSchema.id) {
      debugAttrs['data-debug-id'] = evaluatedSchema.id;
    }
  }

  debugTime(`render:${evaluatedSchema.type}:${evaluatedSchema.id ?? 'anon'}`);
  const renderStart = isDebug ? performance.now() : 0;
  const rendered = (
    <SchemaErrorBoundary
      componentType={evaluatedSchema.type}
      resetKey={evaluatedSchema.id ?? null}
    >
      {scopedCss ? (
        <style data-os-scope={scopeClass} dangerouslySetInnerHTML={{ __html: scopedCss }} />
      ) : null}
      {React.createElement(Component, {
        schema: schemaForComponent,
        // Spread non-metadata schema properties as props — minus an authored
        // `data` on the object arm, which the objectui#9571 strip above removed.
        ...outgoingComponentProps,
        // The legacy `props` alias still overrides plain top-level keys, but no
        // longer overrides the canonical `properties` bag (objectui#5123,
        // maintainer ruling 2026-08-18) — and, since objectui#9758, no longer
        // re-seats an authored `data` on the object arm that the spread above
        // just refused. Computed above rather than inline, so the objectui#6708
        // diagnostic names this exact bag — see there.
        ...outgoingPropsBag,
        ...ariaProps,  // Inject ARIA attributes from AriaPropsSchema
        ...debugAttrs, // Debug-mode data attributes
        disabled: __disabled || undefined,
        className: mergedClassName,
        'data-obj-id': evaluatedSchema.id,
        'data-obj-type': evaluatedSchema.type,
        // objectui#8268 — `BaseSchema.testId`'s declaration promises this
        // attribute. Emitted here, not spread above, so the author gets the
        // `data-testid` every query helper looks for instead of the
        // non-standard `testid` the raw spread produced.
        //
        // ⚠️ CONDITIONALLY, and that is load-bearing, not tidiness. Passing
        // `'data-testid': undefined` unconditionally would put the key in every
        // node's props bag, and a component that sets its own `data-testid` and
        // then spreads what it is handed — the ADR-0054 C4 shape, which many
        // renderers here have — would have its locator overwritten with
        // `undefined` and lose it. Measured: the unconditional form turned 9
        // tests red across 5 files, including the three that assert the props
        // bag is byte-for-byte unchanged (objectui#6708 / #6752 / #6760). A node
        // that authors no `testId` must be byte-identical to before this card.
        ...(_testId === undefined ? {} : { 'data-testid': _testId }),
        ...(__DEV__ && !_validation.valid ? { 'data-obj-schema-invalid': 'true' } : {}),
        ...props
      })}
    </SchemaErrorBoundary>
  );
  debugTimeEnd(`render:${evaluatedSchema.type}:${evaluatedSchema.id ?? 'anon'}`);
  // The bound value reaches the subtree as `data` (see "The API binding").
  const output = apiStatus === 'ready'
    ? <PredicateScopeProvider scope={subtreeScope}>{rendered}</PredicateScopeProvider>
    : rendered;

  // Report render perf to DebugCollector when debug mode is active
  if (isDebug && renderStart) {
    const durationMs = performance.now() - renderStart;
    DebugCollector.getInstance().addPerf({
      type: evaluatedSchema.type,
      id: evaluatedSchema.id,
      durationMs,
      timestamp: Date.now(),
    });
  }

  return output;
});
SchemaRenderer.displayName = 'SchemaRenderer';
