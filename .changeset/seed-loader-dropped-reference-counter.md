---
"@objectstack/spec": patch
"@objectstack/metadata-protocol": patch
"@objectstack/runtime": patch
"@objectstack/cli": patch
"@objectstack/cloud-connection": patch
---

fix(seed-loader): count reference fields dropped from rows that were still written

The loader had two failure outcomes and only counted one. A record it cannot
write is counted in `errored`. But an unusable **reference value** (an object
where a natural key belongs, an array on a single-value field) is removed from
the record — never written as NULL, which would sever an existing link on
upsert replay — and the row is written **without it**. Nothing counted that.

So a load that quietly severed N associations reported `totalErrored: 0`, and
every count-driven surface read clean. The CLI boot banner — the one seed signal
that survives `os dev`'s boot-quiet window and the default `warn` level — printed
`showcase 42 rows`, and the warn line said `0 dropped record(s)`: true, and
useless ([#3932](https://github.com/objectstack-ai/objectstack/issues/3932)).

`SeedLoadResult.referencesDropped` and `SeedLoaderSummary.totalReferencesDropped`
now count it. It is deliberately **not** folded into `errored` — the row *was*
written, so that would break the `inserted + updated + skipped` reconciliation
against `total`. The banner names it separately:

```
⚠ Seeds:   showcase 42 ok / 3 lost links ⚠
```

Both counters are additive with a `0` default, so an existing producer or
consumer of `SeedLoaderResult` is unaffected.
