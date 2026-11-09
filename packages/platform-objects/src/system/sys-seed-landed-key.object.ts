// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_seed_landed_key — which declared seed rows have landed in an
 * organization, one row per seed key (#31021).
 *
 * A seed is replayed long after its first load: on every single-tenant boot,
 * and per organization whenever a host replays the seed union (a package
 * upgrade that changes it). The create-only rule (`SeedSchema.mode`'s
 * `ignore` default) inserts every declared row it does not find, so a row a
 * person deleted came back at the next replay under a new id. This table is
 * what tells "never landed here" from "landed here and since removed": the
 * seed loader records the key of every keyed row it lands — inserted, updated
 * or matched — under the organization it seeds, and does not insert a
 * recorded key again once its row is gone. A key never recorded still lands,
 * so a row an upgrade adds to the seed is inserted as before.
 *
 * Row identity: (organization_id, object_name, seed_key). `seed_key` is the
 * dataset's natural key — its `externalId` field names, each with the value
 * the loader matched the row by — JSON-encoded (`[["name","Acme"]]`), so a
 * composite key needs no separator byte and two datasets keyed on different
 * fields of one object never share a key. An `id` key is recorded under the
 * id the seed AUTHORED, not the per-organization id a replay may give the row
 * (#21665), so it reads the same in every organization.
 *
 * Writer and reader: `SeedLoaderService` (`@objectstack/metadata-protocol`)
 * alone, under the seed write context, on the loads that ask for this record
 * (`landedKeys`): the boot seed, the per-organization replay and the dev
 * hot-reload seeder of `@objectstack/runtime`'s AppPlugin. Internal state,
 * not a setting: ⛔ no data API, no settings key, no environment variable.
 *
 * Clearing it is never needed for a re-seed: the deliberate re-seed (the
 * `seed-replayer` service called with `{ reseed: true }`) inserts every
 * missing row whatever this table says and records them again, and a new
 * database starts with no rows. Deleting an organization deletes its rows.
 *
 * Lifecycle: **no `lifecycle` block on purpose** — durable. Reaping a row
 * would bring the seed row a person deleted back at the next replay.
 *
 * Registered by `PlatformObjectsPlugin` (`../plugin.ts`).
 *
 * @namespace sys
 */
export const SysSeedLandedKey = ObjectSchema.create({
  name: 'sys_seed_landed_key',
  label: 'Seed Landed Key',
  pluralLabel: 'Seed Landed Keys',
  icon: 'history',
  isSystem: true,
  managedBy: 'engine-owned',
  // Organization-owned: a key landed in one organization says nothing about
  // another. Who may read is object permission: the platform-only capability.
  requiredPermissions: ['manage_platform_settings'],
  description:
    'Which declared seed rows have landed in this organization, one row per seed key: a seed replay does not insert a recorded key again once its row is gone.',
  nameField: 'seed_key', // [ADR-0079] canonical primary-title pointer
  highlightFields: ['object_name', 'seed_key', 'created_at'],

  fields: {
    id: Field.text({
      label: 'ID',
      readonly: true,
    }),

    object_name: Field.text({
      label: 'Object',
      required: true,
      readonly: true,
      maxLength: 255,
      description: 'The seeded object the key belongs to.',
    }),

    seed_key: Field.textarea({
      label: 'Seed Key',
      required: true,
      readonly: true,
      description:
        'The seed row\'s natural key: its dataset\'s externalId field names with the values the row was matched by, JSON-encoded (`[["name","Acme"]]`).',
    }),

    organization_id: Field.lookup('sys_organization', {
      label: 'Organization',
      required: false,
      readonly: true,
      // The organization's delete takes its record with it.
      deleteBehavior: 'cascade',
      description: 'The organization the seed row landed in. Deleting the organization deletes its rows.',
    }),

    created_at: Field.datetime({
      label: 'Landed At',
      readonly: true,
      description: 'When the seed loader first recorded the key in this organization.',
    }),
  },

  indexes: [
    // The loader's one access path: the keys of one object in one organization.
    { fields: ['organization_id', 'object_name'], unique: false },
  ],

  enable: {
    trackHistory: false,
    searchable: false,
    // Internal state — no data API at all. The seed loader reads and writes
    // it in process, under the seed write context.
    apiEnabled: false,
    apiMethods: [],
  },
});
