// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The upgrade-guide entry of a seed record whose externalId value is blank,
// refused at load (maintainer ruling on #34857, option B1, extended to
// single-field keys on #35336). No conversion: only the author knows the value
// that names the row.
export const entry: SemanticMigration = {
  id: 'seed-key-blank-record-refused',
  surface:
    'data.Seed.records (a seed dataset in `defineStack({ data })`, `defineSeed`, a `seed` metadata item, or a package '
    + 'body\'s seed) loaded in a keyed mode (`ignore`, `upsert`, `update`): a record that leaves a field of the '
    + 'dataset\'s `externalId` blank (no value, null or an empty string), whether a component of a composite key or '
    + 'the one field of a single-field key (`name` when the dataset names none)',
  replacement:
    'Give the record a value for each `externalId` field, or key the dataset on fields every record carries: a field '
    + 'the object declares, a list of fields when no single field names a row, or `\'id\'` when the records carry their '
    + 'own ids',
  reason:
    'A seed is replayed on every single-tenant boot, every package install or upgrade and every publish, and each '
    + 'replay matches a record to the row an earlier load wrote by the dataset\'s `externalId`. A record with a blank '
    + 'key field keyed empty, matched no row, and was written again by every `ignore` or `upsert` load (an `update` '
    + 'load skipped it), with nothing said: three loads of one such record beside a keyed one left 2, then 3, then 4 '
    + 'rows. The seed load now refuses such a record before anything of it is written: the load result carries one '
    + 'error naming the object, the record index, the blank field and the fix, the boot log says it once per dataset, '
    + 'and every other record and dataset loads, so the environment still boots. The key is read as authored, after '
    + 'expressions resolve and before references do, so a reference the load cannot resolve yet is not blank. There '
    + 'is no mechanical rewrite: the value that names the row is the author\'s to give. Rows earlier loads duplicated '
    + 'are data, not metadata, and are left as they are',
  acceptanceCriteria:
    'Every seed record carries a value for each field of its dataset\'s `externalId`; after three restarts over the '
    + 'same database each seeded object holds one row per record, and neither the boot log nor the seed load result '
    + 'carries a blank-key seed refusal.',
};
