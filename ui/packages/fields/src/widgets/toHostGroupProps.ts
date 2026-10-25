/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { toDomProps } from './toDomProps.js';

/**
 * The props that make a group-labelled widget's rendered surface the thing its
 * host label actually NAMES — and, where nothing else can carry it, DESCRIBES
 * (objectui#3990, objectui#4005).
 *
 * ## What it is for
 *
 * A widget declared `labelling: 'group'` (objectui#3961) is told by the form
 * renderer: your label publishes an `id` and drops its `for`, so name yourself
 * by IDREF. The renderer hands down facts that address the field as a WHOLE:
 *
 *  - `id` — the host's control id (`…-form-item`), the id the label's `for`
 *    used to point at;
 *  - `aria-labelledby` — the IDREF of that visible label;
 *  - `aria-describedby` — the IDREF of `<FormDescription>`, the field's visible
 *    help text. Which surface may consume it is the one thing that is NOT
 *    uniform, so it is decided per call site — see {@link HostGroupSurface}.
 *
 * Every editable branch already consumes them inside its wider `toDomProps`
 * spread. The branches that returned EARLY did not — a field-level
 * `readonly: true`, or an option list with zero offered options — so the label
 * published an id that no element in the document referenced. Measured on
 * `origin/main`, one field per row, reading the host label against the DOM:
 *
 * ```
 * multiselect  readonly+value   consumers=0  byLabelText=0  namedByRole=[]
 * multiselect  readonly+empty   consumers=0  byLabelText=0  namedByRole=[]
 * multiselect  zeroOptions      consumers=0  byLabelText=0  namedByRole=[]
 * multiselect  editable         consumers=1  byLabelText=1  namedByRole=[group:1]
 * ```
 *
 * All seven group-labelled types measured the same, in every readonly state.
 * This is quieter than the dangling `for` #3961 replaced: a `for` that resolves
 * to nothing can at least be swept for, while "a label published an id and
 * nobody consumed it" looks like healthy markup.
 *
 * ## The description was the other half of the same defect (objectui#4005)
 *
 * #3990 landed the `id` + `aria-labelledby` pair above and deliberately stopped
 * there. The reasoning it recorded — a readonly display has no focusable
 * control, and `aria-describedby` is announced when focus lands on something
 * focusable — was the right call for the surface as it stood THEN: before this
 * helper existed, a readonly branch had no role at all, and on a role-less
 * `div` / `span` an `aria-describedby` is as inert as the `aria-labelledby`
 * was. That premise expired the moment #3990 gave those surfaces
 * `role="group"`. A group IS a description carrier under ARIA 1.2: assistive
 * technology announces a group's name and description on entering it, with no
 * focusable control required. So the help text stayed measurably unreachable
 * for exactly as long as it took to have somewhere to put it. Measured on
 * `origin/main` at `c25222758`, a real form, one field per row, counting the
 * elements whose `aria-describedby` names the rendered `<FormDescription>`:
 *
 * ```
 *                                    descEl  consumers  consumerTags
 * address      editable   desc=YES   SET         1      [input]
 * address      readonly   desc=YES   SET         0      []
 * geolocation  editable   desc=YES   SET         1      [input]
 * geolocation  readonly   desc=YES   SET         0      []
 * checkboxes   editable   desc=YES   SET         1      [div[group]]
 * checkboxes   readonly   desc=YES   SET         0      []
 * radio        editable   desc=YES   SET         1      [div[radiogroup]]
 * radio        readonly   desc=YES   SET         0      []
 * rating       editable   desc=YES   SET         1      [div[group]]
 * rating       readonly   desc=YES   SET         0      []
 * file         editable   desc=YES   SET         1      [div[button]]
 * file         readonly   desc=YES   SET         0      []
 * multiselect  editable   desc=YES   SET         1      [div[group]]
 * multiselect  readonly   desc=YES   SET         0      []
 * ```
 *
 * All seven render the `<FormDescription>` in the readonly state — none is
 * exempt for want of one — and all seven left it referenced by nothing.
 *
 * ## What still does NOT come along, and why that is a boundary and not an oversight
 *
 * `aria-invalid` and `aria-required` are CONTROL-channel state: they report
 * what a user's own editing may do wrong, to the element they would edit. A
 * readonly display cannot be edited and cannot be made invalid by the person
 * reading it, so putting either on it announces a state that has no action
 * behind it. Spreading the whole `toDomProps` result would drag both back —
 * along with `disabled` / `tabIndex` / the focus handlers, which only mean
 * something on an interactive element, and `name`, which is DOM-legal on form
 * controls only and on a `div` is exactly the leak objectui#3291 sweeps for.
 * That is what objectui#3291 and objectui#3318 drew the line against, and
 * adding the description does not move it: the description is what the FIELD
 * is, the other two are what the CONTROL is doing. The line is pinned from both
 * sides in `composite-group-label-readonly-e2e.test.tsx` — the description must
 * be there, `aria-invalid` / `aria-required` must not — so neither a later
 * "spread it all" nor a later "take it all back out" can pass quietly.
 *
 * Spreading the full result would also put the host's `className` on top of the
 * widget's own, because the widgets whose readonly surface is a placeholder or
 * a plain container (`EmptyValue`, `FileField`, `AddressField`) keep
 * `className` inside `props`.
 *
 * ## Why `role` travels with the keys
 *
 * `aria-labelledby` on a role-less `div` / `span` names NOTHING — `generic`
 * prohibits an author name — so the pair is inert without a role that supports
 * naming. `group` is the one that fits a readonly surface: it names a set of
 * values (chips, checked labels, stars, file names, a formatted address)
 * without promising the interactivity `textbox` or `radiogroup` would. It is
 * deliberately NOT the role the same widget answers with while editable:
 * `RadioField`'s readonly branch renders the chosen label as text with no radios
 * left in it, and `FileField`'s renders file names with no dropzone button.
 *
 * The role is emitted ONLY when a host actually named the field, mirroring
 * every editable branch's `isLabelledGroup` test: standalone rendering (the
 * grid's inline cell editor, a bare SDUI node) hands down neither key, so every
 * value here is `undefined`, React emits no attribute, and that markup stays
 * byte-identical to what it was.
 */
