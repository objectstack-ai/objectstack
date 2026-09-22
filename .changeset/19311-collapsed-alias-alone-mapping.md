---
"@objectstack/spec": patch
---

`ObjectFieldGroup.collapsed` — the deprecated alias's `describe()` now states what the key maps to **on its own**, so the published reference page no longer leaves an author to guess whether `collapsed: true` also needs `collapsible` beside it (#19311).

`collapse` (ADR-0085) replaced the `collapsible` / `collapsed` boolean pair, and `ObjectSchema.parse` still folds the old pair onto it. That mapping has always been total — a group authored `collapsed: true` and nothing else parses to `collapse: 'collapsed'`, which the enum's own describe spells out as *collapsible, starts closed* — but the alias's describe said only `` Boolean pair with `collapsible`; use the `collapse` enum. ``, and that sentence is what `content/docs/references/data/object.mdx` publishes. The sibling `defaultExpanded` already spelled its mapping out (`true → 'expanded', false → 'collapsed'`); these two aliases did not.

Measured against the built package, `ObjectSchema.safeParse` on one field group:

| authored on the group | `collapse` after parse |
| :--- | :--- |
| `collapsed: true` | `'collapsed'` |
| `collapsed: false` | `'none'` |
| `collapsible: true` | `'expanded'` |
| `collapsible: false` | `'none'` |
| `collapsed: true` + `collapsible: false` | `'collapsed'` — `collapsed` outranks |
| an explicit `collapse` | wins; the aliases are not read |

- **Text only.** No key is added, removed or re-typed, no accept set moves and the normalizer is untouched: the nine probe inputs above parse to the same nine results before and after.
- **`collapsible`'s own describe is left unchanged** and still carries the mirror-image silence about what `collapsible: true` alone means (`'expanded'`). It is reported rather than ridden along on a card that names `collapsed`.
- **This is the object-level `fieldGroups` pair only.** The form-view `sections[].collapsible` / `sections[].collapsed` pair is a different, non-deprecated surface with no alias mapping behind it, and nothing here touches it.
