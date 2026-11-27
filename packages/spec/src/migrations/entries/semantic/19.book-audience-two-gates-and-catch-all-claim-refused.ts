// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// Two narrowings of a book's access gate (ADR-0046 §6.7), one upgrade-guide
// entry: the parse refuses an `audience` naming both `permissionSet` and
// `systemPermission`, where the set arm used to strip the capability, and the
// author-time rule `book-gated-catch-all-include` refuses a gated book whose
// group claims docs with the catch-all. No key is removed and no D2 conversion
// exists, because each fix is a choice only the author can make (which gate the
// book means, which pages it claims). No relevance question: the runtime save
// door judges a book written through Studio, REST `/meta` or MCP too, which no
// question over one stack can name.
export const entry: SemanticMigration = {
  id: 'book-audience-two-gates-and-catch-all-claim-refused',
  surface:
    'A book `audience` object carrying both `permissionSet` and `systemPermission` (refused at the parse, by '
    + '`defineStack`, `os validate` and the `/meta` save); a book whose `audience` is `{ permissionSet }` or '
    + '`{ systemPermission }` with a group claiming docs by `include: \'*\'` (`book-gated-catch-all-include`, an error '
    + 'from `os validate` / `lint` / `build` and from the runtime publish gate)',
  replacement:
    'Keep one gate: `{ systemPermission: \'<capability>\' }` for everyone who holds the capability through any '
    + 'permission set, or `{ permissionSet: \'<set>\' }` for the holders of that one set. Claim a gated book\'s pages '
    + 'by name: a namespace glob (`include: \'<namespace>_*\'`), a tag include or pinned `pages`',
  reason:
    'A two-gate audience parsed as the set form with the capability dropped, so the book was gated on the set alone '
    + 'while its author believed it was gated on the capability. A gated catch-all claims every stored doc bound to no '
    + 'package as well, because a package scope leaves out only a doc stamped with another package, and hides it from '
    + 'every reader outside the audience. Stored books are not rewritten or refused at boot; the next save or publish '
    + 'of such a book is refused with the fix named.',
  acceptanceCriteria:
    'os validate reports no `book-gated-catch-all-include` and accepts every book audience; a save of every book the '
    + 'package carries succeeds.',
};
