---
"@objectstack/console": minor
---

Console (objectui) refreshed to `f5bc4c78be76`. Frontend changes in this range:

Derived from the changesets objectui declared over the range — 11 releasing of 11 changesets added across 31 non-merge commits; omitted: 20 commits carrying no changeset (they ship no package code).

- **minor** — Field widgets are finally told when their field fails validation, and the props slot that carries it takes the name the published contract gives it (objectui#3222). (objectui `56409c28c`)
- **minor** — Retire `validation` from the action-param contract — it was declared on both halves, read by neither, and rejected outright by the server (objectui#3201). (objectui `f833d3ae4`)
- **patch** — Five metadata designers stop rendering keys `@objectstack/spec` rejects, and start rendering the keys it declares (objectui#3275, objectui#3281). (objectui `8ff3ad7b8`)
- **patch** — The Page block inspector's conditional-visibility control now authors `visibleWhen`, and says "Visible when" while doing it (objectui#3229). (objectui `8e02ad7f2`)
- **patch** — The record discussion panel no longer shows the PREVIOUS record's comments and activity (objectui#3268). (objectui `a8aa57663`)
- **patch** — The form renderer's built-in `select` branch stops saying "No options available" in English to non-English sessions (objectui#3263). (objectui `a7651e640`)
- **patch** — The record discussion panel now says "loading" while it is loading, instead of "No comments yet" (objectui#3209). (objectui `12bf6691e`)
- **patch** — The legacy `page-header` alias stops advertising `description` as an authorable key (objectui#3226). (objectui `d2363e710`)
- **patch** — The option widgets' "this list cannot be filled" message now has one source, and it is translated (objectui#3231). (objectui `825bbe33c`)
- **patch** — `ToolPreview` stops advertising retired `ToolSchema` flags (objectui#3236). (objectui `30ac2e1ee`)
- **patch** — `TextAreaField`'s mobile fullscreen flag converges on its one real producer (objectui#3232). (objectui `a321fa461`)

objectui range: `785b8a5d432c...f5bc4c78be76`
