// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'cbp-master-detail-required-forced',
  surface: 'object.fields.<master>.required on a `master_detail` reference under '
    + '`sharingModel: \'controlled_by_parent\'` — authored via `ObjectSchema.create()`',
  replacement: '`required: true` on the master reference (or nothing at all — the builder now '
    + 'forces `required: true` when the key is omitted). An explicit `required: false` on that '
    + 'shape is refused at `ObjectSchema.create()` with a located error carrying this same '
    + 'prescription. The builder does not rewrite metadata at rest; a raw `.parse()`/`.safeParse()` of a '
    + '`controlled_by_parent` object whose only `master_detail` is not `required: true` is refused, and '
    + 'the security gate derives no master from it, by the later step-18 entry '
    + '`cbp-master-relation-tiers-retired`; the lint rule `relationship/master-detail-required` reports '
    + 'the shape at `error` under `cbp-master-detail-required-lint-error`',
  reason:
    'A `controlled_by_parent` detail derives ALL of its record access from the master that its '
    + '`master_detail` reference names (ADR-0055). With the reference not `required`, an insert '
    + 'may omit the master FK: the row lands with a null FK that the derived read filter '
    + '`masterFK IN (accessible master ids)` can never match — unreadable by everyone — and '
    + 'every later by-id write answers `422 MISSING_REQUIRED_FIELD`. The finding behind the '
    + 'ruling measured that only '
    + 'the security gate closed this shape while the declaration surface still accepted it. '
    + 'The maintainer ruling (2026-08-16, Direction 2) makes the unsafe shape impossible to '
    + 'NEWLY declare at the builder; whether to keep `required: false` was never a real choice '
    + '(the value contradicts the sharing model), so the flip is forced rather than convertible '
    + '— and an explicitly authored `false` is refused rather than silently rewritten '
    + '(ADR-0032 "no silent failure").',
  acceptanceCriteria:
    'Every `ObjectSchema.create()` call declaring `sharingModel: \'controlled_by_parent\'` '
    + 'either omits `required` on its `master_detail` reference(s) (now emitted as '
    + '`required: true`) or declares `required: true` explicitly; the authored app builds and '
    + 'boots. An explicit `required: false` there fails the build with '
    + '`ObjectSchema.create(...): field ... declares required: false on a master_detail '
    + 'reference under sharingModel: controlled_by_parent`. Stored metadata is not rewritten by '
    + 'the builder (`required` stays as stored); what a raw parse does with it is '
    + '`cbp-master-relation-tiers-retired`\'s acceptance criterion.',
};
