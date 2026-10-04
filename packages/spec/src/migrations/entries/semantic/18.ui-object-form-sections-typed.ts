// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #21464 — the `sections` of the `object-form` and `object-master-detail-form`
// page blocks were `z.array(z.unknown())`: a section's `fields` draws an inline
// runtime form field beside a name and the form view's `{ field }` entry, which
// the stored form view's section refuses. The maintainer ruled on #21704 (fork
// 3, letter B) a page-block section shape of its own — the form view's section
// keys plus the three entry arms the form reads, canonical spellings only — and
// the stored form view is unchanged. D3 only: page-component `properties` is
// not parsed on the metadata save or load path, so a stored page is never
// refused; and the authored census, with every inline option list evaluated,
// found no working section to respell — the refused values are the two probes
// in objectui's `formSectionGroupReference-7051.test.tsx` (a section declaring
// neither `fields` nor `group`, and a group-owned `label` / `collapsible`
// beside `group`), shapes that test says this door refuses at parse.
export const entry: SemanticMigration = {
  id: 'ui-object-form-sections-typed',
  surface: 'page `object-form` and `object-master-detail-form` components — `properties.sections` (whose '
    + 'entries used to accept any value)',
  replacement: 'closed sections `{ name?, label?, description?, collapsible?, collapsed?, visibleWhen?, '
    + 'columns?, pane?, fields }` (or `{ group, columns?, pane? }`), each `fields` entry a field name, the form '
    + 'view\'s `{ field, … }` entry or an inline form field `{ name, type, … }`. Write a section or field '
    + '`visibleOn` as `visibleWhen`, a string `columns: \'2\'` as the number `2`, and a section `label` (or a '
    + 'field entry\'s `label` / `placeholder` / `helpText`) as a plain string.',
  reason: 'The form reads a section\'s heading, collapse pair, `visibleWhen`, `columns`, `pane`, `group` and '
    + '`fields` — the key set of the form view\'s section — and draws three kinds of field entry: a name, the '
    + 'form view\'s `{ field }` entry overriding that object field, and an inline runtime form field drawn as '
    + 'it stands. The page-component rows declared each section `z.unknown()`, so a misspelled key passed the '
    + 'component-props gate and the form drew the section without it; a form view\'s deprecated `visibleOn` '
    + 'and string `columns`, which a form view folds at parse, reached the form raw — a page block\'s '
    + '`properties` is never parsed on the way — and were dropped. Both rows now take one section shape of '
    + 'their own, the stored form view unchanged: the form view\'s section keys plus the three entry arms, '
    + 'canonical spellings only, a label a plain string because the form draws it as it stands, and the form '
    + 'view\'s group-reference rule. It is read where every page component\'s props are: the component-props '
    + 'gate reports a refused value as an advisory `component-props-invalid` / `component-props-unknown-key` '
    + 'finding on `objectstack validate`, `objectstack build` and `objectstack lint`, and a stored page still '
    + 'saves and loads, because a page component\'s `properties` is not parsed on the metadata save or load '
    + 'path. No conversion is registered: nothing on the load path refuses the shape, and the authored census, '
    + 'with every inline option list evaluated, found no working section to respell. Deployed metadata NOT '
    + 'MEASURED.',
  acceptanceCriteria: 'Every `object-form` and `object-master-detail-form` node validates: `objectstack '
    + 'validate` reports no `component-props-invalid` / `component-props-unknown-key` finding under '
    + '`properties.sections`. Each form draws every section with the heading, visibility and columns it '
    + 'names, and every entry in it.',
};