export interface HostGroupProps {
  /** The host's control id — the id its label would have pointed `for` at. */
  id?: string;
  /** IDREF of the host's visible label. */
  'aria-labelledby'?: string;
  /**
   * IDREF of the host's visible help text — present only on a surface that
   * renders no input of the field's own. See {@link HostGroupSurface}.
   */
  'aria-describedby'?: string;
  /** `'group'` when — and only when — a host named this surface. */
  role?: 'group';
}

/**
 * WHERE the surface being named sits relative to the field's own inputs. The
 * name is uniform; the DESCRIPTION is not, so every call site has to say which
 * of the two shapes it is, and the compiler makes the next widget author say it
 * too rather than inherit whichever default happened to be there.
 *
 *  - `'above-the-inputs'` — a composite's EDITABLE container (`address`,
 *    `geolocation`): the field's real inputs are inside it and each already
 *    receives `aria-describedby` in its own `toDomProps` spread, straight from
 *    `<FormControl>`'s Slot. This surface therefore takes the NAME only.
 *    objectui#3318 chose that split deliberately and
 *    `composite-group-label-e2e.test.tsx` pins it: the help text is announced
 *    when focus reaches the box the user types into, and announcing it a second
 *    time on the container that merely wraps those boxes is a double channel of
 *    exactly the kind objectui#3290 removed from the required marker.
 *
 *  - `'instead-of-the-inputs'` — every readonly branch, and the zero-option box
 *    (`OptionsEmptyState`). The field renders no input at all here, so no
 *    element inside can carry the description and this surface is the only
 *    candidate there is. It takes the name AND the description.
 *
 * Note what the discriminator is NOT about: whether the surface contains
 * anything focusable. `geolocation`'s readonly row holds a "View on map" link
 * — focusable, and correctly announced as itself. It is not an input OF THE
 * FIELD and never receives the field's `aria-describedby`, so that row is still
 * `'instead-of-the-inputs'`.
 */
export type HostGroupSurface = 'above-the-inputs' | 'instead-of-the-inputs';

