// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'position-permissions-column-retired',
  // No backticks in `surface` — build-upgrade-guide.ts renders it inside a
  // code span AND a table cell.
  surface:
    'sys_position.permissions — the "JSON-serialized array of permission strings" '
    + 'textarea column left the platform position table declared by plugin-security '
    + '(packages/plugins/plugin-security/src/objects/sys-position.object.ts), together '
    + 'with the clone_position copy entry that carried it between rows',
  replacement:
    'nothing on this table — delete the key from any authored `sys_position` seed row '
    + '(stack `data` entries) or data-door write that still carries it. There are no '
    + 'direct position-level permission strings anywhere on the platform: capability '
    + 'reaches a position ONLY through permission-set bindings '
    + '(`sys_position_permission_set` rows, created in Setup or by an app\'s '
    + 'kernel:ready binder) and is resolved from the position `name` at request time. '
    + 'A value that was recording intent as documentation belongs in `description`, '
    + 'which remains declared',
  reason:
    'Maintainer ruling 2026-08-20 (#9885), ADR-0049 enforce-or-remove: REMOVE. The '
    + 'object-scoped census (all sys_position-naming files, with same-object positive '
    + 'controls resolving `active` / `delegatable` / `is_default` / `name` to real '
    + 'readers) measured the column at zero on both sides: the only row writers — the '
    + 'builtin and declared position bootstrappers — set label / description / '
    + 'managed_by / active / is_default, and position→grant resolution consults '
    + '`sys_position_permission_set` rows plus the position `name`, never this column. '
    + 'Its only in-repo reference was the clone_position action copying it between '
    + 'rows — a copy of a value nothing writes. objectui was searched under the same '
    + 'discipline (evidenceScope closure): no console surface names the column — the '
    + 'position pickers and Setup views read name / label / id only, so a designer '
    + 'preview consumer does not exist either. That left a declared free-text grant '
    + 'catalogue on a security object that no runtime enforced: an author — human or '
    + 'AI — who filled it believed they granted permission strings directly on the '
    + 'position, and nothing refused or honoured the value. '
    + 'This is a platform-object COLUMN retirement, not a spec-key retirement, so the '
    + 'bookkeeping follows the ups-delegated-from-column-retired shape: nothing lands '
    + 'in RETIRED_KEYS_BY_MAJOR (no authorable spec KEY changed — PositionSchema never '
    + 'declared `permissions`, and the surface ratchets are expected byte-identical), '
    + 'no liveness-ledger row is added (the ledger walks PositionSchema\'s shape, '
    + 'which never carried the key — a row would be an orphan), and the disposition '
    + 'is a SEMANTIC entry rather than a D2 conversion: no conversion in the chain '
    + 'rewrites seed rows today and the measured author base is zero, while the loud '
    + 'channel already exists at runtime — the engine schema preflight refuses an '
    + 'undeclared field with 400 INVALID_FIELD before the driver or any hook runs — '
    + 'so this entry carries the prescription and the refusal carries the '
    + 'enforcement. The live-authoring half is the PositionSchema strict-parse '
    + 'guidance for `permissions`, which names the binding table in the rejection. '
    + '⚠️ Existing physical columns are deliberately untouched: schema sync is '
    + 'additive (ADR-0045), so a deployed database keeps the column; the platform '
    + 'stops declaring, projecting or accepting it. Zero producers means no rows are '
    + 'expected to carry a value; no backfill or destructive DDL is required or '
    + 'wanted. If position-level direct grants ever become a real need, the column is '
    + 're-declared then, WITH a runtime reader in the same PR — declare-and-enforce '
    + 'or do not declare.',
  acceptanceCriteria:
    'No authored stack seeds `permissions` on a sys_position record, and no client '
    + 'write to that table carries the key. Concretely: (1) grep your stack sources '
    + 'for permissions next to sys_position — delete the key from any seed row; prose '
    + 'that was documenting intent belongs in `description`. (2) Boot and load your '
    + 'stack: a missed seed row fails loudly at insert with 400 INVALID_FIELD naming '
    + 'the column — that refusal is the enforced channel, not a silent drop. (3) If '
    + 'you meant to grant capability, author it where it is enforced: bind permission '
    + 'sets to the position (`sys_position_permission_set` rows, created in Setup or '
    + 'by an app\'s kernel:ready binder) — the authz resolver then expands the '
    + 'bindings from the position name at request time.',
};
