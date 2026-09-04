// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'autonumber-default-unique-organization',
  surface: '`fields.<name>.unique` on a `type: \'autonumber\'` field when the author OMITS the key — '
    + 'the contract default moves from `false` (no index) to `\'organization\'` (one holder per '
    + 'organization; the NULL-safe tenant-composite unique index '
    + '`(COALESCE(organization_id, \'__global__\'), <field>)` on an organization-scoped object, a '
    + 'plain unique index where the object has no organization key)',
  replacement: 'keep the omission to take the default — an auto-number is a business identifier and '
    + 'is unique per organization from now on with zero application-side declaration; write '
    + '`unique: false` EXPLICITLY on the one autonumber field that is a display-only sequence and '
    + 'is never used to identify the record. Every other field type keeps `unique: false` as its '
    + 'default, and every authored spelling (`true` / `\'organization\'` / `\'global\'` / `false`) '
    + 'parses exactly as before',
  reason:
    'Not losslessly convertible because the change is data-dependent, not textual: a table that '
    + 'already holds duplicate auto-numbers (a counter that re-issued a burned number, or the '
    + 'seed/API tenancy split running two counters for one object) cannot take the index the '
    + 'default now declares. The SQL driver refuses to silently degrade — it logs at `error` '
    + 'naming the index, the columns and the remedy, the same boot\'s drift pass names the '
    + 'conflicting key groups with row counts, and `os migrate plan` reports the blocked '
    + '`create_index` with the same groups (ADR-0120 D4) — but which of the duplicate rows keeps '
    + 'the number is a business decision no migration entry can make. Maintainer ruling '
    + '2026-08-31 (hotcrm#1301): an auto-number that may repeat is not an identifier, so unique '
    + 'is the platform default and opting out is the declaration, not the other way round '
    + '(#13894).',
  acceptanceCriteria:
    'Every `autonumber` field without an authored `unique` parses to `unique: \'organization\'` '
    + '(`FieldSchema.parse({ type: \'autonumber\' }).unique === \'organization\'`, and through '
    + '`ObjectSchema` the same); an authored `unique: false` on an autonumber field parses to '
    + '`false`; every non-autonumber field type without an authored `unique` still parses to '
    + '`false` at the same key position. On a serving boot, each organization-scoped object with '
    + 'such a field carries `uniq_<object>_organization_id_<field>`; a table whose data blocks it '
    + 'shows the blocked `create_index` with its conflicting groups in `os migrate plan` until '
    + 'the rows are deduplicated and the plan is re-run, and `os migrate duplicates` lists the '
    + 'holder rows of any value minted across organization partitions.',
};