/**
 * Read the whole-field keys out of a widget's leftover props, plus the role
 * that makes them mean something. See {@link HostGroupProps} and
 * {@link HostGroupSurface}.
 *
 * Routed through {@link toDomProps} rather than reading `props` directly so the
 * keys keep ONE gate: they reach an element only if the DOM pass-through
 * whitelist still forwards them, and its compile-time assertions bind that
 * whitelist to the props contract in both directions.
 *
 * `aria-describedby` is forwarded exactly as the host handed it down, with no
 * check that it resolves — a widget cannot see whether `<FormDescription>`
 * rendered, and a DOM probe for it would be a layout-effect hack around the
 * renderer's own knowledge. That is not a new gap: `<FormControl>`'s Slot emits
 * the IDREF unconditionally, so a field with NO description already hands every
 * editable control an `aria-describedby` pointing at an element that does not
 * exist. Measured on `origin/main` at `c25222758`, `desc=NO`: all seven
 * group-labelled widgets plus the builtin `input` and the single-control
 * `email` carry exactly one such reference, on the same element that would
 * carry a resolving one. A readonly surface answering identically is parity
 * with the editable branch, not a class of its own — and an IDREF that resolves
 * to nothing is inert for assistive technology, where an unconsumed
 * description is simply lost.
 */
export function toHostGroupProps(
  props: {
    id?: string;
    'aria-labelledby'?: string;
    'aria-describedby'?: string;
  },
  surface: HostGroupSurface,
): HostGroupProps {
  const {
    id,
    'aria-labelledby': labelledBy,
    'aria-describedby': describedBy,
  } = toDomProps(props);
  return {
    id,
    'aria-labelledby': labelledBy,
    ...(surface === 'instead-of-the-inputs' ? { 'aria-describedby': describedBy } : null),
    ...(labelledBy != null ? { role: 'group' as const } : null),
  };
}

/**
 * The host keys a LABELABLE surface may consume — the `labelling: 'control'`
 * counterpart of {@link HostGroupProps} (objectui#8803).
 *
 * ## Why a second, smaller bag instead of reusing the group one
 *
 * A widget declared `'control'` is told nothing by the host: its label emits a
 * plain `for` and expects to reach a labelable element on its own. Every
 * editable branch answers that by spreading `toDomProps` onto the control it
 * renders. The branches that return EARLY answer it with nothing — and for the
 * single `SelectField` that is the zero-option box, where the `…-form-item` id
 * reached no element at all and the label's `for` DANGLED.
 *
 * What such a surface needs is therefore the exact complement of the group
 * bag:
 *
 *  - `id` — yes. It is the id the `for` points at, and landing it is the whole
 *    repair;
 *  - `aria-describedby` — yes, for the objectui#4005 reason, unchanged by the
 *    surface being labelable: the field renders no input in this state, so
 *    this box is the only element the visible help text can be announced on;
 *  - `aria-labelledby` — ⛔ NO. The `for` already names this element. Adding an
 *    IDREF beside it is the second naming channel objectui#3978 removed;
 *  - `role` — ⛔ NO. A labelable element's own semantics are what make the name
 *    land; a synthetic role on top is the category error objectui#3991 named.
 *
 * `aria-invalid` / `aria-required` / `name` stay off for the reasons spelled
 * out at length on {@link HostGroupProps}: control-channel state on a surface
 * nobody can edit, and the DOM leak objectui#3291 sweeps for. A closed type,
 * not an open props tail, for that same reason.
 */
export interface HostControlProps {
  /** The host's control id — the id its label's `for` points at. */
  id?: string;
  /** IDREF of the host's visible help text. */
  'aria-describedby'?: string;
}

/**
 * Read the two whole-field keys a labelable replacement surface may carry. See
 * {@link HostControlProps}.
 *
 * Routed through {@link toDomProps} for the same reason {@link toHostGroupProps}
 * is: the keys keep ONE gate, and its compile-time assertions bind that
 * whitelist to the props contract in both directions.
 *
 * Standalone rendering (the grid's inline cell editor, an action param dialog,
 * a bare SDUI node) hands down neither key, so both values are `undefined`,
 * React emits no attribute, and that markup stays byte-identical.
 */
export function toHostControlProps(props: {
  id?: string;
  'aria-describedby'?: string;
}): HostControlProps {
  const { id, 'aria-describedby': describedBy } = toDomProps(props);
  return { id, 'aria-describedby': describedBy };
}
