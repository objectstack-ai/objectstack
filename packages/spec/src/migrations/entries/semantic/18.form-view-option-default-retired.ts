// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #12868 (maintainer-ruled narrowing on the objectui#6263 analysis) — the D3
// entry of the `form-view-option-default-removed` family (ruling B on #17152:
// one D3 entry per retirement family, even when D2 is lossless). The strip
// changes no form; the prescribed replacement changes MORE than one form, and
// that difference is the author's call.
export const entry: SemanticMigration = {
  id: 'form-view-option-default-retired',
  surface: 'view.form.sections[].fields[].options[].default — the per-option pre-selection on a '
    + 'form view\'s own option list',
  replacement: 'The object field\'s own option list, where `default` is enforced: `default: true` '
    + 'on that field\'s options entry, or the field-level `defaultValue`.',
  reason: 'The D2 conversion `form-view-option-default-removed` deletes `default` from every option '
    + 'of every form-view field it reaches, and the delete is lossless: nothing on the form path '
    + 'ever read it — the insert-path default falls back to the OBJECT definition\'s options, and '
    + 'no form renderer seeds a value from a form view\'s. So a form that marked an option as '
    + 'default never pre-selected it, and still does not. The judgment is in the replacement. The '
    + 'form-view key was scoped to ONE form; the object field\'s `default` applies on EVERY insert '
    + 'path — every form of that object, the API, imports. Moving the marker there makes the form '
    + 'do what its author wanted and also changes what records created elsewhere receive when the '
    + 'value is omitted. Only the author can say whether that wider default is correct, or whether '
    + 'the pre-selection should be dropped.',
  acceptanceCriteria: 'No form-view option carries `default`; the parse refuses it. For each form '
    + 'field that had marked one: either the object field now declares the default and the author '
    + 'has accepted it for every insert path — a record created through the form or the API with '
    + 'the field left empty is stored with that value — or the author has decided the form needs '
    + 'no pre-selection and the object field is unchanged.',
};
