---
'@objectstack/spec': patch
---

The spec's objectui citations, and the shipped description text that names the `.objectui-sha` pin (the `FormField.span` describe and six migration-entry descriptions), are re-measured against the new console pin, objectui `7578323a544e`.

Clause-②: no

Every anchor was mapped through the objectui diff `9646e2ed2bf3..7578323a544e`: 288 paths over 25 commits. Three files that records cite changed on the hop, and every cited line in them held its text; where it moved, it moved byte-identical and is re-pointed:

- `plugin-list/src/ListView.tsx` (+34/-79, objectui#12217, objectui `f5b66bf97`: an empty gallery draws the grid empty state). One import line was added at `:16` and a four-line docblock near `:1040`; the other hunks change lines in place (`:10`, `:12`, `:1044`) or sit at `:5677` and below. So `resolveListMapConfig` moved `:209` -> `:210`, `FLAT_MAP_CONFIG_SPELLING` `:95` -> `:96` and `resolveTimelineDateBinding` `695` -> `696`. The `kanban` / `calendar` / `timeline` / `gantt` / `map` / `tree` arms moved by five, to `3767` / `3818` / `3907` / `3964` / `4084` / `4125-4149`. The functional-completeness `calendar`, `gantt`, `timeline` and `map` rows, the `object-gantt` and flat-`TreeConfig` records and the map-config record say so, and the tree record's `4120-4144` and the map-config record's two quoted anchors are re-pointed. The `kanban` row-cap record names `ListView.tsx` and `ObjectView.tsx` only as an earlier re-read's record, and its sentence says so.
- `core/src/actions/ActionRunner.ts` (+39/-23, objectui#12191, objectui `334f0cff9`): eleven import lines were added above `composeSuccessMessage`, which moved `1498` -> `1509` with its body byte-identical, and every other hunk lies below it. The `outcomeMessages` record in `action.zod.ts` re-points its anchor, and it and the header of `action-outcome-messages.test.ts` say so. The four action renderers are byte-identical.
- The `en` / `zh` / `de` packs (five commits each): the `calendar.configRequired` strings did not change and moved `en.ts` `:949` -> `:953`, `zh.ts` `:725` -> `:726` and `de.ts` `:705` -> `:706`.

Every other record cites only files that are byte-identical across the hop (`git diff --quiet`, checked file by file), and each gains a hop sentence that says so. That covers `form.tsx`, so `FormField.span: 'full'` still takes the whole row at every multi-column tier.

The six migration entries' corpus counts were re-taken with `git grep -o -F`, the method that reproduces every `9646e2ed2bf3` number. The corpus is now 8600 tracked files, and every retired name each entry counts still reads 0. The lit controls moved with the corpus, for example `objectstack` from 18438 to 18552, `timeout` from 1707 to 1686 and `tenant` from 1393 to 1404.

No key, default, enum member or export moves.
