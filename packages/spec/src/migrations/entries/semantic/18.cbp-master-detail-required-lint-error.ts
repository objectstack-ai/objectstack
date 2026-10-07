// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'cbp-master-detail-required-lint-error',
  surface: 'object.fields.MASTER.required / .readonly / .system, where MASTER is a '
    + '`master_detail` reference on an object declaring `sharingModel: \'controlled_by_parent\'` '
    + '— as judged by `os lint` under `relationship/master-detail-required`',
  replacement: '`required: true` on every `master_detail` reference of a `controlled_by_parent` '
    + 'object, with neither `readonly: true` nor `system: true` on it: declare the master '
    + 'reference as an ordinary required field. `os lint` now reports each of the three unsafe '
    + 'shapes there — `required` absent or `false`; `required: true` + `readonly: true`; '
    + '`required: true` + `system: true` — at `error` under `relationship/master-detail-required`, '
    + 'so `os lint` exits non-zero and the metadata-generation rubric marks the stack invalid. On '
    + 'every other object the rule is unchanged: a `warning` for a `master_detail` without '
    + '`required: true`, and no finding for the two flagged shapes.',
  reason:
    'A `controlled_by_parent` detail derives ALL of its record access from the master that its '
    + '`master_detail` reference names (ADR-0055). Record validation never checks a field that is '
    + 'not `required`, and skips `readonly` and `system` fields before its required check is '
    + 'reached, so on these three shapes nothing but the security gate refuses an insert that '
    + 'omits the master FK. A record that lands without it anyway is readable by nobody — the '
    + 'derived read filter `masterFK IN (accessible master ids)` never matches null — and every '
    + 'later by-id write is refused. Before this step the lint predicate was `required !== true` '
    + 'at `warning` on every object: the two flagged shapes drew no finding at any severity, and '
    + 'the third drew a warning that an author or a generator could ignore. The maintainer ruling '
    + 'of 2026-08-16 (Direction 1) scheduled the promotion for the v18 boundary as a deliberate '
    + 'narrowing of the authoring contract. Its builder half (the '
    + '`cbp-master-detail-required-forced` entry) forces `required: true` at '
    + '`ObjectSchema.create` but never inspects `readonly` or `system`, so two of the three shapes '
    + 'still pass the builder and meet their first authoring-time refusal here, and the third '
    + 'still reaches it from any object not authored through the builder. Runtime tolerance is '
    + 'unchanged on purpose: the security gate keeps refusing these inserts, and keeps resolving '
    + 'the master for metadata already at rest.',
  acceptanceCriteria:
    '`os lint` reports no `relationship/master-detail-required` finding at `error`: on every '
    + 'object declaring `sharingModel: \'controlled_by_parent\'`, each `master_detail` reference '
    + 'declares `required: true` (or omits it and is authored through `ObjectSchema.create`, '
    + 'which emits `required: true`) and carries neither `readonly: true` nor `system: true`. '
    + '⚠️ WHICH DOOR: the refusal is `os lint`\'s and the metadata-generation rubric\'s only. The '
    + 'rule is not in the authoring-rule registry, so `os build`, `os validate` and the metadata '
    + 'save door do not run it, and a stack carrying the shape still builds and publishes — read '
    + '`os lint`\'s exit code, not a green build. Stored metadata is not rewritten and keeps '
    + 'loading, and the security gate still refuses an insert that omits the master FK on these '
    + 'shapes. Repo census at the time of the change: 129 authored objects across the example '
    + 'apps, the platform and plugin objects and the CLI\'s golden eval corpus, 7 of them '
    + '`controlled_by_parent`, 0 findings at `error`.',
};
