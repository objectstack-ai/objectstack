// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #21180 — ADR-0087 D2, immediate retirement (the maintainer's ruling E on
// #21079, comment 5933054144, reversing the #7467 ruling) — the D3 entry of the
// `form-field-public-picker-removed` family (ruling B on #17152: one D3 entry
// per retirement family, even when D2 is lossless). Registered key:
// `ui/FormField:publicPicker`. The strip changes nothing a visitor sees — the
// resolve route already leaves the field off the anonymous rendering — but the
// visitor's way to choose a value is gone, and only the author can say what
// replaces it.
export const entry: SemanticMigration = {
  id: 'form-field-public-picker-retired',
  surface: 'view.form.sections[].fields[].publicPicker — the anonymous public-form record-search picker',
  replacement: 'No record search on an anonymous public form. For a choice from a fixed list, a '
    + '`select` field with static `options`. For a choice of an existing record, the same form '
    + 'behind sign-in, where the lookup field renders with the signed-in user\'s access.',
  reason: 'The D2 conversion `form-field-public-picker-removed` deletes `publicPicker` from every '
    + 'form field, and the delete is lossless in effect: the block\'s only reader was the '
    + 'anonymous lookup route, which is gone, and the public-form resolve route now leaves '
    + 'lookup, `master_detail` and `user` fields off the anonymous rendering whatever the row '
    + 'carries. What the strip cannot decide is the visitor\'s path. A public form that used the '
    + 'picker let an anonymous visitor search and pick a record; after the upgrade that field is '
    + 'simply absent from the form, so a submission arrives without the value. Whether the '
    + 'choice was really from a small fixed set (a `select` with static `options`), or needs a '
    + 'real record and therefore a signed-in user, is a product decision only the author can make.',
  acceptanceCriteria: 'No form field carries `publicPicker`; the parse refuses it. Every public '
    + 'form that had carried one either replaces the lookup field with a `select` field whose '
    + 'static `options` list the allowed choices, or is served behind sign-in, or the author has '
    + 'confirmed the form works without the value. Fetching the public form anonymously '
    + '(`GET /forms/:slug`) shows no lookup, `master_detail` or `user` field in its sections.',
};
