// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #8075 — data/external-lookup.zod.ts, retired whole (ADR-0049). Extended
// `shared/FieldMapping` and was embedded only by `ExternalLookupSchema`, which
// nothing consumed. Its `transform` key's #5552 `retiredKey()` tombstone — and
// the `data/ExternalFieldMapping:transform` RETIRED_KEYS entry that registered
// it — are SUBSUMED here, the WidgetManifest.performance way: they go with the
// shape that carried them, which is strictly stronger, because there is no
// longer a mapping shape to author the key INTO. The base tombstone on
// `shared/FieldMapping` and the `integration/ConnectorFieldMapping` spelling
// are untouched and still reject the key with the #5552 prescription.
export const entry = 'data/ExternalFieldMapping';
