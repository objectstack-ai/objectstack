// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// ADR-0055 §1 enforced (maintainer ruling B): a `controlled_by_parent` object
// derives its master from exactly one required `master_detail`. The runtime's two
// unrecorded fallbacks retire under ADR-0049. One shape converts losslessly at
// rest: an omitted `required` on the object's one `master_detail`, which gets the
// builder's own `true`. That is the D2 conversion `cbp-master-detail-required-defaulted`,
// and objectui's Studio is its producer. Every other shape is this entry's
// prescription: a `lookup` turned `master_detail` changes delete behaviour, and
// leaving `controlled_by_parent` is an author's call. The one master is also
// writable (#25092, ruling 6328204856 route A): `readonly` / `system` on it are
// refused by the same parse rule, not converted, and the runtime is unchanged.
export const entry: SemanticMigration = {
  id: 'cbp-master-relation-tiers-retired',
  surface: 'object.sharingModel = \'controlled_by_parent\' together with object.fields — the master '
    + 'relation the object derives its record access from',
  replacement: 'Exactly one `master_detail` field declared `required: true`, with a `reference` to the master '
    + 'object and neither `readonly: true` nor `system: true` on it; every other parent of the object is a '
    + '`lookup`. Nothing else derives a master any more: a '
    + '`master_detail` without `required: true` and a required `lookup` were the security runtime\'s second '
    + 'and third fallbacks and both retired, and two required `master_detail` fields are no longer resolved '
    + 'by field order. `ObjectSchema` refuses each of those shapes at parse, naming the object — so '
    + '`ObjectSchema.create()`, `defineStack`, `os validate` and the metadata save door refuse them — and '
    + 'the runtime derives no master from them: every read of such an object is denied and every write '
    + 'refused with 422 INVALID_METADATA. A one master marked `readonly` or `system` is refused at parse too, '
    + 'by the same doors, naming the field and the flag; the runtime still resolves that field as the master, '
    + 'so the object is not denied, and the fix is to drop the flag and declare the master reference as an '
    + 'ordinary required field. Data at rest whose one `master_detail` merely omits `required` '
    + 'is converted, not refused: the D2 conversion `cbp-master-detail-required-defaulted` gives it the '
    + '`required: true` that `ObjectSchema.create()` would have given it. It runs on stored rows, built '
    + 'artifacts and `os migrate meta`, never on a live authoring parse. A required `lookup` to the master becomes `type: \'master_detail\'` '
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
    + 'B) enforces the record: one tier, refused at parse, retired in the runtime. Exactly one shape converts '
    + 'losslessly: an OMITTED `required` on the object\'s one `master_detail` is the builder\'s own force. '
    + 'It was measured to have a producer (objectui\'s Studio adds a field as `{ type, label }`, its Required '
    + 'toggle writes `true` or nothing, and its Settings tab offers `controlled_by_parent`), so D2 carries '
    + 'it for data at rest. Nothing else converts. An explicit `required: false` is a contradiction the '
    + 'builder refuses. Two masters would need a pick. Turning a `lookup` into a `master_detail` changes '
    + 'what deleting the master does to every row, and whether an object should instead stop being '
    + 'controlled by its parent is a product decision only its author can make. The same rule refuses a one '
    + 'master marked `readonly: true` or `system: true`: ADR-0055 §1 derives the '
    + 'master from a reference every write of a detail supplies, a field carrying either flag is not one an '
    + 'author\'s write supplies, and `os lint` alone reported them, so `os validate`, `os build` and the save '
    + 'door accepted a master that could not be the one master. It is not converted: dropping the flag changes who may '
    + 'write the reference.',
  acceptanceCriteria:
    'Every object declaring `sharingModel: \'controlled_by_parent\'` declares exactly one `master_detail` '
    + 'field with `required: true` (through `ObjectSchema.create()`, an omitted `required` on its one '
    + '`master_detail` is emitted as `true`), and `ObjectSchema.safeParse` of it succeeds: no '
    + '"declares sharingModel \'controlled_by_parent\' but no required `master_detail` field", '
    + '"with N required `master_detail` fields" or "with its one required `master_detail`, … marked" issue. `os lint` reports neither '
    + '`security-controlled-by-parent-no-relation` nor `security-controlled-by-parent-ambiguous-relation`. At '
    + 'runtime the security plugin logs no `[security/controlled-by-parent]` "resolves no master relation" '
    + 'line for the object, and a member who can read its master reads its rows. A stored row whose one '
    + '`master_detail` omitted `required` is served with `required: true` (`cbp-master-detail-required-defaulted`); '
    + 'a stored row in any other retired shape (two masters, none, a required `lookup` only, an explicit '
    + '`required: false`) still registers (with its `[metadata_spec_invalid]` diagnostic) and is denied until '
    + 'it is corrected and saved. A stored row whose one required `master_detail` is marked `readonly` or '
    + '`system` also registers under that diagnostic, and the runtime still resolves its master, so it is not '
    + 'denied; the metadata save door refuses it with 422 INVALID_METADATA until it is corrected. '
    + '`os migrate meta --stored` lists each such '
    + 'row as a TODO under this entry\'s id, before the upgrade and after it, naming the object, its shape (two '
    + 'masters, none, a required `lookup` only, an explicit `required: false`, a master marked `readonly` or '
    + '`system`) and the owner\'s choice, and '
    + 'rewrites none of them.',
};
