// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// ADR-0055 §1 enforced (maintainer ruling B): a `controlled_by_parent` object
// derives its master from exactly one required `master_detail`. The runtime's two
// unrecorded fallbacks retire under ADR-0049, and no D2 conversion exists — a
// `lookup` turned `master_detail` changes delete behaviour, and leaving
// `controlled_by_parent` is an author's call — so this entry is the whole record.
export const entry: SemanticMigration = {
  id: 'cbp-master-relation-tiers-retired',
  surface: 'object.sharingModel = \'controlled_by_parent\' together with object.fields — the master '
    + 'relation the object derives its record access from',
  replacement: 'Exactly one `master_detail` field declared `required: true`, with a `reference` to the master '
    + 'object; every other parent of the object is a `lookup`. Nothing else derives a master any more: a '
    + '`master_detail` without `required: true` and a required `lookup` were the security runtime\'s second '
    + 'and third fallbacks and both retired, and two required `master_detail` fields are no longer resolved '
    + 'by field order. `ObjectSchema` refuses each of those shapes at parse, naming the object — so '
    + '`ObjectSchema.create()`, `defineStack`, `os validate` and the metadata save door refuse them — and '
    + 'the runtime derives no master from them: every read of such an object is denied and every write '
    + 'refused with 422 INVALID_METADATA. A required `lookup` to the master becomes `type: \'master_detail\'` '
    + '(its rows are then deleted with their master; declare `deleteBehavior: \'restrict\'` to refuse deleting '
    + 'a master that still has rows instead). An object whose rows must outlive their parent leaves '
    + '`controlled_by_parent` for its own sharing model (`private`, `public_read` or `public_read_write`).',
  reason:
    'ADR-0055 §1 states that a `controlled_by_parent` object must declare exactly one required '
    + '`master_detail` field and that anything else is a validation error, failing closed. Neither the parse '
    + 'nor the runtime kept it: the parse accepted the object with no master at all, and the runtime derived '
    + 'a master through a three-tier fallback the record never stated — a required `master_detail`, then any '
    + '`master_detail`, then a required `lookup`, the first match by field order within a tier. So an author '
    + 'reading the record believed such an object was refused while it booted and derived its access from '
    + 'whatever the fallback picked, and the platform\'s own derived proof (the parent-derived write reach '
    + 'family) disagreed with its runtime about which objects the rule covers. The maintainer ruling (letter '
    + 'B) enforces the record: one tier, refused at parse, retired in the runtime. No conversion is offered '
    + 'because none is lossless — turning a `lookup` into a `master_detail` changes what deleting the master '
    + 'does to every row, and whether an object should instead stop being controlled by its parent is a '
    + 'product decision only its author can make.',
  acceptanceCriteria:
    'Every object declaring `sharingModel: \'controlled_by_parent\'` declares exactly one `master_detail` '
    + 'field with `required: true` (through `ObjectSchema.create()`, an omitted `required` on its one '
    + '`master_detail` is emitted as `true`), and `ObjectSchema.safeParse` of it succeeds: no '
    + '"declares sharingModel \'controlled_by_parent\' but no required `master_detail` field" or '
    + '"with N required `master_detail` fields" issue. `os lint` reports neither '
    + '`security-controlled-by-parent-no-relation` nor `security-controlled-by-parent-ambiguous-relation`. At '
    + 'runtime the security plugin logs no `[security/controlled-by-parent]` "resolves no master relation" '
    + 'line for the object, and a member who can read its master reads its rows. Stored metadata is not '
    + 'rewritten: a stored row in a retired shape still registers (with its `[metadata_spec_invalid]` '
    + 'diagnostic) and is denied until it is corrected and saved.',
};
