// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// A narrowing of the by-name reads naming no bundle member, not of any key:
// #34682 aligns them to the member selector's declared sentence (absent means
// the canonical member; naming the canonical value is the same request; a
// member with nothing stored or shipped answers as an absent item). For a
// bundle that ships or stores no canonical member, the plain read, the layered
// read and the execution read naming no member served another member (the
// registry's bare-name read answers such a bundle with its first member),
// while ?member=CANONICAL and /published answered 404; a bundle stored only as
// a non-canonical row moved from 404 to 200 across a restart. No key is added,
// removed or re-shaped and no stored row changes shape, so no tombstone and no
// D2 conversion. No relevance question: the move turns on which members a
// name's holders ship and store, which no question over one stack can name.
export const entry: SemanticMigration = {
  id: 'bundle-without-canonical-member-bare-read-absent',
  surface:
    'GET /api/v1/meta/TYPE/NAME (with or without ?package=) and GET /api/v1/meta/TYPE/NAME/layers naming no bundle '
    + 'member, and the execution read '
    + 'naming none, for a bundled metadata name (an email_template) that no layer ships or stores in its canonical '
    + 'member (en-US): they served another member of the bundle (status 200), and a bundle stored only as a '
    + 'non-canonical row answered 404 before a restart and served that row after one. ?member=CANONICAL and '
    + '/published do not move',
  replacement:
    'Name the member: GET /api/v1/meta/TYPE/NAME?member=MEMBER (for example ?member=fr-FR) serves that member, as before.',
  reason:
    'A read naming no member addresses the canonical member, and naming the canonical value is the same request: the '
    + 'member selector declares this on every by-name read. A bundle with no canonical member therefore answers that '
    + 'read as an absent item, as ?member=CANONICAL and /published already answered it, before and after a restart. '
    + 'There is no mechanical rewrite: which member a caller meant is a judgement about that caller.',
  acceptanceCriteria:
    'For every bundled name no layer ships or stores in its canonical member: every caller that reads it by name '
    + 'without a member names the member it wants with ?member=MEMBER (the execution read with its member option) '
    + 'instead; the read naming no member, /layers naming none and the execution read naming none answer 404 (null), '
    + 'the same as ?member=CANONICAL and /published, before and after a restart.',
};
