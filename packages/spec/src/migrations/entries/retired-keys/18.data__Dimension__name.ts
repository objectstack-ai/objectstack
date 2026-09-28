// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #20300 — the same ruling, the same diff and the same route as
// `data/Metric:name`: `Dimension.name` was REQUIRED and read by nothing, because
// `dimensions` is a record and every consumer resolves a dimension by its KEY
// (`getMeta` publishes `<cube>.<key>`, `lookupMember` and the in-memory driver's
// `resolveDimension` index the bag by key). A `retiredKey()` tombstone on the
// `strictObject`; the D2 conversion `cube-member-inner-name-removed` strips it
// from stored and built cubes, and the D3 record is
// `cube-member-inner-name-retired`.
export const entry = 'data/Dimension:name';
