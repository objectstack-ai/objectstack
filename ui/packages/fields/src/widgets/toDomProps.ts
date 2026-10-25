/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {
  pickDomProps,
  type SduiDomPassThroughKey,
  type DomProps as CoreDomProps,
} from '@object-ui/core';
import type { FieldWidgetComponentProps, FieldWidgetDomProps } from './types.js';

/**
 * The RUNTIME EXECUTOR of the "DOM pass-through" section of
 * {@link FieldWidgetComponentProps} (objectui#3291).
 *
 * ## The defect
 *
 * Field widgets forwarded their leftover props to a control with a bare
 * spread — `const { inputType, ...domProps } = props as any; <Input
 * {...domProps} />`. Whatever a host handed the widget therefore became a DOM
 * attribute. Measured on `origin/main`, a real form + a real widget:
 *
 * ```
 * <input placeholder="PH-f" zzcanary="CANARY-STR" zzcanaryobj="[object Object]"
 *        zzcanarynum="42" id="…" type="text" value="" name="f">
 * ```
 *
 * The `[object Object]` this issue is named for is an authored field-config
 * key being `String()`-ed onto an attribute. React 19 does not warn: an
 * all-lowercase unknown attribute is passed through in complete silence, which
 * is why this survived so long.
 *
 * ## Why a whitelist, and not a list of keys to drop
 *
 * The biggest leak source is not any NAMED renderer prop — it is the open tail
 * of author-supplied keys. The form renderer destructures a fixed set of known
 * keys and forwards `...fieldProps` verbatim
 * (`components/src/renderers/form/form.tsx`), and `SchemaRenderer` is wider
 * still: it spreads the whole authored node as props and has no strip layer at
 * all, so on the SDUI path a widget's own spread is the ONLY line of defence.
 *
 * A blacklist enumerating today's renderer-only keys (`error`, `emptyHint`,
 * `dataSource`, `dependentValues`, `dependsOn`, `options`, `inputType`, …)
 * would pass every one of the canaries above and would not stop the next
 * authored key either. Only "keep the known-safe set, drop the rest" closes
 * it, which is what this function does.
 *
 * ## Declared = enforced
 *
 * {@link FieldWidgetComponentProps} already DECLARES the closed set of keys a
 * widget may receive, and {@link FieldWidgetDomProps} names the subset that may
 * legitimately reach a DOM element (objectui#3221). Until now that was a
 * type-level claim a widget could violate at runtime simply by spreading. This
 * function is that declaration's executable form, and TWO compile-time
 * assertions below bind them in both directions — forwarding an undeclared key
 * and declaring an unforwarded DOM key are each a compile error. Neither
 * direction can drift silently.
 *
 * ## Deliberately NOT forwarded
 *
 * `role` and other HTML global attributes are absent because the contract does
 * not declare them. They reached the DOM before this change only through the
 * open spread. If a field node should be able to author one, DECLARE it on
 * `FieldWidgetComponentProps` first and add it here — do not reopen the spread
 * (AGENTS.md #0.1: fix the contract, never widen the consumer).
 *
 * ## Where the mechanism lives now, and why the key list stayed here
 *
 * objectui#4425 phase 2 promoted this whitelist to the SDUI widget contract
 * generally, so the MECHANISM — filter by a declared key list plus the `aria-*`
 * / `data-*` open families — moved to `@object-ui/core`
 * (`utils/dom-props.ts`, `pickDomProps`), where every plugin package can reach
 * it without depending on `@object-ui/fields` (the objectui#4409
 * dependency-direction method: `plugin-chatbot` declares `@object-ui/core` and
 * does not declare this package).
 *
 * The KEY LIST did not move, because it is not the same list. Measured on
 * objectui#4431:
 *
 *  - `name` and `disabled` are here and NOT in the SDUI set: both are legal
 *    only on form controls, which is what every widget in this package renders
 *    and what `FieldWidgetComponentProps` declares. `name` on the `<div>` an
 *    SDUI container widget renders is a leak — one of the 14 attributes #4431
 *    closed — and two widgets here already hand-strip it when they spread onto
 *    something that is not a control (`ObjectRefField`'s trigger,
 *    `FileField`'s dropzone).
 *  - `role` is in the SDUI set and NOT here: `SchemaRenderer` resolves it for
 *    every node from `@objectstack/spec`'s `AriaPropsSchema`, while this
 *    contract deliberately does not declare it (see "Deliberately NOT
 *    forwarded" above).
 *
 * So: one mechanism, two declarations, each bound by the assertions below to
 * the contract it executes. Not two judges.
 */
const DOM_PASS_THROUGH_KEYS = [
  /* ── The contract's own "DOM pass-through" block, verbatim ─────────────── */
  'id',
  'name',
  'autoFocus',
  'tabIndex',
  'onBlur',
  'onFocus',
  'onClick',

  /* ── Two more declared keys that ARE valid DOM attributes ──────────────── */
  //
  // Both are declared on `FieldWidgetComponentProps` under the
  // controlled-input contract rather than the DOM block, because widgets also
  // INTERPRET them (`className` gets composed with the widget's own classes;
  // `disabled` is OR-ed with `readonly`). They are still `class` and
  // `disabled` on the element, and every widget here already forwards them.
  //
  // Withholding them would make this helper a silent styling- and
  // interactivity-dropper: `<Input {...toDomProps(props)} />` — the shape this
  // change teaches every future widget author to write — would quietly lose
  // the host's className and disabled state. That is a NEW silent failure of
  // exactly the kind the whitelist exists to prevent, so they are forwarded.
  'className',
  'disabled',
] as const;

