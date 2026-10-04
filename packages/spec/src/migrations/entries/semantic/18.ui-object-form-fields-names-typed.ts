// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #21464 — the top-level `fields` of the `object-form` and
// `object-master-detail-form` page blocks was `z.array(z.unknown())`, held
// while the form drew a `{ name }` field entry its own page-builder guide
// taught. objectstack-ai/objectui#11550 retired that entry from every authoring
// face (the form still draws a STORED one, by its name, as tolerance), so both
// rows now take field names — objectui's own declaration of the member — and
// an object entry is refused with what to write instead. D3 only: page-
// component `properties` is not parsed on the metadata save or load path, so a
// stored page is never refused; and the authored census found no authored
// value to respell — the refused values are fixtures probing the stored read,
// the console warning and objectui's own refusal.
export const entry: SemanticMigration = {
  id: 'ui-object-form-fields-names-typed',
  surface: 'page `object-form` and `object-master-detail-form` components — `properties.fields` (whose '
    + 'entries used to accept any value)',
  replacement: 'a list of bare field names, in the order the form draws them. Write a `{ name: \'email\' }` '
    + 'entry as `\'email\'` — the form only ever drew its name — and move a `label` or `required` override '
    + 'onto a `sections[].fields` entry (`type` is always the object field\'s); write a `{ field: \'email\' }` '
    + 'entry as `\'email\'`, or move it into a section\'s `fields`, the vocabulary it belongs to.',
  reason: 'The form reads its top-level `fields` as the names of the fields to draw, in order, selecting '
    + 'from the object\'s fields and from `customFields`; the master-detail form hands its own to the parent '
    + 'form verbatim. objectui declares the member `string[]`, but the page-component rows declared it '
    + '`z.array(z.unknown())` while the form drew a `{ name }` entry by that name — the shape objectui\'s '
    + 'page-builder guide taught, with a `label`, `type` and `required` the form silently dropped. '
    + 'objectui has since retired that entry from every authoring face — the guide and its fixtures name the '
    + 'fields — keeping only a STORED one readable; so both rows now take field names, and refuse an object entry with what to write instead: a '
    + '`{ name }` entry is its bare name, and a `{ field }` entry — the `sections[].fields` vocabulary, which '
    + 'the form skips at the top level with a console warning — is its bare name or belongs in a section. It is '
    + 'read where every page component\'s props are: the component-props gate reports a refused value as an '
    + 'advisory `component-props-invalid` finding on `objectstack validate`, `objectstack build` and '
    + '`objectstack lint`, and a stored page still saves and loads, because a page component\'s `properties` is '
    + 'not parsed on the metadata save or load path. No conversion is registered: nothing on the load path '
    + 'refuses the shape, the form already draws a stored `{ name }` entry by its name, and an override written '
    + 'beside it has no rewrite that keeps it — moving it onto a section is the judgment this entry leaves to '
    + 'the upgrader. Deployed metadata NOT MEASURED.',
  acceptanceCriteria: 'Every `object-form` and `object-master-detail-form` node validates: `objectstack '
    + 'validate` reports no `component-props-invalid` finding under `properties.fields`. Each form draws the '
    + 'fields its list names, in that order, with any per-form label or required override taken from its '
    + 'section entry.',
};
