---
'@objectstack/spec': patch
---

The spec's objectui citations, and the shipped description text that names the `.objectui-sha` pin (the `FormField.span` describe and six migration-entry descriptions), are re-measured against the new console pin, objectui `4997995022f8`.

Clause-②: no

Every anchor was mapped through the objectui diff `0df67f237c5a..4997995022f8`: 80 paths over 7 commits, none deleted and one renamed (a schema-catalog example, which no record cites). Three files a record cites changed on the hop, plus the `en` / `zh` / `de` packs (whose `calendar.configRequired` strings did not change): `ObjectGrid.tsx` (objectui#12081 item 3 and objectui#12082), `ObjectGantt.tsx` (objectui#12082) and `form.tsx` (objectui#12121). Every cited line in them moved or held with its text byte-identical, and each record that cites one is re-pointed with a hop sentence that says by how much. The records that cite only byte-identical files gain a hop sentence that says so.

Two readings sit beside a cited read, and each hop sentence says what it found:

- `ObjectGrid.tsx`: a bulk `update` def is now withheld unless the edit verdict allows it (objectui#12082), which narrows the declared defs and adds no implicit one, so the `sys_api_key` reading holds. The selection block still hashes to `c88443302d40`.
- `ObjectGantt.tsx`: the chart's in-chart write handlers are withheld from a caller without the grant (objectui#12082). No `schema.*` read moved; the renderer reads the same 49 names at both pins.

The six migration entries' corpus counts were re-taken with `git grep -o -F`, the method that reproduces every `0df67f237c5a` number. The corpus is now 8441 tracked files. Every token an entry counts as zero still reads zero (96 tokens; `Span` and `SpanSchema` read 517 and 57 at both pins, as the tracing entry records). The controls moved with the corpus, for example `objectstack` from 18248 to 18271 and `timeout` from 1705 to 1704.

No key, default, enum member or export moves.
