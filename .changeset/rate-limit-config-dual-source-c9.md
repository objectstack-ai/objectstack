---
"@objectstack/spec": major
---

BREAKING(spec): `@objectstack/spec/integration` renames `RateLimitConfig` →
`ConnectorRateLimitConfig` (#4684, C9)

Two entry points exported `RateLimitConfig` for **two different declarations**,
so which one you got depended only on the import path — the #4411 trap. They are
not variants of one concept; they describe opposite directions of traffic:

| | `@objectstack/spec/shared` (unchanged) | `@objectstack/spec/integration` (renamed) |
|:--|:--|:--|
| what it limits | **inbound** — calls others make to our API | **outbound** — calls we make to an external system |
| written at | `apis[].rateLimit`, `httpServer.security.rateLimit` | `connectors[].rateLimitConfig` |
| window | `windowMs` (ms), defaults to 60000 | `windowSeconds` (s), **required**, min 1 |
| quota | `maxRequests`, defaults to 100 | `maxRequests`, **required**, min 1 |
| extras | `enabled` (default `false`) | `strategy`, `burstCapacity`, `respectUpstreamLimits`, `rateLimitHeaders` |

Neither schema is `.strict()`, so a snippet copied from one side to the other
parsed **clean** with its foreign keys silently stripped — `RateLimitConfigSchema
.parse({ windowSeconds: 60, strategy: 'token_bucket' })` returned
`{ enabled: false, windowMs: 60000, maxRequests: 100 }` and nothing said a word.
Per ADR-0112 D9(a) — the same ruling that produced `ConnectorErrorCategory` and
`ConnectorRetryStrategy` in the same file — the **connector side is renamed** so
one name means one thing.

## FROM → TO

```ts
// before
import { RateLimitConfigSchema, type RateLimitConfig } from '@objectstack/spec/integration';

// after
import {
  ConnectorRateLimitConfigSchema,
  type ConnectorRateLimitConfig,
} from '@objectstack/spec/integration';
```

No deprecated alias is kept: re-exporting the old name would be a third
declaration of it and would re-open the trap this change closes.

**Importing from `@objectstack/spec/shared` (or `/api`, `/system`)? Nothing
changes** — that `RateLimitConfig` keeps its name, its keys and its defaults.

## Authored metadata needs no migration

This renames a TypeScript export and an internal JSON Schema `$def`, not an
authorable key. Every one of the six keys an author can write under
`connectors[].rateLimitConfig` — `strategy`, `maxRequests`, `windowSeconds`,
`burstCapacity`, `respectUpstreamLimits`, `rateLimitHeaders` — parses exactly as
before. Existing stack metadata, stored `sys_metadata` rows and published apps
are byte-for-byte unaffected, which is why this change ships with **no ADR-0087
conversion and no tombstone**: nothing was retired.

The only edit an upgrade needs is the import above, in TypeScript that named the
type. The published JSON Schema `$id` moves with it:
`…/integration/RateLimitConfig.json` → `…/integration/ConnectorRateLimitConfig.json`.

## Gate change riding along

`scripts/build-schemas.ts` learns a declarative `RENAMED_DEFS` table
(`scripts/lib/renamed-defs.ts`). Its two ratchets measure in `$def` units, so a
def rename previously read as six authorable keys vanishing at once. The table
carries the old snapshot forward under the new name and enforces the rule a
rename must obey: **every key under the old def must exist under the new one, or
the build fails** — plus the target must be emitted and the source must not (a
def that is still published is a copy, not a rename). This is stricter than the
hand-edited baseline it replaces, which could drop any line without a trace.
