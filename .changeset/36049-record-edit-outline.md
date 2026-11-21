---
'@object-ui/components': patch
'@object-ui/app-shell': patch
---

fix(record-page): the record header's Edit is an outline button, and the desktop header row is one height, 28

Clause-②: no
Metadata-protocol: none

On a record whose object declares no header action of its own, the host's Edit was drawn as the page's one filled button, 36 high, louder than the record's name, though the record's fields already edit in place. It is now an outline button everywhere in the header row, in the record page and in the record drawer alike. What Edit does when pressed is unchanged.

- **The page's own actions keep their faces.** An action declaring `variant: 'primary'` is still the filled button; with none, the first page action still is. The record edit state's Save stays filled.
- **One row height.** On desktop every button in the record header row is 28 high: Edit, the page's own actions, the `⋯`, the approval levers a record under approval shows there, and the trailing panel toggles (32 before). `page:header` is a shared block, so a custom page's header actions get 28 too. An action that declares its own `size` keeps it.
- **Phones unchanged.** The phone's bottom action bar still draws Edit filled at 44, and the phone header rows keep 36.
