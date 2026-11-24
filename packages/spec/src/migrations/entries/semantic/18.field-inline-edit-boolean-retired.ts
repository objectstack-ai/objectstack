// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #35926 (ADR-0049 enforce-or-remove; the field-group ruling of #35889) — the
// D3 entry of the `field-inline-edit-boolean-removed` family (one D3 entry per
// retirement family, even when D2 is lossless). The conversion deletes a
// boolean `inlineEdit`; what it cannot decide is whether the author meant the
// child to be inlined in the parent's form, which only a parent field group does.
export const entry: SemanticMigration = {
  id: 'field-inline-edit-boolean-retired',
  surface: 'object.fields.<fk>.inlineEdit: true | false on a lookup or master_detail field — the boolean '
    + 'arm of the inline form factor',
  replacement: 'Leave the key out for the form factor picked from the child\'s shape, or write `\'grid\'` or '
    + '`\'form\'`. To inline the child in the parent\'s create and edit forms, name it in a field group of the '
    + 'parent: `fieldGroups: [{ key, label, relatedList: \'<child object>\' }]` on the parent object.',
  reason: 'The D2 conversion `field-inline-edit-boolean-removed` deletes a boolean `inlineEdit`, and that is '
    + 'lossless: `true` and `false` both read as an absent key, the form factor picked from the child\'s shape. '
    + 'The judgment it cannot make is the author\'s intent. An `inlineEdit: true` was usually written to put '
    + 'the child\'s rows into the parent\'s form, and since the field-group placement it no longer does that by '
    + 'itself: only a field group of the parent that names the child inlines it. Where the parent declares no '
    + 'such group, the child is a tab of the parent\'s record page and stays out of its form, with or without '
    + 'this conversion; the author decides whether to add the group. Code that builds object definitions (a '
    + 'host, a generator) must also stop emitting a boolean, which no conversion reaches.',
  acceptanceCriteria: 'No lookup or master_detail field carries a boolean `inlineEdit`; the parse refuses one. '
    + 'Every child whose rows are meant to be entered in the parent\'s form is named by a field group of the '
    + 'parent (`fieldGroups[].relatedList`), and `os validate` reports no new issue.',
  conversionIds: ['field-inline-edit-boolean-removed'],
};
