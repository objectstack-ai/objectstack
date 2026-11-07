// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// ADR-0055 §1 and §2 as amended (maintainer ruling A on the optional master):
// a controlled_by_parent object whose only master_detail is declared
// `required: false` derives an OPTIONAL master. A widening beside
// cbp-master-relation-tiers-retired, which refused the shape: an explicit
// `required: false` is accepted at every door, the builder keeps it as written,
// and a stored row in it stops being listed and denied. A detail row that names
// no master is read by its owner and by View All on the detail; a row that
// names one is read through its master, as before. An OMITTED `required` keeps
// its meaning where the spec sees the omission (the builder force and the D2
// conversion cbp-master-detail-required-defaulted, both unchanged). No D2
// conversion: nothing is rewritten.
//
// The write side followed under ADR-0055 §3 as amended (same ruling A, PR
// #31082), and the `replacement` below records it beside the read side: a
// detail row whose OPTIONAL master reference is empty is written by its owner
// and by Modify All on the detail and refused `403 PERMISSION_DENIED` for
// everyone else, an insert naming no master is admitted, and only a REQUIRED
// master's empty stored reference still answers `422 MISSING_REQUIRED_FIELD`.
export const entry: SemanticMigration = {
  id: 'cbp-optional-master-admitted',
  surface: 'object.sharingModel = \'controlled_by_parent\' together with object.fields — a `master_detail` '
    + 'field declared `required: false` as the object\'s one master',
  replacement: 'Nothing to replace: a `controlled_by_parent` object may now declare its only `master_detail` '
    + 'field with `required: false`, an optional master. A detail row that names its master is read exactly as '
    + 'before, by whoever can read that master. A row whose master reference is empty is read by its owner '
    + '(`owner_id`) and by a holder of View All on the detail, and by nobody else: a row with no owner, or on '
    + 'an object that carries no `owner_id` column, is read through View All alone. Writes follow the same '
    + 'owner: an insert that names no master is admitted, and its creator owns the row; its owner and a '
    + 'holder of Modify All on the detail update or delete a row whose master reference is empty, and '
    + 'everyone else who reaches the write gate, View All included, is refused `403 PERMISSION_DENIED`; a '
    + 'row with no owner, or on an object that carries no `owner_id` column, is written through Modify All '
    + 'alone. An update that empties a named master asks edit access on the master it leaves. A required '
    + 'master is unchanged: a row whose stored required master reference is empty is still refused with '
    + '`422 MISSING_REQUIRED_FIELD`. Declare `required: true` when every row must name its master; an '
    + 'omitted `required` keeps meaning '
    + 'required through `ObjectSchema.create()` and on stored rows, and `os lint` reports it at `error` so the '
    + 'author writes one of the two.',
  reason:
    'The rule "a rep sees the contacts of the accounts they own; a contact need not have an account" had no '
    + 'declarative form: `controlled_by_parent` refused a `master_detail` that is not required at the builder '
    + 'and at the parse, a lookup derives no access, and the only route left was a copied owner field kept in '
    + 'step by hooks. The maintainer ruling (letter A) admits an optional master and gives a row without one '
    + 'to its owner, the Salesforce reading of a private contact. ADR-0055 §1 and §2 are amended in the same '
    + 'change. The read is one more arm inside the derived controlled-by-parent filter, OR-ed with the master '
    + 'arm and ANDed under the tenant wall like it, so every read door that composes that filter (the data '
    + 'middleware, the analytics read filter, the parent gates of attachments, comments, activity and '
    + 'approvals, delegated reads) follows it. A row that names a master is never read through the owner '
    + 'arm, and a row that names none never through a master. For an explicit `required: false` this entry '
    + 'supersedes what `cbp-master-relation-tiers-retired` and `cbp-master-detail-required-forced` say of it '
    + '(refused at the builder and at the parse, listed and denied at rest); everything else they say stands.',
  acceptanceCriteria:
    'An object declaring `sharingModel: \'controlled_by_parent\'` whose only `master_detail` field is '
    + 'declared `required: false` passes `ObjectSchema.safeParse` and `ObjectSchema.create()` with that value '
    + 'kept, and `os migrate meta --stored` no longer lists a stored row in that shape under '
    + '`cbp-master-relation-tiers-retired`. At runtime the security plugin resolves its master relation (no '
    + '"resolves no master relation" line), a member who can read a master reads that master\'s rows, the '
    + 'owner of a row with an empty master reads that row, a holder of View All on the object reads every '
    + 'row with an empty master, and nobody else reads one. An object whose `master_detail` omits `required` '
    + 'is still forced to `required: true` by the builder and converted to it on stored rows.',
};
