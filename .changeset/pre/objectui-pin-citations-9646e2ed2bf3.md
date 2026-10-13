---
'@objectstack/spec': patch
---

The spec's objectui citations, and the shipped description text that names the `.objectui-sha` pin (the `FormField.span` describe and six migration-entry descriptions), are re-measured against the new console pin, objectui `9646e2ed2bf3`.

Clause-②: no

Every anchor was mapped through the objectui diff `088e0f705520..9646e2ed2bf3`: 64 paths over 9 commits. One file that any record cites changed on the hop: `plugin-list/src/ListView.tsx` (+9/-9, objectui#12189, objectui `26b0bd2d1`, which renames the FilterBuilder group type to `FilterBuilderRowGroup`). All nine lines were replaced in place, the last at `:1558`, so no line in the file moved and no cited range contains a changed line:

- the `kanban` / `calendar` / `gantt` / `timeline` / `map` / `tree` arms of its per-type props builder held at `3762` / `3813` / `3959` / `3902` / `4079` / `4120-4144`;
- `resolveListMapConfig` (`:209-214`) and `resolveTimelineDateBinding` (`:695-699`) held, and each ends before the next changed line below it (`:324`, `:756`).

That file is cited by the four view-type rows of the functional-completeness table (`calendar`, `gantt`, `timeline`, `map`) and by the `object-gantt` and flat-`TreeConfig` records. Each of those gains a hop sentence naming it. The `kanban` row-cap record names `ListView.tsx` only as an earlier re-read's record, and its sentence says so.

Every other record cites only files that are byte-identical across the hop (`git diff --quiet`, checked file by file), and each gains a hop sentence that says so. That covers `form.tsx`, so `FormField.span: 'full'` still takes the whole row at every multi-column tier.

The six migration entries' corpus counts were re-taken with `git grep -o -F`, the method that reproduces every `088e0f705520` number. The corpus is now 8540 tracked files, and every retired name each entry counts still reads 0. The lit controls moved with the corpus, for example `objectstack` from 18400 to 18438, `tenant` from 1365 to 1393 and `useState` from 2661 to 2662.

No key, default, enum member or export moves.
