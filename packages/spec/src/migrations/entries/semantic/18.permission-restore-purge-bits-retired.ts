// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #12497 (ADR-0049, maintainer ruling accepting #1883's recommendation B) — the
// D3 entry of the `permission-allow-restore-purge-removed` family (ruling B on
// #17152: one D3 entry per retirement family, even when D2 is lossless). The
// family is the four registered keys: `allowRestore` / `allowPurge` on
// `security/ObjectPermission` and on `security/EffectiveObjectPermission`.
// The strip changes no access decision; what it leaves is a governance
// question, because the bits sat on the two most destructive verbs.
export const entry: SemanticMigration = {
  id: 'permission-restore-purge-bits-retired',
  surface: 'permission.objects.<object>.allowRestore / permission.objects.<object>.allowPurge — '
    + 'the object-permission bits for undelete and hard delete',
  replacement: '(removed — the `restore` and `purge` operations they claimed to gate do not '
    + 'exist.) A dispatched `restore` or `purge` is denied fail-closed by the permission '
    + 'evaluator\'s destructive-operation backstop for every principal. The bits return together '
    + 'with the operations they gate. `allowTransfer`, the third lifecycle bit, is enforced and '
    + 'stays.',
  reason: 'The D2 conversion `permission-allow-restore-purge-removed` deletes both keys from every '
    + 'object permission in author sources (both values, `true` included), and the delete is '
    + 'lossless: no destructive lifecycle verb is in the engine\'s dispatch vocabulary, so a grant '
    + 'delivered nothing and a denial locked nothing — every such request was, and stays, denied. '
    + 'The judgment is about what people believed. An admin who wrote `allowPurge: false` believed '
    + 'a lock existed; an admin who wrote `allowPurge: true` for a compliance role believed that '
    + 'role could hard-delete a record on request — a GDPR erasure, for instance. Neither was ever '
    + 'true. Any process, runbook or audit statement that relies on either belief needs another '
    + 'path, and deciding that path is a governance decision no conversion can make. Separately, '
    + 'an artifact built by the 17.x toolchain carries both keys materialized as the literal '
    + '`false`; that one value is tolerated at load as inert residue and stripped, and every '
    + 'other value — `true`, or a string or number spelling — is refused with the prescription.',
  acceptanceCriteria: 'No authored object permission carries `allowRestore` or `allowPurge`; the '
    + 'parse refuses any value but the tolerated `false` residue. Access decisions are unchanged: '
    + 'a request for `restore` or `purge` is denied for every principal before and after the '
    + 'upgrade, and `allowTransfer` behaves as before. Every documented process that assumed a '
    + 'restore or purge grant — an erasure-request runbook, an access review, an audit control — '
    + 'names the mechanism it actually uses instead.',
  relevantWhen: { kind: 'stack-declares', keys: ['permissions'] },
};
