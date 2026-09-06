---
"@objectstack/cli": patch
---

`os lint` / `os i18n check` stop reporting a written inline locale map as an untranslated string.

`I18nLabelSchema` authorizes two forms of a display label: a plain string, whose translations live in a bundle, and an **inline locale map** — `{ en: 'Members', 'zh-CN': '成员' }` — written out at the authoring site and picked at render time. Rulings on both forms make the map the one localisation route for props that have no bundle key at all, so a page localised that way is fully localised.

The coverage walk could not see it. `inlineText()` narrowed a map to `undefined` — the same value an **absent** prop produces — so one diagnostic carried two opposite facts, and the gate reported a prop written out in four languages exactly as it reports a prop nobody wrote:

- with no bundle entry, the key was dropped from the expected set entirely: neither covered nor missing, invisible in the counts;
- with a bundle entry for one locale, the key came back with no inline evidence, and every locale the **map** held and the bundle did not was reported `missing translation` — about text that was right there in the file.

An entry now carries a third axis beside `sourceValue` and `inline`: `inlineLocales`, the map the author wrote, verbatim. Coverage reads it per locale — a locale the map carries counts as covered, a locale it omits is reported as a gap, and the default locale is satisfied by the map the way it has always been satisfied by an inline string. The read is deliberately narrower than the renderer's: only the tag-matching limbs of the shared `resolveI18nLabel` rule count, because falling back to `en` or to the untagged `default` entry **is** what an untranslated locale looks like.

Two things this deliberately does not do. The map is still **never extracted**: no bundle row is scaffolded for it, and no key family is added — a translator working from the locale bundle still will not find these strings, which is the cost of the form and is now stated where an author chooses it (`i18n.zod.ts`, and the extractor's own header). And no key is synthesised from a node's position in the page tree: position-addressed keys would turn a reorder of two sibling components into a silent, all-green swap of their translations. If inline maps are ever to be extracted, the recorded direction is identity first — `component.id` / `section.name` / `tabs item.value` made mandatory and gate-enforced, then the existing `pages.<page>.components.<id>.<key>` family reused.

Net effect on a project that authors no inline maps: none. On one that does, the gate starts telling the truth in both directions — the false `missing translation` goes, and a map that genuinely omits a locale is reported for the first time.
