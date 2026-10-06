// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// A value a flow reads, not an authorable key: there is no D2 conversion and
// nothing for `objectstack migrate meta` to rewrite. The sibling of
// `18.by-id-write-unreadable-row-not-found` in kind — the entry carries the
// changed answer to the one reader the ledger serves here, the upgrade guide,
// because a flow that read a credential off its trigger record has no schema
// error to find it by. No backticks in `surface`: the upgrade guide renders it
// inside a code span and a table cell.
export const entry: SemanticMigration = {
  id: 'flow-trigger-record-credential-masked',
  surface:
    'the record and previous roots a record-change flow receives — a password or secret field, '
    + 'and an internal field, of the triggering record, on every object',
  replacement:
    'read a credential through a privileged binder — the flow credential channel for an http node\'s '
    + 'signing secret, or a privileged server-side read such as the engine\'s resolveSecretField — '
    + 'never off `record` or `previous`; on those roots '
    + 'a set credential-class field now reads as the mask `SECRET_MASK`, an unset one as null, and an '
    + '`internal: true` field is absent',
  reason:
    'ADR-0100: a credential-class value leaves the engine only through a privileged dereference, and '
    + 'every generic channel serves the mask. The record-change trigger built a flow\'s record and '
    + 'previous from the engine\'s own write result, which keeps the stored row whole for privileged '
    + 'in-process callers, so a password field\'s plaintext, a secret field\'s stored handle and an '
    + 'internal field\'s value reached the flow — and from there its variables, a paused run\'s '
    + 'persisted state and that state\'s read doors. The trigger now projects both roots through the '
    + 'same helper every external write response uses: a credential-class field (secret, and '
    + 'password outside the exempt managedBy buckets) carries the mask, or null when unset, and an '
    + 'internal field is omitted. Every other field keeps its value, every other variable is '
    + 'untouched, and the engine\'s own write result, the stored row and the privileged read paths '
    + 'are unchanged.',
  acceptanceCriteria:
    'No flow reads a password, secret or internal field off its trigger record or previous values '
    + 'expecting the stored value; a flow that needs a credential obtains it through a privileged '
    + 'binder; a start or edge condition that compared such a field against a literal is rewritten to '
    + 'test whether it is set (not null).',
};
