---
'@object-ui/app-shell': patch
---

fix(app-shell): a list view or interface page whose `label` is an inline locale map is named in the viewer's language, and a map view label no longer takes the Console down

Clause-②: no
Metadata-protocol: none

- **View labels.** `ListViewSchema` types a view's `label` as `I18nLabel`, and the server overlays only catalog text, so a map with no `_views` catalog entry reaches the Console as authored. `viewTabLabel` returned that map untouched. The app header then rendered it as a React child on a `/view/NAME` route and threw. The header sits outside the route's error boundary, so the whole Console went blank. The object page's tab bar, the mobile view switcher and the record page's way back read the same value. `viewTabLabel` now resolves the map in the viewer's language first, so all of them draw a string. A map that resolves to no text is drawn as the object's plural label, like a view with no `label`.
- **Interface list pages.** A page whose `label` is a map showed its machine name as the heading and as the record drawer's title, and a map `description` was dropped. Both now resolve in the viewer's language. The machine name is used only when no label resolves.

What to do: nothing. Metadata that already carries inline locale-map labels now renders as authored.
