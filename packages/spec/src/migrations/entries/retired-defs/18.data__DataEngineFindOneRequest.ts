// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #27028 — `data/DataEngineFindOneRequest` — one arm of the `DataEngineRequestSchema` union, the
// Virtual ObjectQL request protocol (`data/data-engine.zod.ts`) — leaves whole
// with that protocol under ADR-0049 enforce-or-remove, by the maintainer's
// ruling A on its decision card (2026-10-28). No Virtual Data Engine existed and
// nothing parsed the protocol, in this repo or in hotcrm, objectui or
// docs.objectos.ai. No carrier key, so no `retiredKey()` tombstone and no D2
// conversion: RETIRED_DEFS_BY_MAJOR plus the D3 semantic entry
// `data-engine-rpc-protocol-retired` ARE the declaration.
export const entry = 'data/DataEngineFindOneRequest';
