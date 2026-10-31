// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The D3 entry for ADR-0142's reserved `queue` column (merge question 15). An
// object whose records have a user owner now carries a platform-injected
// `queue` column, and a declared field of that name is refused at
// registration. It narrows the field names such an object accepts; no key is
// removed, so there is no tombstone and no RETIRED_KEYS_BY_MAJOR row. There is
// no D2 conversion either: the new name of the business field, and the data
// move behind it, are the author's judgment.
export const entry: SemanticMigration = {
  id: 'object-queue-field-reserved',
  surface:
    'an object field named queue on an object whose records have a user owner (ownership user, the '
    + 'default). Reachable wherever an object is registered: defineStack({ objects }) sources, a '
    + 'package installed at boot, an object saved from Studio or the metadata API, and an object row '
    + 'already sitting in sys_metadata. An objectExtensions entry that declares queue on such an object is '
    + 'not refused, because an extension is folded over its object at read time in either registration '
    + 'order: its queue is ignored, the platform column stands, and a warning names the extension',
  replacement:
    'a business field under another name (for example `support_queue`), with its data copied across; '
    + 'or, when the object\'s records have no user owner, `ownership: \'business_unit\'`, `\'org\'` or '
    + '`\'none\'`, on which the platform injects no `queue` column',
  reason:
    'ADR-0142 adds the ownership queue: a record with no owner sits in the queue its `queue` column '
    + 'names, and the sitting-record access path, the claim, the release, the move and the assignment '
    + 'rules all read that column by name. The platform injects it on every object whose records have '
    + 'a user owner. The `owner_id` rule (a declared field wins over the injected one) is deliberately '
    + 'not copied: a business field under the same name would make every queue admission read the '
    + 'author\'s value, silently. So `registerObject` refuses the declaration with `422 '
    + 'INVALID_METADATA` (`ObjectQueueColumnRefusedError`), naming the object and the remedy. A body '
    + 'that carries the platform\'s own definition (a served document coming back) passes. An object '
    + 'with another ownership tier keeps any `queue` field it declares. No D2 conversion: the platform '
    + 'cannot choose the new name or move the rows. Ships at once, no grace window. ADR-0087, ADR-0142.',
  acceptanceCriteria:
    'Search every object your stacks declare, and every `objectExtensions` entry, for a field named '
    + '`queue` on an object with no `ownership` or `ownership: \'user\'`. Rename each one and copy its '
    + 'data to the new column. Two proofs. (1) Boot the stack and confirm each object REGISTERS: no '
    + '`ObjectQueueColumnRefusedError` for it, and no warning that an extension\'s `queue` is ignored. '
    + '(2) Read a record of each renamed object and confirm the business value is under the new name '
    + 'and its `queue` column is empty unless a queue holds it. An object without such a field '
    + 'registers byte-identically to before, apart from the injected column.',
};
