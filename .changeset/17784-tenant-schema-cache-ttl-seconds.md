---
"@objectstack/spec": patch
---

fix(spec): `SchemaLevelIsolationStrategy.performance.schemaCacheTTL` is renamed to `schemaCacheTtlSeconds` (#17784)

<!-- adr-0087: registered tenant-schema-cache-ttl-unit-in-key -->

**BREAKING** — the schema-cache TTL on the `isolated_schema` tenant isolation strategy carries
its unit in the key name.

| | before | after |
|:--|:--|:--|
| authored key | `performance.schemaCacheTTL: 3600` | `performance.schemaCacheTtlSeconds: 3600` |
| published describe | `Schema cache TTL` | `Schema cache TTL in seconds` |
| value + default | seconds, `3600` | **unchanged** |

## Migration

```diff
  performance: {
-   schemaCacheTTL: 3600,
+   schemaCacheTtlSeconds: 3600,
  }
```

Rename the key. The value is the same number of seconds it always was, and the `3600` default is
unchanged; nothing else on `SchemaLevelIsolationStrategy` moves.

## Why

The key named its unit in a source JSDoc — "Schema cache TTL in seconds" — and nowhere else. The
`.describe()` that `content/docs/references/system/tenant.mdx` renders said "Schema cache TTL" and
named no unit at all, so the one reader who most needs it, the reader of the published reference
page, was the only reader who never saw it: `3600` is a plausible number of seconds and a plausible
number of milliseconds, and nothing on the page decided between them. Executes director-seat ruling
A on #15939 (2026-09-11, maintainer 「同意」, decision batch #115), the per-file remediation of the
#14478 rule — under that rule, moving the unit into the describe alone is itself a violation (unit
in prose, none in the name), so the key is renamed and the describe is corrected together.

The new spelling is `Ttl`, not `TTL`: counted on this tree, every member of the suffixed family
already spells it that way — `cacheTtlSeconds` (11), `ttlSeconds` (3), `defaultCacheTtlSeconds` (1).

## The kit

- a `retiredKey()` tombstone on the old spelling, so `tsc` types it `never` and a value reaching the
  parse raises the rename prescription instead of being silently stripped (the nested `performance`
  object is not `.strict()`)
- the ADR-0087 D3 semantic entry `tenant-schema-cache-ttl-unit-in-key` and the
  `RETIRED_KEYS_BY_MAJOR[18]` row `system/SchemaLevelIsolationStrategy:performance.schemaCacheTTL`.
  No D2 conversion: `stack.zod.ts` declares no tenancy collection and a tenant isolation strategy is
  not a stored metadata row, so the chain has no seam that runs on it — the same reading
  `tenant-timeouts-unit-in-key` recorded for the two sibling keys on this file
- pin tests on `SchemaLevelIsolationStrategySchema`: the refusal carries the rename prescription, the
  suffixed key parses at the magnitude the retired one carried with the same `3600` default, and the
  describe publishes the unit
- no authorable-surface row moves — that ratchet records top-level keys per def, and this one is
  nested under `performance` (measured: 0 hits for the key across `authorable-surface/` and
  `authorable-surface.base.json`, against 4 for the `system/MigrationPlan:` control)
