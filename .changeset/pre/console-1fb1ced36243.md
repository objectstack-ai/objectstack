---
"@objectstack/console": minor
---

Console (objectui) refreshed to `1fb1ced36243`. Frontend changes in this range:

Derived from the changesets objectui declared over the range — 10 releasing of 11 changesets added across 11 non-merge commits; omitted: 1 release-nothing changeset, 2 commits carrying no changeset (they ship no package code).

- **minor** — The author of a comment on a record page can now edit and delete it from the record feed (objectui#12268). (objectui `7af0ab378`)
- **minor** — **BREAKING** — Both dashboard surfaces draw a widget's legacy `component` envelope the way it is authored: a `metric-card` node draws as before, and any other node draws the retired-format promp… (objectui `e8fc452c3`)
- **minor** — The console's assistant button no longer covers the record page's inline-edit Save or an attachment's Download and Delete, and deleting an attachment asks first (objectui#12248). (objectui `51c661e38`)
- **minor** — **BREAKING** — The exported field metadata types stop declaring the members `@objectstack/spec`'s `FieldSchema` refuses by name and no reader honours, and two type values become the spec's `Fiel… (objectui `10aba37d1`)
- **patch** — A record page's header totals now update when you edit or delete a row in one of its related lists (objectui#12244). Before, a quote's total in the header highlight strip kept its… (objectui `30c2e4e1d`)
- **patch** — fix(plugin-report): a report lays out a select dimension in the field's declared option order (objectui#12243) (objectui `e5c8ea7fe`)
- **patch** — Home's activity card names each row's object by its label in the reader's language (objectui#12238). (objectui `ee5c49171`)
- **patch** — A record activity feed shows a call, meeting or email logged on the record, instead of hiding it as a completed task (objectui#12228). On an object with no authored record page, a… (objectui `0cd322d78`)
- **patch** — A currency field's fixed currency, declared as `currencyConfig`, shows on the record quick-look panel and in related lists (objectui#12242). (objectui `10aba37d1`)
- **patch** — The record form stops reading a field's snake_case `visible_on`. A field's visibility is `visibleWhen`, the key `@objectstack/spec`'s `FieldSchema` declares (objectui#12242). (objectui `10aba37d1`)

⚠️ 2 of these carry a breaking change: 2 by the author's own breaking annotation in the changeset body — objectui declares no `major` inside a launch window (`scripts/check-changeset-no-major.mjs`). Each is marked **BREAKING** in the list above — read them before compiling the release record.

**In this console build, declared nowhere** — objectui merged 2 commits in this range with no `.changeset/*.md`. The code is inside the pin above and ships here, but nothing upstream declared them, so they appear in no objectui CHANGELOG and in no entry above. Listed by subject rather than counted, because a count cannot tell a dependency bump from a form-behaviour change (objectstack#6174); the upstream gate that would prevent this is objectui#3387.

- _(no changeset)_ ci(test): the coverage lane runs eight shards, then both test matrices shard by measured duration (objectui#12208, objectui#12256) (#12263) (objectui `1fb1ced36`)
- _(no changeset)_ ci(type-check): the turbo cache replays unchanged packages, and pull-request and queue runs type-check only what the change affects (objectui#12222) (#12251) (objectui `1ce8db8d9`)

Clause-②: no

<!-- adr-0087: not-required (no-migration-prescription)
     This diff moves `.objectui-sha` and the artefacts that travel with it: this console
     changeset, the re-recorded `scripts/sdui-manifest.record.json` and the regenerated
     `sdui.manifest.json`, the re-recorded `packages/sdui-parser/objectui-lockstep.json` and
     the re-measured pin citations in `packages/spec/src`, which carry their own
     `@objectstack/spec` patch changeset. It adds, removes or renames no
     ObjectStack-authorable key: no Zod schema, no spec declaration and no stored
     `sys_metadata` shape moves in it, so `objectstack migrate meta` has nothing here to
     rewrite, and this body carries no FROM/TO prescription of its own.
     The range carries two declared-breaking objectui changes, each by its author's
     breaking annotation and none by a declared `major`, and no commit subject carries `!`.
     The digest marked only the first. The second opens its annotation with a warning sign
     before the word (a `## ⚠️ BREAKING, priced as minor …` heading), which the digest's
     block-opener rule does not recognise, so its entry above was marked by hand.
     Each is answered here:
     (1) objectui#12254 (`e8fc452c3`): both dashboard surfaces draw a widget's legacy
     `component` envelope only for a `metric-card` node, in `@object-ui/plugin-dashboard`.
     `@objectstack/spec` already refuses `component` and inline `data` on a dashboard widget
     (`QUARANTINED_WIDGET_KEYS`, `ui/dashboard.zod.ts`) and declares no `custom` widget, so
     nothing authored here can reach that envelope; the six dashboard files under
     `examples/` author no `component` key.
     (2) objectui#12242 (`10aba37d1`): `@object-ui/types`' field metadata types turn
     `visible_on`, `currency`, `filterable`, `min_date`, `max_date`, `default_zoom`,
     `starting_number`, `schema` and `normalize` into `never` tombstones and change the
     `auto_number` / `object` type values to `autonumber` / `json`. No package or example in
     this repo depends on `@object-ui/types` (two code comments name it). No example field
     authors any of those members (the one `schema:` key under `examples/` sits on a
     `json_schema` validation rule, not on a field), and no example field declares `type: 'auto_number'`
     or `type: 'object'`.
     Scope of the claim, stated rather than implied: it is a claim about THIS diff, not a
     per-entry re-measurement of the upstream declared-breaking entries.
-->

objectui range: `7578323a544e...1fb1ced36243`
