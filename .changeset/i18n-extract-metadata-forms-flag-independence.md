---
"@objectstack/cli": patch
---

`os i18n extract --no-metadata-forms` is honoured whatever `--objects-only` is set to, and the Studio metadata-form baseline lands in exactly one module.

The flag gated only the `<locale>.metadata-forms.generated.ts` companion. The stack module's renderer had a third mode, `kind: 'full'`, that serialised the WHOLE `TranslationData` — the baseline included — and `--no-objects-only` selected it. So the two flags stopped being independent the moment the second one was passed, in both directions:

- **`--no-metadata-forms --no-objects-only`** suppressed the companion and wrote the same keys into `<locale>.objects.generated.ts` instead. Driven on a one-object, one-app stack with `i18n.defaultLocale: 'zh-CN'`: the emitted zh-CN module carried **776 leaves, of which 773 were the metadata-form baseline** the flag had just switched off (the stack's own surface is 3). Those 773 are **English** — the default locale is filled from the source labels and the metadata-form registry authors them in English — so a non-English default locale shipped the platform's English Studio strings inside its own application bundle.
- **`--no-objects-only` alone** wrote those 773 keys **twice**, once in each module.

`--objects-only` picks the stack module's sub-tree; `--metadata-forms` decides whether the baseline is emitted at all. Both keep exactly the meaning their `--help` already gave them, and nothing here picks a winner between them — the overlap was in the emitter, never in the two meanings. The renderer's three modes are now a partition of one locale's generated leaves (`'full'` is renamed `'stack'` and omits `metadataForms`), so every leaf has exactly one module it can land in. `--json`, documented as "output JSON instead of writing files", carries the same payload the files do; the baseline's size is still reported there, in `metadataFormsCounts`.

**No bundle in this repository moves.** All nine extract configs run under the default `--objects-only`, whose emitted module, export name and type signature are byte-for-byte unchanged — `pnpm check:i18n` stays green on the committed tree. A stack that DOES pass `--no-objects-only` regenerates a smaller `<locale>.objects.generated.ts`: its export keeps its name and narrows from `TranslationData` to `Omit<TranslationData, 'metadataForms'>`, and the baseline it used to duplicate is in the companion beside it unless `--no-metadata-forms` says it should not be there at all.

The regression pin spawns the real CLI and takes a group census of the bytes it wrote. The sibling pin that mirrors the emit rule and checks file NAMES stayed green through all of this: the file set was right in every combination, and only the content of one file was wrong.
