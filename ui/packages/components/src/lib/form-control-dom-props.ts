/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {
  pickDomProps,
  SDUI_DOM_PASS_THROUGH_KEYS,
  type SduiDomPassThroughKey,
  type DomProps as CoreDomProps,
} from '@object-ui/core';

/**
 * The DOM pass-through declaration for the `packages/components` renderers whose
 * host element is a FORM CONTROL (objectui#5632).
 *
 * ## Why this exists at all, rather than a bare `toDomProps`
 *
 * `toDomProps` is the SDUI contract's executor and its key list is deliberately
 * ELEMENT-AGNOSTIC — it cannot know what element the widget renders, so it
 * carries only what is legal on every element. `name` and `disabled` are legal
 * on form controls and nowhere else, which is exactly why `dom-props.ts` leaves
 * them out: `name` on the `<div>` a container widget renders is one of the 14
 * attributes objectui#4431 closed.
 *
 * The renderers in this group render the other case. Routing them through the
 * bare SDUI list would strip `name` and `disabled` off real controls — and
 * `packages/fields` already wrote down what that costs, in the same words, for
 * the same two keys:
 *
 * > Withholding them would make this helper a silent styling- and
 * > interactivity-dropper … That is a NEW silent failure of exactly the kind
 * > the whitelist exists to prevent, so they are forwarded.
 *
 * It is worth being precise about how INVISIBLE that failure would be here.
 * The gate that grades this change
 * (`packages/app-shell/src/__tests__/widget-dom-leak-sweep.test.tsx`) reports
 * attributes that ARRIVE illegitimately; it has no case for an attribute that
 * stops arriving, and its canary node authors no `disabled` at all. So dropping
 * `disabled` off every form control in the library would have moved not one
 * number in this card's own acceptance evidence. The ledger predicted the same
 * thing from the other side — its `BARE_SPREAD_MINUS_NAME` note says converging
 * this group "will not change that attribute, only the thirteen around it" —
 * and that prediction is only true if `name` is forwarded deliberately.
 *
 * ## One mechanism, three declarations
 *
 * This is the third declaration over the ONE mechanism in
 * `@object-ui/core`'s `pickDomProps`, and it follows the pattern
 * `@object-ui/fields` established rather than inventing one: the consuming
 * package owns the key list its own contract implies, and calls the shared
 * filter with it. The three, and what separates them:
 *
 *  - `toDomProps` (`@object-ui/core`) — the SDUI baseline, element-agnostic.
 *  - `@object-ui/fields`' `toDomProps` — the baseline minus `role`, plus `name`
 *    and `disabled`; `FieldWidgetComponentProps` declares the closed set.
 *  - this one — the baseline PLUS `name` and `disabled`, nothing removed. It is
 *    a strict superset of the SDUI list, which the compile-time assertion below
 *    pins, so a key added to the shared set can never be quietly dropped here.
 *
 * Anything beyond this set is still the objectui#4435 route: DECLARE it and
 * forward it by name. Do not reopen the spread (AGENTS.md #0.1 — fix the
 * contract, never widen the consumer). `style` is the standing example, and it
 * is forwarded by name at every call site for exactly that reason.
 */
const FORM_CONTROL_DOM_PASS_THROUGH_KEYS = [
  ...SDUI_DOM_PASS_THROUGH_KEYS,

  /* ── The two keys a form control adds, and nothing else ─────────────────── */
  //
  // `name` — the control's form-serialization key. On these hosts HTML defines
  // it, which is the whole reason the sweep gate's `BARE_SPREAD_MINUS_NAME`
  // group is thirteen attributes and not fourteen: the judge never reported
  // `name` here, so it was never part of what this card removes.
  //
  // `disabled` — read by several of these renderers as a SEMANTIC prop and
  // recomputed (`action:button` ORs it with its declared-gate verdict,
  // `ui:button` ORs it with `loading`); forwarding it keeps the authored value
  // reaching controls that do not recompute it, which is today's behaviour.
  'name',
  'disabled',
] as const;

type FormControlDomPassThroughKey = (typeof FORM_CONTROL_DOM_PASS_THROUGH_KEYS)[number];

/**
 * Compile-time link to the shared SDUI contract: every key the baseline
 * forwards must be forwarded here too. A form control is a DOM element first —
 * there is no key that is safe on a `<div>` and unsafe on an `<input>` — so any
 * future addition to `SDUI_DOM_PASS_THROUGH_KEYS` that this list did not pick up
 * is a drift, not a decision.
 *
 * Catches: DECLARED BUT NOT DELIVERED — the failure direction the leak gate
 * structurally cannot see, because it looks for attributes that arrive, never
 * for ones that go missing.
 */
type EverySduiKeyIsForwarded =
  SduiDomPassThroughKey extends FormControlDomPassThroughKey ? true : never;
const _everySduiKeyIsForwarded: EverySduiKeyIsForwarded = true;
void _everySduiKeyIsForwarded;

/** The subset of `P` this declaration forwards, with each key's declared type. */
export type FormControlDomProps<P> = CoreDomProps<P, FormControlDomPassThroughKey>;

/**
 * Keep only what may legitimately become an attribute on a FORM CONTROL, and
 * drop everything else — the injected `schema`, the data-source adapter, the
 * authored node's SDUI metadata, the flattened `props` container, and every
 * declared prop the renderer already consumed off `schema`.
 *
 * Replaces the bare `{...rest}` spread in a form-control registration:
 *
 * ```tsx
 * // before — forwards whatever `SchemaRenderer` handed it
 * const { style, ...rest } = props;
 * return <Input name={schema.name} {...rest} />;
 *
 * // after
 * return <Input name={schema.name} {...toFormControlDomProps(rest)} style={style} />;
 * ```
 */
export function toFormControlDomProps<P extends object>(props: P): FormControlDomProps<P> {
  return pickDomProps(props, FORM_CONTROL_DOM_PASS_THROUGH_KEYS);
}
