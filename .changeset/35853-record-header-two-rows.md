---
'@objectstack/spec': patch
'@object-ui/components': patch
'@object-ui/app-shell': patch
---

feat(record-page): the record's header is two rows — navigation over the record — and shows up to three actions again

Clause-②: no
Metadata-protocol: none

The record's top bar, on the full page and in the drawer alike, is now two rows:

- The navigation row (40 px). From a list: ↑ ↓ and 「第 N 条，共 M 条 · 视图名」 ("N of M · view"), M being the records the list matched; the view's name returns to the list. From no list (a link, a notification, a search): the object's name, linking to the object's list, and no ↑ ↓. ✕ sits at the far right in every case: on the page it returns to the list the page came from as it was left, else the object's default list; in the drawer it closes, with ⤢ (open the full page) before it.
- The record row (48 px): the record's icon, its name one size larger, its stage and approval tags, then who else is on the record and the managing package's badge (on the page they no longer float over the corner above the tabs), and at the right the record's buttons and ⊟.

The drawer shows ↑ ↓ and the count again (the drawer hid them since #35593). A phone keeps its one-row bar.

The header bar's default inline budget is 3 again (#35593 had set it to 1): what does not fit the bar's width folds into 「更多」 one action at a time, down to the primary, so a narrow drawer shows fewer. An authored `maxVisible` still wins, a phone still shows one primary action (its bottom bar holds the host's Edit and one more), and there is still one primary-coloured button at a time. The `page:header` `maxVisible` / `mobileMaxVisible` describe, the `pages.mdx` Default cell and the Studio designer descriptions say so.
