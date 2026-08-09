---
"@objectstack/spec": minor
---

`resolveI18nLabel` — the shared `I18nLabel` → `string` resolver, and the first one the backend has

`I18nLabelSchema` has authorized two forms of a display label since #5728: a
plain string, and an inline locale map (`{ en: 'Owner', 'zh-CN': '负责人' }`) —
which three published platform pages author 31 times. Only ONE end of the
platform knew what the second form means: objectui's `pickLocalized`. Every
backend producer that had to put a label on the wire tested
`typeof label === 'string'` and dropped anything else, so a dataset that declared
its dimension label the way the schema authorizes shipped `fields[]` entries with
no label at all — or with the machine name published as a display title. The
shape was declared and unreadable on the side that produces it.

`packages/spec/src/ui/i18n-label-resolver.ts` is that missing half:

```ts
import { resolveI18nLabel } from '@objectstack/spec/ui';

resolveI18nLabel({ en: 'Owner', 'zh-CN': '负责人' }, 'zh-CN'); // '负责人'
resolveI18nLabel(dimension.label, locale) ?? dimension.name;   // producer shape
```

It lives in `packages/spec` rather than inside the service that needed it first
(maintainer ruling 2026-08-08, #6761 option B): the backend had **zero** inline-map
resolvers, and a first one born as a private fork inside one service is what the
next producer copies (Prime Directive #12).

**Rule parity with `pickLocalized` is the contract, and it is executed, not
asserted.** The resolution rule — exact tag → base language (`zh-CN` → `zh`) →
first region-qualified sibling sharing the base (`zh` → `zh-CN`) → `default` →
`en` → any string in the map, with `(locale || 'en').trim()` and no case folding —
is mirrored limb for limb from objectui `packages/i18n/src/pickLocalized.ts`, and
a 26-row vector table asserts each vector against a pinned verbatim copy of the
reference before asserting it against this resolver. Two resolvers that drift
would render the same metadata differently on the two ends with neither side
erroring; that is the fork this exists to prevent.

The one visible difference is the spelling of a miss: `pickLocalized` returns `''`
because its caller writes into a text node, while this returns `undefined` because
its callers fill a `label?: string` field whose downstream enrichment is guarded by
`if (field.label == null)` — a producer writing `''` would not be saying "no label",
it would be permanently displacing a real label a later stage still had. The bridge
is one `??`, pinned as an identity: `resolveI18nLabel(l, loc) ?? '' === pickLocalized(l, loc)`.

Additive only — one new exported function on `@objectstack/spec/ui`, no existing
declaration changed. The consumption half (`AnalyticsService.queryDataset`'s two
enrichment sites and `dataset-compiler.ts`'s `d.name` substitution) is #6761.
