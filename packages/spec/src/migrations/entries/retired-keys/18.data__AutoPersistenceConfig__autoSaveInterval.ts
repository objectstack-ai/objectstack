// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #15680 (stack card 5/6 of #14478) — ruling B, and the one key in this card
// that the gate did NOT list. It is here because it is not a second key: the
// `auto` persistence arm resolves to the same Node.js file adapter as the
// `file` arm, and this value is forwarded to the same
// `FileSystemPersistenceAdapter` field, in the same milliseconds, under the
// same `min(100)` bound. Its describe named no unit at all, which is why the
// predicate skipped it — and precisely why renaming only the `file` arm would
// have left ONE value with TWO spellings across sibling arms of one union, with
// the driver reading both. That is the consumer-side dialect Prime Directive
// #12 forbids, so the two arms move together. Renamed to `autoSaveIntervalMs`
// and its describe now names the unit too. Tombstoned with `retiredKey()`;
// covered by `memory-persistence-auto-save-interval-to-ms`, which converts both
// arms in one pass.
export const entry = 'data/AutoPersistenceConfig:autoSaveInterval';
