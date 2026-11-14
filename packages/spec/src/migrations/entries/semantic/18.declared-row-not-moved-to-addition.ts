// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// ADR-0150 D4 (#32606): a row of an App's `.custom` pair that declares package X
// is X's while X still ships any member of the name, never also a bundle
// addition Z's "moved edit" because Z ships the row's member and X does not. A
// change of which stored row a read serves at Z, not of any key: no schema key
// moves and no stored row changes shape, so no tombstone and no D2 conversion.
// No relevance question: the moved answer turns on two installed packages of one
// App shipping members of one name, which no question over one stack can name.
export const entry: SemanticMigration = {
  id: 'declared-row-not-moved-to-addition',
  surface:
    'A bundled item (an email_template locale) that an App\'s .custom pair stores declaring package X '
    + '(overrides: { package: X }) at a member X does not ship, while X ships another member of the name and a '
    + 'bundle addition Z of the same App ships that member: the reads at Z\'s address (GET /api/v1/meta/TYPE/NAME'
    + '?package=Z&member=M), Z\'s list (GET /api/v1/meta/TYPE?package=Z), the execution list a send resolved to Z '
    + 'reads, and the customizations read of Z',
  replacement:
    'Read the declared row at the package it declares: GET /api/v1/meta/TYPE/NAME?package=X&member=M and X\'s '
    + 'list serve it, as before. To customize Z\'s own member, save a row declaring Z (overrides: { package: Z }).',
  reason:
    'The moved-edit rule (#31593) serves a row declaring a former owner at the package that ships the item now, '
    + 'and it asked whether the former owner still ships the item at the member\'s grain. X ships the name (another '
    + 'member), so it still holds it and serves the row at its own address; Z also served it, stamped Z, as its own '
    + 'item: one row at two packages\' addresses (ADR-0150 red line 2). The former owner is now asked at the '
    + 'name\'s grain, so Z serves its own member. A former owner that ships nothing of the name any more still '
    + 'hands its edit on, as before. There is no mechanical rewrite: whether a tenant meant X\'s row for Z is a '
    + 'judgement about that tenant.',
  acceptanceCriteria:
    'For every App pair row declaring a package that still ships a member of the name, at a member a bundle '
    + 'addition of the App ships: GET /api/v1/meta/TYPE/NAME?package=ADDITION&member=M and the addition\'s lists '
    + 'answer the addition\'s own member, the declared package\'s address and lists answer the row, and a tenant '
    + 'who wants the addition\'s member customized has saved a row declaring the addition.',
};
