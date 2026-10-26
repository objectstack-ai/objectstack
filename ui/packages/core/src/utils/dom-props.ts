/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The RUNTIME EXECUTOR of the SDUI widget prop contract's DOM pass-through
 * (objectui#4425 phase 2, promoting objectui#3291's whitelist from
 * `packages/fields` to every registered SDUI widget).
 *
 * ## The defect this closes
 *
 * `SchemaRenderer` hands a registered component the authored node's own keys,
 * the contents of its `props` container, the ARIA it resolved, and the host's
 * trailing props — then a widget ending in a bare `{...props}` spread puts all
 * of it on a DOM element. React passes unknown lowercase attributes through in
 * complete silence and stringifies object values, so the failure is invisible:
 *
 * ```
 * <div id="canary-node" name="canary_node" bind="data.revenue"
 *      events="[object Object]" arialabel="Canary label"
 *      datasource="[object Object]" props="[object Object]" …>
 * ```
 *
 * That is one real measurement, from `plugin-chatbot:chatbot` on the sweep gate
 * (`packages/app-shell/src/__tests__/widget-dom-leak-sweep.test.tsx`).
 *
 * ## Why a whitelist, and not a list of keys to drop
 *
 * Measured, not assumed. objectui#4357/PR #4428 answered the same defect in
 * `plugin-dashboard` with a deny-list: it closed every one of the seven keys it
 * enumerated, and the sweep still found the OPEN TAIL leaking on the same two
 * components — `zzcanary`, `reference_to`, an authored `props: { colorVariant }`
 * — because a deny-list can only name what already exists. The set of keys an
 * author may put on a node is unbounded; the set a widget may put on an element
 * is declared. A deny-list bounded by enumeration cannot be finished; a
 * whitelist bounded by declaration can.
 *
 * ## The set, and why each key is in it
 *
 * Every key here is either injected by `SchemaRenderer` for the whole SDUI
 * contract, or a GLOBAL HTML attribute legal on whatever element a widget
 * renders — this helper cannot know that element, so nothing element-specific
 * belongs here:
 *
 *  - `id` — global; `SchemaRenderer` carries the node's id.
 *  - `className` — global (`class`); the styling channel AGENTS.md #3 requires
 *    every widget to expose, and the carrier of ADR-0065's scope class.
 *  - `role` — the third member of `@objectstack/spec`'s `AriaPropsSchema`,
 *    resolved and injected by `SchemaRenderer.resolveAriaProps` alongside
 *    `aria-label` / `aria-describedby`. Withholding it would make an authored
 *    `role` type-check, read as supported, and silently never arrive — the
 *    DECLARED-BUT-NOT-DELIVERED failure this repo treats as first class.
 *  - `tabIndex`, `autoFocus` — global HTML attributes.
 *  - `onClick`, `onBlur`, `onFocus` — React synthetic handlers, which never
 *    become attributes at all.
 *
 * Plus the two OPEN families, matched by prefix so no per-attribute list is
 * needed: `aria-*` (the resolved ARIA above — note the camelCase `ariaLabel` /
 * `ariaDescribedBy` the author wrote do NOT match, which is the point: they are
 * meaningless to assistive technology and the resolver already emitted the
 * hyphenated forms) and `data-*` (open in HTML too, and how `data-obj-id` /
 * `data-obj-type` / the debug attributes reach the element).
 *
 * ## Deliberately NOT here
 *
 * `name` and `disabled` are legal only on FORM CONTROLS, not on the container a
 * typical SDUI widget renders — `name` on a `<div>` is exactly one of the 14
 * leaked attributes this closes. `@object-ui/fields` declares both, because
 * every widget there renders a control and its contract
 * (`FieldWidgetComponentProps`) says so; that package keeps its own declared key
 * list and calls {@link pickDomProps} with it. One MECHANISM, two DECLARATIONS,
 * each bound to the contract it executes — not two judges.
 *
 * A semantic prop is CONSUMED, never forwarded: a widget that can be disabled
 * reads `disabled` and applies it (see `plugin-chatbot`'s registrations), which
 * is what keeps `disabledOn` working without putting `disabled="true"` on a
 * `<div>`.
 *
 * Deliberate DOM pass-through beyond this set stays available the objectui#4435
 * way — DECLARE it (`interface Props extends HTMLAttributes<HTMLDivElement>`)
 * and forward it by name. Do not reopen the spread (AGENTS.md #0.1: fix the
 * contract, never widen the consumer).
 */
export const SDUI_DOM_PASS_THROUGH_KEYS = [
  'id',
  'className',
  'role',
  'tabIndex',
  'autoFocus',
  'onClick',
  'onBlur',
  'onFocus',
] as const;

/** A key {@link toDomProps} forwards by name (the open families are prefixes). */
export type SduiDomPassThroughKey = (typeof SDUI_DOM_PASS_THROUGH_KEYS)[number];

/**
 * `aria-*` and `data-*` are open families — open in HTML, and open in the
 * widget contract — so they are matched by prefix rather than enumerated.
 *
 * Note what this does NOT match: `dataSource`. The injected data-source ADAPTER
 * is not a `data-` attribute, and a prefix test that accepted it would put
 * `datasource="[object Object]"` on the element of every data-bound widget —
 * the one leak a schema-only measurement cannot see, because it only appears
 * when a host really supplies an adapter (objectui#4428).
 */
export function isOpenDomAttributeFamily(key: string): boolean {
  return key.startsWith('data-') || key.startsWith('aria-');
}

/** The subset of `P` a whitelist of `K` forwards, with each key's declared type. */
export type DomProps<P, K extends string = SduiDomPassThroughKey> = Pick<
  P,
  Extract<keyof P, K>
> & {
  [Key in Extract<keyof P, `data-${string}` | `aria-${string}`>]: P[Key];
};

/**
 * The MECHANISM: keep the keys a caller's contract declares as DOM-safe plus
 * the two open families, drop everything else.
 *
 * Exported for the one caller whose contract declares a different set —
 * `@object-ui/fields`, whose widgets render form controls and whose
 * `FieldWidgetComponentProps` therefore declares `name` and `disabled` as DOM
 * pass-through (objectui#3291). Everything else should call {@link toDomProps},
 * which is this function with the SDUI contract's own set already applied.
 */
export function pickDomProps<P extends object, K extends string>(
  props: P,
  keys: readonly K[],
): DomProps<P, K> {
  const allowed: ReadonlySet<string> = new Set<string>(keys);
  const domProps: Record<string, unknown> = {};
  for (const key of Object.keys(props)) {
    if (allowed.has(key) || isOpenDomAttributeFamily(key)) {
      domProps[key] = (props as Record<string, unknown>)[key];
    }
  }
  return domProps as DomProps<P, K>;
}

/**
 * Keep only what may legitimately become a DOM attribute on a registered SDUI
 * widget's host element, and drop everything else — the injected `schema`, the
 * data-source adapter, the authored node's metadata, the `props` container, and
 * any extra key an author put on the node.
 *
 * Replaces the bare `{...props}` spread in a widget registration:
 *
 * ```tsx
 * // before — forwards whatever `SchemaRenderer` handed it
 * ({ schema, className, ...props }) => <Chatbot className={className} {...props} />
 *
 * // after
 * ({ schema, className, ...props }) => (
 *   <Chatbot {...toDomProps(props)} className={className} />
 * )
 * ```
 *
 * Semantic props a widget INTERPRETS (`disabled`, and everything it reads off
 * `schema`) are read as before; this function only governs what gets spread.
 */
export function toDomProps<P extends object>(props: P): DomProps<P> {
  return pickDomProps(props, SDUI_DOM_PASS_THROUGH_KEYS);
}
