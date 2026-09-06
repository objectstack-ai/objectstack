---
"@objectstack/cli": patch
---

`os i18n extract` reports key counts that describe the bytes it emitted, and its summary is a partition of the skeleton rather than a sum over it.

`extractTranslations` returned `counts[locale]` as a WALK counter — `count += 1` once per expected entry, unconditionally — and the command spent it as the number of keys in the file it had just written. Under the default `--objects-only` the module holds only the `objects` sub-tree, so the two are different numbers. Driven on a one-object, one-app stack with `i18n.defaultLocale: 'zh-CN'`:

```
  Skeleton summary
    zh-CN      776 key(s)  (of 776 expected)  + 773 metadataForms key(s)
  Wrote OUT/zh-CN.objects.generated.ts (776 keys)
```

The file that run wrote holds **2** leaves. The true split of the 776 is 2 objects + 1 app + 773 metadata-form baseline, so the summary appended a number the 776 already contained and read as 1549 out of 776 — an operator could not derive the truth from it, and the `(776 keys)` described no file the run produced. Both lines now read off the emitted tree:

```
  Skeleton summary
    zh-CN      775 of 776 key(s) emitted   objects 2 · metadataForms 773
  Wrote OUT/zh-CN.objects.generated.ts (2 keys)
  Wrote OUT/zh-CN.metadata-forms.generated.ts (773 keys)
```

**What each number now means.** `ExtractResult.counts[locale]` is a leaf count of `bundles[locale]` — the whole skeleton built for that locale, taken off the tree instead of off the walk that built it. It is explicitly not the size of any one file: which sections of the skeleton become committed modules is the caller's decision. The command therefore takes every count it reports off that module's own payload, selected with `translationModulePayload` — the same function `renderTranslationModule` renders from, so the number and the bytes cannot drift apart, including for a sub-tree mode added later. Nothing subtracts one count from another at a print site: that would repair today's two modes and leave the third wrong in the same way.

**The summary line's shape changed** from `N key(s) (of N expected) + M metadataForms key(s)` to `E of S key(s) emitted` with a per-module breakdown when more than one module carries keys. `E` is what this run's modules hold together and `S` is what the locale's skeleton holds, so `E ≤ S` always and the gap is exactly the keys a flag excluded — one app label under the default `--objects-only`, and nothing at all under `--no-objects-only`.

**A module with no leaves is no longer written.** The emit gate was `counts[locale] > 0`, a property of the skeleton: on a stack whose only surface is apps, the default `--objects-only` wrote a `<locale>.objects.generated.ts` holding `{}` and announced it as 774 keys. The gate is now the module's own leaf count.

**`--json`**: `counts` is now the leaf count of the `bundles` payload printed beside it — the relationship `metadataFormsCounts` already had to `metadataForms` — instead of the extractor's skeleton size. The skeleton total is unchanged and still reported, under its own name, as `totalExpected`.

**No committed bundle moves.** All nine extract configs in this repository run under the default `--objects-only` on stacks that do author objects, and every emitted module is byte-for-byte unchanged; `pnpm check:i18n` stays green on the committed tree. What changed is stdout, the `--json` counts, and the emission of a module that would have been empty.

The regression pin spawns the real CLI in four flag states and compares each printed count against a structural leaf count of the module it wrote, parsed back off disk. That comparison is the thing the defect precluded: a walk counter cannot disagree with the walk, so no assertion over `ExtractResult` could have failed while the printed number was wrong by two orders of magnitude.
