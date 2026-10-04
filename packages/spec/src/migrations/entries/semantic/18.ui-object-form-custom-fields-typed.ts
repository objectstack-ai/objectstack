// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #21464 — the `object-form` page block's `customFields` was `z.unknown()`:
// each member is objectui's runtime form field, which the spec did not declare,
// and objectui's own declaration is open and spells eight of its members in
// snake_case. The maintainer ruled on #21704 (fork 2, letter B) that the spec
// declares a closed runtime form field of the members the form draws, in
// camelCase, keyed by `name`. D3 only: page-component `properties` is not
// parsed on the metadata save or load path, so a stored page is never refused;
// and the authored census, with every inline option list evaluated, found no
// working member to respell — the refused values are a type-level test's
// `visibleOn` and a fixture pinning that an inline `defaultValue` seeds
// nothing. The shipped object-manager dialog's options (`{ label: 'Box', value:
// 'Box' }`, …) parse because an inline option's `value` is a runtime value, not
// a stored field's identifier; typed as the form view's option, they did not.
export const entry: SemanticMigration = {
  id: 'ui-object-form-custom-fields-typed',
  surface: 'page `object-form` components — `properties.customFields` (which used to accept any value)',
  replacement: 'a list of closed inline form fields `{ name, label?, type?, required?, options?, … }` — the '
    + 'members the form draws, in camelCase, each option `{ label, value, description?, visibleWhen? }` with '
    + '`value` a string, a number or a boolean. Write a `visibleOn` (or a legacy `condition`) as '
    + '`visibleWhen`, move a member\'s `defaultValue` into the block\'s `initialValues`, drop `id`, and leave '
    + 'the `grid` widget\'s snake_case keys (`min_rows`, `allow_add`, …) out until the widget reads a camelCase '
    + 'spelling.',
  reason: 'The form merges `customFields` over the fields it generates from the object\'s metadata — a member '
    + 'naming a declared field replaces that field\'s whole definition, any other is added — and draws each '
    + 'member as it was written, handing it to the field widget as its metadata. The page-component row '
    + 'declared it `z.unknown()`, so `42`, a member with no `name`, or a misspelled member passed the '
    + 'component-props gate, and the form drew the field without it. The row now takes a closed runtime form '
    + 'field of the members the form draws, keyed by `name`, each typed to its read — by reference where this '
    + 'package already declares the member (the object field\'s metadata members, the evaluated predicates). '
    + 'An option is the runtime option the form\'s option controls draw — `label`, `value`, `description`, '
    + '`visibleWhen` — and its `value` is any string, number or boolean, kept as written: an inline field binds '
    + 'no object column, so a stored field\'s lowercase identifier rule does not apply to it. It is read where '
    + 'every page component\'s props are: the component-props gate '
    + 'reports a refused value as an advisory `component-props-invalid` / `component-props-unknown-key` '
    + 'finding on `objectstack validate`, `objectstack build` and `objectstack lint`, and a stored page still '
    + 'saves and loads, because a page component\'s `properties` is not parsed on the metadata save or load '
    + 'path. No conversion is registered: nothing on the load path refuses the shape, and the authored census, '
    + 'with every inline option list evaluated, found no working member to respell. Deployed metadata NOT '
    + 'MEASURED.',
  acceptanceCriteria: 'Every `object-form` node validates: `objectstack validate` reports no '
    + '`component-props-invalid` / `component-props-unknown-key` finding under `properties.customFields`. '
    + 'Each form draws every inline field with the label, type and rules its member names.',
};
