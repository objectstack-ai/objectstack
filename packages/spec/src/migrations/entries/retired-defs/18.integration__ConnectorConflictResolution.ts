// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// `integration/ConnectorConflictResolution` (`source_wins` / `target_wins` /
// `latest_wins` / `manual`) was the value vocabulary of
// `syncConfig.conflictResolution` alone, and leaves with it. Its default,
// `latest_wins`, read as a configured policy and resolved nothing; the pull
// binding that replaces the family claims no conflict policy (version 1 writes
// through the mapping's `mode` / `upsertKey`). See
// `retired-keys/18.integration__Connector__syncConfig.ts`.
export const entry = 'integration/ConnectorConflictResolution';
