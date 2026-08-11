// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'record-details-sections-object-form',
  surface: 'ui.RecordDetailsProps.sections (the `record:details` page component)',
  replacement:
    'an OBJECT array — `sections: [{ label, columns, fields: [...] }]` — replacing the '
    + 'string-ID list; `label` gives the heading, `columns` its grid width, `name` makes the '
    + 'heading translatable, and the new sibling `hideFields` omits named fields from the body',
  reason:
    '`record:details` declared `sections` as a list of section IDs — `["overview", '
    + '"financials"]` — a shape nothing produced and nothing consumed, while every real page '
    + 'authored the object form. This is authorable metadata on the publish/parse path, so it '
    + 'is the D2 class exactly; it is registered as a SEMANTIC step rather than a mechanical '
    + 'conversion because a string ID carries no field list and the chain cannot invent one — '
    + 'only the author knows which fields the section named `overview` was meant to render. '
    + 'The measurement that made the type change safe is also what makes the prescription '
    + 'unambiguous: the ID-list form had zero read paths and zero producers. objectui\'s '
    + '`RecordDetailsRenderer` maps every entry as an object (`s.name` / `s.label` / `s.title` '
    + '/ `s.fields`) with no string branch at all — a string entry spreads into a character '
    + 'map and renders nothing; `@object-ui/types`\' `RecordDetailsComponentProps` mirror '
    + 'already declared `Array<{ name?, label?, fields, ... }>`; the Studio block designer can '
    + 'only author `{ label, columns, fields }`; `packages/lint` has modelled it as '
    + '`nestedSections` all along; and every page in this repo — three showcase pages plus the '
    + '`sys_user` platform page — authors the object form. So the break lands only on stored '
    + 'metadata written against a declaration nothing ever honoured, and it lands at publish '
    + 'time rather than rewriting data at rest. The same change DECLARED `hideFields`, which '
    + 'the `sys_user` platform page had been authoring undeclared. Registered by the #6350 '
    + 'stock reconciliation: #5611 predates the #6148 completeness gate, so nothing asked it '
    + 'what it had done about the ledger, and the sibling key on the same def — '
    + '`ui/RecordDetailsProps:layout`, retired by #6350\'s neighbour — carries a tombstone '
    + 'while this face carried none. ADR-0087, #5611 (backfilled #6350).',
  acceptanceCriteria:
    'Every `record:details` component in authored metadata spells `sections` as an object '
    + 'array: each entry names the fields it renders (`fields: [...]`), optionally with '
    + '`label` / `name` / `columns`. `objectstack validate` passes and each detail page '
    + 'renders the same sections, in the same order, with the same fields as before the '
    + 'upgrade — a page whose sections silently render EMPTY is the signature of an ID list '
    + 'left in place. A section that existed only as an ID, with no field list recoverable '
    + 'from the page it belonged to, is a judgement for the author: name the fields it was '
    + 'meant to show, or delete the entry. Fields previously hidden by a convention outside '
    + 'the schema move onto the declared `hideFields`.',
};
