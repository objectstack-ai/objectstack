// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'ups-delegated-from-column-retired',
  // No backticks in `surface` — build-upgrade-guide.ts renders it inside a
  // code span AND a table cell.
  surface:
    'sys_user_permission_set.delegated_from — the ADR-0091 D3 provenance column left the '
    + 'platform grant table declared by plugin-security (packages/plugins/plugin-security/'
    + 'src/objects/sys-user-permission-set.object.ts). The sibling declaration on '
    + 'sys_user_position is untouched',
  replacement:
    'nothing on this table — delete the key from any authored `sys_user_permission_set` '
    + 'seed row (stack `data` entries) or data-door write that still carries it. '
    + 'Delegation semantics live on `sys_user_position`, where `delegated_from` remains '
    + 'declared AND runtime-enforced: the delegated-admin gate is what makes a position '
    + 'insert a delegation, and the explain engine attributes "via delegation from X, '
    + 'until Y". A permission-set grant that needs a provenance note keeps `reason` '
    + '(free text), which remains declared on both grant tables',
  reason:
    'Maintainer ruling 2026-08-18 (#9730), ADR-0049 enforce-or-remove: REMOVE. The '
    + 'runtime delegation gate is structurally scoped to sys_user_position '
    + '(`isDelegationWrite` returns false for every other object, so '
    + '`assertSelfDelegation` is unreachable for this table), and the explain engine '
    + 'reads delegation provenance from sys_user_position rows only. On '
    + 'sys_user_permission_set the column was therefore declared and data-door-writable '
    + 'while NO runtime consumer read it — its only enforcement was an authoring-time '
    + 'lint (the D3 "delegation row needs a reason" rule), which a row written through '
    + 'the generic data door never meets. That is declared-but-unenforced in its pure '
    + 'form, on a security object: an author who stamped delegated_from on a '
    + 'permission-set grant believed they constrained delegation, and nothing refused or '
    + 'honoured it. Producers measured at zero — the only object literals naming both '
    + 'the table and the column were lint test fixtures. '
    + 'This is a platform-object COLUMN retirement, not a spec-key retirement, so the '
    + 'bookkeeping follows the audit-log-action-enum-retired shape: nothing lands in '
    + 'RETIRED_KEYS_BY_MAJOR (no authorable spec KEY changed — the surface ratchets are '
    + 'expected byte-identical), and the disposition is a SEMANTIC entry rather than a '
    + 'D2 conversion. A conversion over stack `data` seed records would be mechanically '
    + 'expressible, but no conversion in the chain rewrites seed rows today and the '
    + 'measured author base is zero; the loud channel already exists at runtime — the '
    + 'engine schema preflight refuses an undeclared field with 400 INVALID_FIELD '
    + 'before the driver or any hook runs — so this entry carries the prescription and '
    + 'the refusal carries the enforcement. '
    + '⚠️ Existing physical columns are deliberately untouched: schema sync is additive '
    + '(ADR-0045), so a deployed database keeps the column; the platform stops '
    + 'declaring, projecting or accepting it. Zero producers means no rows are expected '
    + 'to carry a value; no backfill or destructive DDL is required or wanted. '
    + 'If delegation at permission-set granularity ever becomes a real need, the column '
    + 'is re-declared then, WITH a runtime reader in the same PR — declare-and-enforce '
    + 'or do not declare.',
  acceptanceCriteria:
    'No authored stack seeds `delegated_from` on a sys_user_permission_set record, and '
    + 'no client write to that table carries the key. Concretely: (1) grep your stack '
    + 'sources for delegated_from next to sys_user_permission_set — delete the key from '
    + 'any seed row; a row that was recording genuine hand-over provenance should say it '
    + 'in `reason` instead, which the platform stores on both grant tables. (2) Boot and '
    + 'load your stack: a missed seed row fails loudly at insert with 400 INVALID_FIELD '
    + 'naming the column — that refusal is the enforced channel, not a silent drop. '
    + '(3) If you meant actual delegation-of-duty, author it where it is enforced: a '
    + 'sys_user_position insert with delegated_from = the writer, a mandatory future '
    + 'valid_until within the ceiling, and a mandatory reason (ADR-0091 D3) — the '
    + 'delegated-admin gate then validates the whole shape at runtime.',
};
