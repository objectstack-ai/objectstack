// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// A narrowing of two runtime doors, not of any key: a manual record share
// (POST /api/v1/data/OBJECT/ID/shares, the in-process SharingService.grant
// under a non-system context) and an organization's sharing rule
// (POST /api/v1/sharing/rules, SharingRuleService.defineRule under a
// non-system context) whose `user` recipient names no user the read and write
// gates could ever match are refused 400 VALIDATION_FAILED, where they were
// accepted and stored a row that looks granted and enforces nothing. No key
// is added, removed or re-shaped and no stored row changes, so no tombstone
// and no D2 conversion: which user a stored inert share or rule was meant for
// is the author's judgement. No relevance question: both doors take
// runtime writes, which no question over one stack can name.
export const entry: SemanticMigration = {
  id: 'share-user-recipient-unresolved-refused',
  surface:
    'A manual record share (POST /api/v1/data/OBJECT/ID/shares and the in-process SharingService.grant under a '
    + 'non-system context) and a sharing rule saved by an organization (POST /api/v1/sharing/rules and '
    + 'SharingRuleService.defineRule under a non-system context) whose recipientType is user, when recipientId '
    + 'names no existing sys_user or, on a deployment walled by organization (tenancy posture isolated or group) '
    + 'with the record or rule organization known, no member of that organization. A rule upsert that keeps its '
    + 'stored user recipient is not judged',
  replacement:
    'Send the id of an existing user, on a multi-organization deployment a member of the organization the record '
    + 'or the rule belongs to (GET /api/v1/data/sys_user lists the users a caller may read). The write then '
    + 'stores the share or the rule as before. To reach a set of people rather than one user, author a sharing '
    + 'rule with a team, position, business unit, queue or field recipient.',
  reason:
    'The read and write gates look a share up by recipient_id equal to the signed-in user id, so a share or a '
    + 'rule naming an id no user carries granted no one anything while it was listed by GET .../shares and by '
    + 'the rule list exactly like a working grant: the class the access-level refusal and ADR-0111 D7 closed '
    + 'for typed levels and non-user recipient types. Behind an organization wall the record admits only that '
    + 'organization, so a user of another organization is as inert as an id that does not exist, and is refused '
    + 'with the same sentence, so the door tells no caller who exists in another tenant. Shares and rules '
    + 'already stored are not rewritten or removed: there is no mechanical answer to which user an inert row '
    + 'was meant for, and the platform\'s own rule-materialised grants are not judged here.',
  acceptanceCriteria:
    'POST /api/v1/data/OBJECT/ID/shares with recipientType user and a recipientId no user carries answers 400 '
    + 'VALIDATION_FAILED naming the recipientId, and GET /api/v1/data/OBJECT/ID/shares lists no new row; the same '
    + 'call naming a user of another organization on a walled deployment answers the same status, code and '
    + 'sentence; the same call naming an existing user (a member of the record organization when walled) answers '
    + '201 and the row is listed. POST /api/v1/sharing/rules with a user recipient that does not resolve answers '
    + '400 VALIDATION_FAILED and stores no rule; saving a stored rule again with its recipient unchanged '
    + '(for example to set active false) succeeds as before. To find inert rows stored before this change, list '
    + 'sys_record_share rows with source manual and recipient_type user whose recipient_id matches no sys_user id, '
    + 'and re-grant or revoke each.',
};