/**
 * The keys this helper forwards.
 *
 * Exported so the SIBLING executor — `toHostProps`, which carries the declared
 * NON-DOM keys (`f08bcd9af`) — can subtract this set from the contract and
 * assert that the two together cover every declared key exactly once. Without
 * that subtraction there is no way to state "these keys are handled elsewhere"
 * as a compile-time fact rather than as a comment.
 */
export type DomPassThroughKey = (typeof DOM_PASS_THROUGH_KEYS)[number];

/**
 * Compile-time link to the declaration, direction 1 of 2: every key forwarded
 * at runtime must exist on {@link FieldWidgetComponentProps}. Deleting a key
 * from the contract without deleting it here is a compile error.
 *
 * Catches: helper forwards something the contract no longer declares.
 */
type EveryForwardedKeyIsDeclared =
  DomPassThroughKey extends keyof FieldWidgetComponentProps ? true : never;
const _everyForwardedKeyIsDeclared: EveryForwardedKeyIsDeclared = true;
void _everyForwardedKeyIsDeclared;

/**
 * Direction 2 of 2: every key of {@link FieldWidgetDomProps} — the contract's
 * DOM pass-through block — must be one this helper actually forwards. Adding a
 * DOM key to the contract without adding it to `DOM_PASS_THROUGH_KEYS` is a
 * compile error.
 *
 * Catches: DECLARED BUT NOT DELIVERED — a key that type-checks, reads as
 * supported, and silently never reaches the element. That is the failure this
 * repo treats as first-class (objectui#3290's `aria-required` that never
 * reached a control; objectui#3222's validation slot nobody produced), and it
 * is the one direction the leak test structurally CANNOT see: that test looks
 * for attributes that arrive, not for ones that go missing.
 *
 * `className` / `disabled` are not part of `FieldWidgetDomProps` (they are
 * controlled-input keys this helper also forwards — see above), so they are
 * bound by direction 1 only. That is deliberate, not an oversight.
 */
type EveryDeclaredDomKeyIsForwarded =
  keyof FieldWidgetDomProps extends DomPassThroughKey ? true : never;
const _everyDeclaredDomKeyIsForwarded: EveryDeclaredDomKeyIsForwarded = true;
void _everyDeclaredDomKeyIsForwarded;

/**
 * Direction 3, added with the core lift (objectui#4431): every key of the SDUI
 * contract's own whitelist that this contract also declares must be forwarded
 * here too, so the two lists cannot silently drift apart. `role` is the ONE
 * measured exception — the SDUI contract declares it, this one does not — and
 * naming it in the `Exclude` is what makes the divergence a deliberate,
 * reviewable act rather than an omission.
 *
 * Catches: a key added to the shared SDUI set that field widgets quietly stop
 * delivering.
 */
type SharedSduiKey = Exclude<SduiDomPassThroughKey, 'role'>;
type EverySharedSduiKeyIsForwarded = SharedSduiKey extends DomPassThroughKey ? true : never;
const _everySharedSduiKeyIsForwarded: EverySharedSduiKeyIsForwarded = true;
void _everySharedSduiKeyIsForwarded;

/**
 * The subset of `P` this helper forwards, with each key's declared type.
 *
 * Not {@link FieldWidgetDomProps}: that is the contract's DOM block, the
 * non-generic set of keys a widget may receive; this is the generic RESULT
 * type of {@link toDomProps}, whatever `P` it is handed narrowed to this
 * helper's key set.
 *
 * Not `DomProps`: `@object-ui/core` publishes that name for the general
 * mechanism, whose default key set forwards `role` where this one forwards
 * `name` and `disabled`. One exported name stood for both key sets until this
 * declaration was renamed, the way `@object-ui/components` names its own
 * specialisation `FormControlDomProps` (objectui#6349, batch 11).
 */
export type FieldDomProps<P> = CoreDomProps<P, DomPassThroughKey>;

/**
 * Keep only what may legitimately become a DOM attribute, and drop everything
 * else — renderer plumbing, and any extra key an author put on the field
 * config or SDUI node.
 *
 * Replaces the bare `{...props}` spread in every field widget that renders a
 * host element:
 *
 * ```tsx
 * // before — forwards whatever it was handed
 * const { inputType, ...domProps } = props as any;
 * return <Input {...domProps} … />;
 *
 * // after
 * return <Input {...toDomProps(props)} … />;
 * ```
 *
 * Semantic props a widget INTERPRETS (`value`, `onChange`, `field`,
 * `readonly`, `error`, …) are read from `props` as before; this function only
 * governs what gets spread.
 */
export function toDomProps<P extends object>(props: P): FieldDomProps<P> {
  return pickDomProps(props, DOM_PASS_THROUGH_KEYS);
}
