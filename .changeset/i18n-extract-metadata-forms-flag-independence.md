---
"@objectstack/cli": patch
---

`os i18n extract --no-metadata-forms` is honoured whatever `--objects-only` is set to, and the Studio metadata-form baseline lands in exactly one module.

The flag gated only the `<locale>.metadata-forms.generated.ts` companion. The stack module's renderer had a third mode, `kind: 'full'`, that serialised the WHOLE `TranslationData` — the baseline included — and `--no-objects-only` selected it. So the two flags stopped being independent the moment the second one was passed, in both directions:

- **`--no-metadata-forms --no-objects-only`** suppressed the companion and wrote the same keys into `<locale>.objects.generated.ts` instead. Driven on a one-object, one-app stack with `i18n.defaultLocale: 'zh-CN'`: the emitted zh-CN module carried **776 leaves, of which 773 were the metadata-form baseline** the flag had just switched off (the stack's own surface is 3). Those 773 are **English** — the default locale is filled from the source labels and the metadata-form registry authors them in English — so a non-English default locale shipped the platform's English Studio strings inside its own application bundle.
- **`--no-objects-only` alone** wrote those 773 keys **twice**, once in each module.

`--objects-only` picks the stack module's sub-tree; `--metadata-forms` decides whether the baseline is emitted at all, and it is now the only control over it **on both faces**. Both flags keep exactly the meaning their `--help` already gave them, and nothing here picks a winner between them — the overlap was in the emitter, never in the two meanings.

`'full'` is renamed `'stack'` and omits `metadataForms`, so the module a run writes and the baseline companion beside it are disjoint, and under `'stack'` the two together are everything the extractor built (3 + 773 = 776 on the fixture above — the extractor's own count, none dropped, none duplicated). ⚠️ That is a statement about the PAIR a run emits, not about "three kinds partitioning the leaves": `'objects'` is a sub-selection of `'stack'`, not a sibling of it.

`--json`, documented as "output JSON instead of writing files", mirrors that file set: `bundles` is the stack module and a `metadataForms` map is the companion, keyed by the locales whose companion would be written and gated by the same predicate. That map is new. It exists because the first cut of this change stopped the fold on the `--json` face as well and left the baseline with no JSON home at all — measured, `--json --no-objects-only` with the flag ON and with `--no-metadata-forms` returned payloads equal in every field but `duration`, so on that face the flag decided nothing, the mirror image of the defect this card reports. `metadataFormsCounts` reports the baseline's size in every run, as before.

**No bundle in this repository moves.** All nine extract configs run under the default `--objects-only`, whose emitted module, export name and type signature are byte-for-byte unchanged — `pnpm check:i18n` stays green on the committed tree. A stack that DOES pass `--no-objects-only` regenerates a smaller `<locale>.objects.generated.ts`: its export keeps its name and narrows from `TranslationData` to `Omit<TranslationData, 'metadataForms'>`, and the baseline it used to duplicate is in the companion beside it unless `--no-metadata-forms` says it should not be there at all.

**What content moves where.** On the file face nothing published loses content: under the default `--objects-only` the output is byte-identical, and under `--no-objects-only` the baseline moves out of the stack module into the companion the same command already writes — unless `--no-metadata-forms` says it should not exist, which is the ask. On the `--json` face the baseline moves from inside `bundles` to its own top-level key, and under `--no-metadata-forms` it is now absent, which it never was before: that face did not honour the flag at all.

The regression pin spawns the real CLI and takes a group census of the bytes it wrote, and drives `--json` in BOTH flag states. The one-state version of that case could not have failed on the axis that failed here — a pin that exercises only the flag-OFF path can never detect a flag that does nothing. The sibling pin that mirrors the emit rule and checks file NAMES stayed green through all of this: the file set was right in every combination, and only the content was wrong.
