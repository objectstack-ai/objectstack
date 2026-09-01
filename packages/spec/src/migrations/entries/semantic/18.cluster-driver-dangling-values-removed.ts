// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'cluster-driver-dangling-values-removed',
  surface: 'kernel.cluster.driver (ClusterDriverSchema, kernel/cluster.zod.ts) '
    + '- the `postgres` and `nats` enum values',
  replacement: 'the drivers that actually ship - `memory` (single-process '
    + 'default), `redis` (@objectstack/service-cluster-redis, the production '
    + 'recommendation), or `custom` + registerClusterDriver(name, factory) for '
    + 'a self-provided transport. A config naming `postgres` or `nats` never '
    + 'worked: pick `redis`, or register the transport yourself under `custom`',
  reason:
    'Maintainer ruling on objectstack-ai/cloud#1626 (2026-08-24, option B '
    + 'adopted): single-node is the ObjectOS EE boundary, multi-node is Cloud '
    + 'differentiation, and a DB-first postgres cluster driver is not built '
    + 'absent concrete customer pull. The ruling\'s principle rider decides '
    + 'this entry: a schema-valid value must not be an unconditional runtime '
    + 'throw. Both removed values were dangling by the same measurement - the '
    + 'only non-test registerClusterDriver() caller is service-cluster-redis, '
    + 'so `driver: \'postgres\'` or `driver: \'nats\'` passed schema '
    + 'validation and then reached defineCluster()\'s unconditional `Cluster '
    + 'driver "<name>" is not registered` throw. It is a SEMANTIC entry '
    + 'rather than a mechanical conversion because the right replacement is a '
    + 'deployment decision (which transport actually backs this cluster), not '
    + 'a rename a codemod could apply; nothing at rest breaks, because a '
    + 'stored config naming either value never survived boot in the first '
    + 'place. The ruling records its own reversal condition: a value returns '
    + 'to the enum only in the release that ships an implementation behind '
    + 'it. No authorable KEY was retired (the `useExistingPool` field stays, '
    + 'reworded), so nothing lands in RETIRED_KEYS_BY_MAJOR.',
  acceptanceCriteria:
    'No `cluster.driver` config names `postgres` or `nats`; '
    + '`ClusterDriverSchema.parse` on the chosen driver value succeeds; a '
    + 'deployment that needed a distributed transport boots on `redis` (or '
    + 'its `custom` registration) and `defineCluster()` no longer throws '
    + '`Cluster driver "<name>" is not registered` at startup. TypeScript '
    + 'call sites that typed the removed spellings against `ClusterDriver` '
    + 'fail tsc on upgrade; the fix is choosing a shipped driver, never '
    + 'widening a local mirror of the enum.',
};
