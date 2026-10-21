---
'@objectstack/spec': minor
'@objectstack/lint': minor
'@objectstack/cli': minor
---

feat(spec): a `page:tabs` item label gains a translation key, `pages.<page>.components.<tabsId>.items.<value>.label`

Clause-②: yes (widening)

- **Before.** `pages.<page>.components` is keyed by component id, and a `page:tabs` item is not a component and carries no id, so a tab label had no key. `items` was refused as an unknown key, and `translatePage` never read `items[].label`. A localized page kept its tab strip in the authoring language.
- **Now.** `pages.<page>.components.<tabsId>.items.<value>.label` is a declared key. It is addressed by the tabs component's own `id` and the item's `value` (the stable `?tab=` token), and `translatePage` overlays it onto that item's `label`, across the locale chain. The entry is closed: `title`, `name` and `text` are renames onto `label`. An item without a `value` has no key, because its renderer token is index-derived and an array index is never a bundle key. Author a `value` on the item, or keep localizing that label with an inline locale map.
- **`walkAddressedPageComponents`.** A visitor's edit to a panel's own keys (its `label`) now stands when the visitor keeps the panel list's authored shape. Panel children are still descended from the authored document.
- **`objectstack validate`.** `@objectstack/lint`'s translation-reference check accepts the key over a declared `page:tabs` item `value`. It refuses it as `translation-target-unknown` over an unknown value (with "Did you mean"), over a component of another type (a `page:accordion` is pointed at the inline locale map, since its panels have no stable key), and under a component id the page does not declare.
- **`os i18n extract` / coverage.** The extractor writes a slot for every valued tab item, and the coverage check demands it. An inline locale map on the item label is counted as authored, as before.
- **Unchanged.** Every existing `pages` key, and an inline locale map on a tab label that the bundle does not key.
