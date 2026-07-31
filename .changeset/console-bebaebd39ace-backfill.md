---
"@objectstack/console": patch
---

Console (objectui) backfill for `96ee72e85439...bebaebd39ace` — the 27 fix
commits that refresh's changeset did not enumerate.

`scripts/bump-objectui.sh` emits a `@objectstack/console` changeset on every
bump precisely so a SHA move leaves a trace (see `docs/releases-maintenance.md`),
and the `console-bebaebd39ace.md` entry it wrote covers only the tail of its own
range: the range holds **94** first-parent commits, the enumeration lists 40,
and its oldest entry is #3026. Everything that merged earlier inside the same
range went unrecorded — in the release history and in the curated v17 page.
This is the second instance of the failure `console-c6cfdf1288b6-backfill.md`
records; it declares no SHA move (`.objectui-sha` already points at
`7d9734d5e321`, past this range).

The 27 are all `fix`, hence `patch`. Several are data-loss fixes an upgrading
Console user feels immediately:

- fix(form): a tabbed/sectioned modal keeps every tab's values (#2959, #2153) (#2987)
- fix(form): a split form keeps BOTH panels' values (#2153) (#3012)
- fix(form): a defaultValues change no longer discards the field being filled (#2982) (#2991)
- fix(components): apply new form defaultValues in the commit that renders them (#3001)
- fix(plugin-form): block page unload while a modal/drawer form has unsaved input (#2998)
- fix(plugin-form): swapping recordId no longer leaves the previous record on screen (#3005)
- fix(plugin-form): a wizard that ends on a field-less review step can finish (#2986)
- fix(form): a tabbed/split form honours the form view's own `columns` (#3018)
- fix(console): a flow or action that failed under HTTP 200 stops reporting success (#2958) (#2995)
- fix(grid): a legacy string row action runs instead of green-toasting a no-op (#2960) (#2996)
- fix(spec-parity): render the six Tier-1 spec values right instead of silently wrong (#2941) (#2993)
- fix(spec-parity): the Tier-2 spec values render instead of validating into nothing (#2942) (#3008)
- fix(spec-parity): the Tier-3 spec values render instead of red-boxing (#2943) (#3011)
- fix(view,components): the spec→FilterBuilder operator table covers the whole view vocabulary (#2945) (#2989)
- fix(view): the spec→FilterBuilder map follows the four operators #2942 added (#3022)
- fix(charts): a spec `series[].type` draws, and a spec-shape `series` plots at all (#2945) (#3004)
- fix(charts): say so when rows carry no category key, instead of drawing an empty axis (#3007)
- fix(analytics): a missing analytics capability no longer renders as an empty KPI (objectstack#3891) (#2981)
- fix(chatbot): read the agent catalog in the declared envelope too (objectstack#4053) (#2992)
- fix(sdui): a react page keeps its state; a source that exports nothing fails loudly (#2984)
- fix(sdui): a kind:'html' page can use lazily-registered blocks, and recovers when one registers late (#2988)
- fix(sdui): stop the react page's "no adapter yet" fallback churning its provider context (#3000)
- fix(sdui): the curated contract lists record:line_items, the tag that actually resolves (#3006)
- fix(record): register the record:* blocks under one key, prefixed once (#3023)
- fix(plugin-list,plugin-grid): drop undeliverable formats from the export menu (#2999)
- fix(components): a stacked resizable group gets a divider, not a 1px sliver (#3024)
- fix(components,app-shell): the last two `direction` props follow v4's rename to `orientation` (#3025)

Also in the range and deliberately not listed here: the refactor/chore/test/
build/ci PRs the bump script's fix/feat filter excludes by design — including
three breaking-flagged refactors already reflected in the spec-side work
(#2990 the `execute` alias deleted from the action runner, objectstack#3856;
#3003 action sub-vocabularies derived from spec, and #3020 authoring types
become input types, both objectstack#4074).

objectui range: `96ee72e85439...bebaebd39ace`
