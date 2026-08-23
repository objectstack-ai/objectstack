// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'field-master-detail-set-null-refused',
  surface: "object field `deleteBehavior: 'set_null'` authored on a `master_detail` field",
  replacement: "an explicit `deleteBehavior: 'restrict'` or `'cascade'` (or no declaration, "
    + 'which is the cascade default) — re-declared deliberately, because only the author knows '
    + "which they meant. There is deliberately NO automatic conversion: `'set_null'` here asked "
    + 'for the child rows to be KEPT, and both mechanical rewrites betray that intent in a '
    + "different direction — stripping the key silently ratifies the cascade the author did not "
    + "ask for (the same collapse of intent that produced the defect), while `'restrict'` is the "
    + 'only rewrite that cannot lose data (the parent delete is refused while children exist — '
    + 'the closest honest reading of "keep my children") but turns a delete that silently '
    + 'succeeded into a loud refusal. If the children genuinely must survive the parent, the '
    + 'field wants to be a `lookup`, not a `master_detail`',
  reason:
    "`FieldSchema` accepted `deleteBehavior: 'set_null'` on a `master_detail` while the engine's "
    + '`cascadeDeleteRelations` resolves every value except `restrict` on that type to `cascade` '
    + '— so the declaration asked for the children to be kept and the engine DELETED them, '
    + 'silently, at the moment the parent went away: data loss relative to the declared intent, '
    + 'the ADR-0049 declared-but-unenforced shape on a delete path. Honoring the value is ruled '
    + 'out (maintainer, 2026-08-19): a detail row whose master reference is nulled becomes an '
    + 'unreachable orphan, which is precisely what the orphan-detail work exists to prevent. The '
    + 'schema now refuses the authored combination at parse time (declared = enforced), and the '
    + 'engine logs loudly if a raw registration or a pre-tightening stored row still carries it '
    + 'to the coercion site. A BARE `master_detail` is untouched: the default still materializes '
    + "as `'set_null'` in parse output (byte-identical to before) and still resolves to cascade.",
  acceptanceCriteria:
    "No `master_detail` field declares `deleteBehavior: 'set_null'`. Bare `master_detail` "
    + 'declarations, authored `cascade`/`restrict`, and `set_null` on `lookup` parse '
    + 'byte-identically to before. Stored `sys_metadata` rows carrying the refused combination '
    + 'keep loading and serving (registry validation is a diagnostic, not a gate) but flag '
    + '`metadata_spec_invalid` and are refused on their next authoring-path save — re-declare '
    + 'the field deliberately when that happens.',
};
