// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #8057 — the deprecated legacy update-options schema re-declared the
// never-implemented `upsert` flag, so it is tombstoned with the SAME
// prescription as `data/EngineUpdateOptions:upsert` (one string, both
// schemas plus the engine's unknown-option gate): a capability is never
// half-deleted. See that entry's comment for the full disposition; no D2
// conversion, since an engine option bag is call-time only.
export const entry = 'data/DataEngineUpdateOptions:upsert';
