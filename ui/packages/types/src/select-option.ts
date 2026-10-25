/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @object-ui/types - The select-option contract, declared once
 *
 * A select option is ONE concept that this package used to describe twice by
 * hand: once as the object-metadata read model (`SelectOptionMetadata` in
 * `./field-types`) and once as the SDUI form vocabulary (`SelectOption` in
 * `./form`). Both now extend the derivation below, so the vocabulary is stated
 * in a single place and each face writes down only what it changes.
 *
 * @module select-option
 * @packageDocumentation
 */

import type { SelectOption as SpecSelectOption } from '@objectstack/spec/data';

/**
 * The objectui select-option contract, DERIVED from the spec's own
 * `SelectOption` (`@objectstack/spec/data`), with every divergence written out
 * (`98d4108a2`).
 *
 * The spec's keys arrive BY REFERENCE through the `Omit`, so a key the spec
 * adds appears on both objectui faces with no edit here, and a key it removes
 * becomes a compile error at the sites that read it. That is the whole point of
 * deriving rather than restating: a hand copy goes on compiling while the
 * contract moves underneath it, and answers an older question in silence.
 *
 * WHAT COMES FROM THE SPEC, unchanged:
 *
 *   - `label` — the human-readable display label. REQUIRED, because the spec
 *     makes it required. An empty string is a valid label; an ABSENT one is
 *     not.
 *   - `value` — the stored value, a lowercase machine identifier. The
 *     object-metadata face keeps this as declared; the SDUI form face widens it
 *     for standalone forms and names that widening in its own `Omit`.
 *   - `color` — colour code for badges/charts.
 *   - `default` — marks the option the platform seeds a new record with.
 *   - `kind` — the option's lifecycle category, `open` / `won` / `lost`
 *     (`@objectstack/spec` 18.0.0-next.3). The spec takes it on a single-value
 *     `select` / `radio` field's options and requires it on every option of
 *     the field an object's `stageField` names; its form-view option list
 *     (`FormSelectOptionSchema`) does not take it.
 *
 * WHAT DIVERGES, each named at its own member below: `visibleWhen` (dropped
 * from the spec type in the `Omit` and re-declared on objectui's wire shape),
 * plus the two objectui-only keys `disabled` and `icon`.
 *
 * WARNING - this type is WIDER than the authoring contract, and it is not a
 * description of what an authored object document may carry. It is the runtime
 * READ MODEL the renderers consume. The spec's `SelectOptionSchema` is a strict
 * object, and it refuses `disabled` and `icon` BY NAME (`unrecognized_keys`); a
 * field's `options` are routed through that schema, so either key written into
 * authored object metadata fails the WHOLE field at publish time. Each refusal,
 * behind an accepting control, is re-derived by
 * `__tests__/select-option-spec-extension-7014.test.ts` and
 * `__tests__/select-option-tier1-convergence-7014.test.ts` — read their verdict
 * rather than a key list copied into this paragraph, which is how the previous
 * copy went stale.
 *
 * ⚠️ That list USED to be spelled out here as "exactly `label`, `value`,
 * `color`, `default` and `visibleWhen`", and `@objectstack/spec` 17.3.0 falsified
 * it by declaring a sixth key, `description` (objectui#6153; corrected by
 * `544ecba84`). The enumeration is deliberately not replaced with a longer
 * one: the keys arrive through the `Omit` BY REFERENCE, so a list written here
 * can only ever disagree with the derivation it sits above.
 */
export interface SelectOptionBase extends Omit<SpecSelectOption, 'visibleWhen'> {
  /**
   * Per-option visibility predicate (CEL). The option is offered only when this
   * evaluates TRUE against the live record plus `current_user`; omit it and the
   * option is always available. Expresses cascading/dependent options
   * (`record.country == 'cn'`) and role/context gating
   * (`'admin' in current_user.positions`).
   *
   * This is the spec's key carried on objectui's own WIRE shape (objectui#2212)
   * — a bare string, or the object form `{ dialect?, source }` with `source`
   * required. The spec's declared input is an expression pipe that
   * canonicalizes a bare string into an envelope at parse time and makes
   * `dialect` the required member; adopting it here would change what this
   * package's zod twin emits, so the key is dropped from the derivation above
   * and re-declared with this shape instead. The two are therefore NOT
   * interchangeable in either direction, which is why the divergence is written
   * down rather than inherited.
   *
   * Client-side hiding is UX, not authorization — an option gated for
   * access-control reasons must also be rejected server-side.
   */
  visibleWhen?: string | { dialect?: string; source: string };
  /**
   * Whether the option is rendered but not selectable.
   *
   * WARNING - objectui-only extension, NOT a spec key. The spec's
   * `SelectOptionSchema` refuses `disabled` BY NAME (`unrecognized_keys`) and
   * deliberately has no per-option enabled/disabled flag: on the OBJECT-field
   * face an option is offered or withheld (`visibleWhen`), never shown-but-
   * unselectable, and the whole picker is frozen with `readonly` on the field.
   * This key belongs to objectui's own component vocabulary and must never
   * reach an authored object document.
   */
  disabled?: boolean;
  /**
   * Icon name rendered beside the option label.
   *
   * WARNING - objectui-only extension, NOT a spec key. The spec's
   * `SelectOptionSchema` refuses `icon` BY NAME (`unrecognized_keys`). It lives
   * on the runtime read model the renderers consume and must never reach an
   * authored object document.
   */
  icon?: string;
}
