---
'@objectstack/spec': minor
---

`api-surface-declarations/<entry>.txt` — every export of every published entry point now ships a readable pin of the `.d.ts` declaration text the packed build actually emits for it, and the 27-entry `api-surface-signatures.json` hash it subsumes is retired (#16045).

`Clause-②: yes (widening)`

Until now this package pinned its public surface on one axis. `api-surface/<entry>.json` records each export as `name (kind)` — 5336 rows across 17 entry points, re-derived on the landing tree — and a signature change, a renamed interface field and a dropped union member move **none** of them. The only shape pin was `api-surface-signatures.json`: 27 rows, 0.5% of the surface, and reference-level even there, because it hashed `checker.typeToString()`, which prints `z.input<typeof ActionSchema>` without expanding it. A breaking shape change to a ratified public type could pass every witness green.

- **Text, ⛔ not a hash, deliberately.** A digest answers "did the bytes move" with one opaque bit whose known failure at scale is that a red one gets *accepted* rather than investigated. Each shard holds one block per declaration — `// ── Name (kind) ──` followed by the declaration verbatim — so a diff names the export and shows the change, and the existing review discipline is what guards it.
- **The input is the packed `.d.ts` reached through the `exports` map**, i.e. the declarations a consumer installs, never `src/`. Two of the manifest's 19 `exports` entries are asset subpaths with no declaration (`./openapi.json`, `./package.json`), which is why this artifact and `api-surface/` both hold 17 shards.
- **What it costs, measured on the landing tree**: 12,661,943 bytes (12.08 MiB) of text across 17 shards, 237,706 lines, 1.02 MiB gzipped against this package's ~17.6 MiB compressed `dist`. The skew is extreme — the median declaration is 81 bytes and the 20 largest hold ~65% of the bytes, because a Zod schema's packed declaration is its fully expanded structural type. That expansion is exactly what makes an inner field rename visible; it also means four declarations exceed 20,000 lines each.
- **Leading TSDoc is excluded**, so a re-worded `.describe()` does not churn this artifact — documentation drift stays `check:docs`'s axis.
- **The retirement is a strict superset, proven before it landed**: all 27 factory names resolve to a declaration block in `api-surface-declarations/root.txt`, 0 missing. For those 27 declarations text and hash discriminate the same amount (both print a type reference); what is *gained* is the 5309 other declarations, including the schemas those factories point at, whose expanded blocks are where an inner-key narrowing shows up. Nothing published read the retired file: it was not in this package's `files[]`.
- **Sharded per entry point from day one**, for the reason `api-surface/` is: the merge queue rebuilds server-side where no custom merge driver runs, so two PRs sharing one generated file evict the second.

Regenerate with `pnpm --filter @objectstack/spec build && pnpm --filter @objectstack/spec gen:api-surface-declarations`; `check:api-surface-declarations` names that command when it fails. It reads the built dist, so a missing or stale one is a hard refusal in both modes rather than a green run over nothing.
