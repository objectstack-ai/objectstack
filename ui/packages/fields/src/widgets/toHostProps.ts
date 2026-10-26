/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { AriaAttributes } from 'react';
import type { DomPassThroughKey } from './toDomProps.js';
import type { FieldWidgetComponentProps } from './types.js';

/**
 * The RUNTIME EXECUTOR of the NON-DOM half of {@link FieldWidgetComponentProps}
 * (`f08bcd9af`) — the sibling of `toDomProps`, and deliberately a SEPARATE
 * function rather than more entries in that whitelist.
 *
 * ## The defect
 *
 * objectui#6909 / #7009 closed the DOM half at `FieldEditWidget`: the factory
 * hands the widget `toDomProps(props)`, so `id` / `name` / `tabIndex` /
 * `aria-*` / `data-*` and friends finally arrive. The contract also declares a
 * "Host plumbing" block plus two controlled-input keys the factory neither owns
 * nor routes to the DOM, and NOTHING carried those. A host could pass any of
 * them with no type error and the widget never received it — this package's own
 * first-class defect class, named in `toDomProps.ts`: "a key that type-checks,
 * reads as supported, and silently never reaches the element" (objectui#3290's
 * `aria-required`, objectui#3222's validation slot).
 *
 * Measured on `main` at `71d83a6b1`, the live victim was `error`:
 * `InlineFieldInput` (`@object-ui/plugin-detail`, since PR #7109) already
 * passes `error={error}` to `FieldEditWidget`, and the factory dropped it on
 * the floor — so a control that had failed validation never reported
 * `aria-invalid` and a screen-reader user was never told. The kanban
 * `RequiredFieldsDialog` had the same hole from the other side: it computes the
 * validation state, renders it in red text, and had no way to hand it over.
 *
 * ## Why NOT more keys in `DOM_PASS_THROUGH_KEYS`
 *
 * Because none of them is DOM-legal. That whitelist is deliberately closed and
 * exists precisely to stop renderer plumbing reaching an element — its own
 * header names `error`, `emptyHint`, `dataSource`, `dependentValues` and
 * `dependsOn` as examples of what a blacklist would have failed to catch. Put
 * them there and a `dataSource` adapter becomes `dataSource="[object Object]"`
 * on an `<input>`. They travel as COMPONENT props, which is what they are.
 *
 * ## Declared = enforced, in both directions
 *
 * The three assertions below make the two executors PARTITION the contract:
 * every declared key is DOM-handled, forwarded here, or named as one the
 * factory itself owns. A key added to `FieldWidgetComponentProps` that is none
 * of those is a compile error, so the next non-DOM key cannot repeat this bug.
 *
 * ## Precedence: this is a CONDUIT, and never a second authority
 *
 * Several of these keys have a context-based fallback inside the widget that
 * reads them, so DELIVERING one can change behaviour where before it could not
 * arrive at all. The rule is stated once, here, and this function implements it
 * by doing nothing: it forwards what the host passed and resolves NOTHING.
 * Each key's precedence stays where its single reader already implements and
 * documents it —
 *
 *  - `dataSource`: **the explicit prop WINS** over `SchemaRendererContext`.
 *    `LookupField` already resolves exactly that order and says so on the line
 *    that does it: "explicit prop > field-level > wrapper field >
 *    SchemaRendererContext > none". Hosts that pass nothing keep reading the
 *    context, so the grid's inline editor is unaffected.
 *  - `dependentValues`: the explicit prop is the ONLY channel that can carry a
 *    record — the host supplies it, and there is NO context fallback. Both
 *    readers (`useCascadingOptions`, and `LookupField`'s own resolver) used to
 *    spell a `?? ctx.formValues ?? ctx.data` tail after it, but
 *    `SchemaRendererContextType` declares exactly `dataSource` / `debug` /
 *    `debugFlags` / `apiFetch` — neither member exists, so that tail was
 *    unconditionally `{}` and no host could change it. It was retired under
 *    ADR-0049 enforce-or-remove (objectui#7206). Unlike `dataSource` above,
 *    DELIVERING this key cannot displace a context value, because there has
 *    never been one to displace.
 *  - `dependsOn`: the FIELD METADATA wins over the prop — the one documented
 *    inversion, stated on the key's own doc comment and implemented as
 *    `field?.dependsOn ?? dependsOnProp` in all four option widgets.
 *  - `emptyHint`: the host's value wins when supplied (objectui#3231).
 *  - `onCreateNew`: the prop wins over `field.onCreateNew`; `onSelectRecord`
 *    has no metadata carrier at all, so the prop is its ONLY one.
 *
 * Resolving any of that HERE would give each key a second author — the
 * `field || schema` shape objectui#3233 spent a release removing. One key, one
 * resolver, in the widget that reads it.
 */
