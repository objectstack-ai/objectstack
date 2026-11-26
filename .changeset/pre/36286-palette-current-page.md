---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(console): the empty ⌘K palette leads with a "Current page" group: the page's favorites entry

Clause-②: yes (widening) — one new published language-pack key, in all eleven packs: console.commandPalette.currentPage
Metadata-protocol: none

Opened with nothing typed, the command palette inside an app now starts with a "Current page" group, above the recently viewed records, when the page behind it is an object's list or a record page:

- **On an object's list** (`/apps/APP/OBJECT`, or one of its views): "Add to favorites" (or "Remove from favorites"), the list's own favorites entry from its ⋮ More menu. It pins the app's navigation entry for the list where the app has one, and keeps an object favorite otherwise, exactly as that menu does.
- **On a record page**: the record's star — the same `record` favorite the star beside the record's name toggles, named by the title the record was last visited under.

The row is first, so Enter on the empty palette now runs it; the footer says so ("Add to favorites ↵" / "Remove from favorites ↵", the menu's own words). Typing takes the group away. On every other page (an app's landing, a dashboard, the search page, a create form) the palette is unchanged. Which records the palette searches and how it ranks them, the full search page, and the phone's search are unchanged.

New locale key, in every pack: `console.commandPalette.currentPage`. No props or package exports change.