const HOST_PLUMBING_KEYS = [
  /* ── Declared on the controlled-input block, but neither DOM-legal nor
     owned by the factory ─────────────────────────────────────────────────── */
  //
  // `error` is the published validation slot (`@objectstack/spec/ui`'s
  // `FieldWidgetPropsSchema`). Its single documented consumer contract is
  // "drive `aria-invalid` on the control"; the message TEXT stays with the
  // host, so forwarding this cannot double-display anything.
  'error',
  // `onUploadingChange` is forwarded for completeness of the declaration, not
  // for a reachable consumer: its only readers are `FileField` / `ImageField`,
  // and `file` / `image` are both in `INLINE_EXCLUDED_FIELD_TYPES`, so no
  // widget reachable through `FieldEditWidget` reads it today. Delivering a
  // declared key that happens to have no reader is the correct half of
  // enforce-or-remove; withholding it would leave the contract lying.
  'onUploadingChange',

  /* ── The contract's own "Host plumbing" block, verbatim ────────────────── */
  //
  // `compact` is the ONE member of that block deliberately absent here: the
  // factory OWNS it, deriving it from the resolved field type
  // (`COMPACT_EDIT_TYPES`) so a cell-sized relational picker renders as a
  // single-line trigger. Forwarding it would give the sizing two authors, and
  // the exclusion is named in the `FactoryOwnedKey` list below so the compiler
  // treats it as a decision rather than an omission.
  'dataSource',
  'dependentValues',
  'dependsOn',
  'dependsOnLabels',
  'emptyHint',
  'onSelectRecord',
  'onCreateNew',
] as const;

type HostPlumbingKey = (typeof HOST_PLUMBING_KEYS)[number];

/**
 * The keys `FieldEditWidget` computes or renders ITSELF, and therefore neither
 * executor forwards.
 *
 * `field` / `value` / `onChange` / `readonly` are the controlled-input contract
 * the factory writes out explicitly; `compact` is derived from the resolved
 * field type (see the note in the list above). Naming them here is what lets
 * the partition assertion below be exact rather than a subset check.
 */
type FactoryOwnedKey = 'field' | 'value' | 'onChange' | 'readonly' | 'compact';

/**
 * Every declared key that is NOT handled by the DOM executor, NOT one of the
 * open attribute families, and NOT owned by the factory.
 *
 * Derived from the contract rather than typed out, so it tracks
 * {@link FieldWidgetComponentProps} automatically.
 */
type NonDomDeclaredKey = Exclude<
  keyof FieldWidgetComponentProps,
  DomPassThroughKey | keyof AriaAttributes | `data-${string}` | FactoryOwnedKey
>;

/**
 * Direction 1 of 3: every key forwarded at runtime is declared on the contract.
 *
 * Catches: this helper forwards something the contract no longer declares.
 */
type EveryForwardedKeyIsDeclared =
  HostPlumbingKey extends keyof FieldWidgetComponentProps ? true : never;
const _everyForwardedKeyIsDeclared: EveryForwardedKeyIsDeclared = true;
void _everyForwardedKeyIsDeclared;

/**
 * Direction 2 of 3: every declared non-DOM, non-factory-owned key is forwarded
 * here. Adding a key to `FieldWidgetComponentProps` without adding it to
 * {@link HOST_PLUMBING_KEYS} — or to {@link FactoryOwnedKey} — is a compile
 * error.
 *
 * Catches: DECLARED BUT NOT DELIVERED, the failure this whole file exists to
 * close. It is the direction no runtime test can see, because a test looks for
 * props that ARRIVE, not for ones that go missing.
 */
type EveryDeclaredHostKeyIsForwarded =
  NonDomDeclaredKey extends HostPlumbingKey ? true : never;
const _everyDeclaredHostKeyIsForwarded: EveryDeclaredHostKeyIsForwarded = true;
void _everyDeclaredHostKeyIsForwarded;

/**
 * Direction 3 of 3: the two executors are DISJOINT — nothing forwarded here is
 * also a DOM pass-through key.
 *
 * Catches the specific mistake the ruling on the card behind `f08bcd9af` fences off: "route the
 * host-plumbing keys through `toDomProps`". Add `error` or `dataSource` to
 * `DOM_PASS_THROUGH_KEYS` and that file's own two assertions stay green (the
 * keys ARE declared) — this one is what goes red, because the key would leave
 * `NonDomDeclaredKey` while still being listed above. It is also what keeps the
 * order of the two spreads at the call site a non-question.
 */
type EveryForwardedKeyIsNonDom = HostPlumbingKey extends NonDomDeclaredKey ? true : never;
const _everyForwardedKeyIsNonDom: EveryForwardedKeyIsNonDom = true;
void _everyForwardedKeyIsNonDom;

/** The subset of `P` this helper forwards, with each key's declared type. */
export type HostProps<P> = Pick<P, Extract<keyof P, HostPlumbingKey>>;

/**
 * Keep only the declared NON-DOM keys — the host plumbing a widget interprets
 * as component props — and drop everything else.
 *
 * The companion to `toDomProps`, and used the same way. A host that passes
 * nothing gets an empty object, so the widget's prop set is unchanged:
 *
 * ```tsx
 * <Widget {...toDomProps(props)} {...toHostProps(props)} field={field} … />
 * ```
 *
 * Iterating the props (rather than the key list) mirrors `pickDomProps`, so a
 * key the host did not mention stays ABSENT rather than arriving as
 * `undefined` — which keeps the factory-boundary prop set readable as "what the
 * host actually supplied".
 */
export function toHostProps<P extends object>(props: P): HostProps<P> {
  const allowed: ReadonlySet<string> = new Set<string>(HOST_PLUMBING_KEYS);
  const hostProps: Record<string, unknown> = {};
  for (const key of Object.keys(props)) {
    if (allowed.has(key)) {
      hostProps[key] = (props as Record<string, unknown>)[key];
    }
  }
  return hostProps as HostProps<P>;
}
