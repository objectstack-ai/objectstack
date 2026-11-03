---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(studio): draw the nav entries, fields and flows other packages contribute to a base greyed, with the contributing package

Clause-②: no
Metadata-protocol: none

Studio now draws on a read-only base the items other installed packages contribute to it. Before, it drew none of them, while the live app showed them all. The Interfaces tree of a base said "No items in this package" for a group that only other packages fill.

- **One reader.** Everything comes from the `contributions` of the base's customization read (`GET /api/v1/packages/:id/customizations`), the read the rails' marks already make. No second request is sent. Nothing is joined on names in the browser. The contributing package is named as the base is, by its id, from the package list.
- **Interfaces.** Each `nav` entry for the open app draws in its tree, greyed and labelled "from PACKAGE". It draws under the group it names when the app declares that group (`type: 'group'`, at any depth: the question the server's navigation fold asks), and at the top level otherwise. An entry naming a group the app does not declare says so in its tooltip. A declared group that holds only contributed entries no longer says "No items in this package". The served entry names the item's id and no label, so the row reads the id. A contributed entry is no nav entry of the base: it is never in the nav edit buffer and cannot be dragged, renamed or deleted. A click opens the contributing package's Interfaces pillar.
- **Data.** A contributed field is already served on the base's object (the engine merges every extension). The Form layout now marks its card, greyed with "from PACKAGE", and never as a drag source. Its properties open read-only, even where the pair could write a base field's display properties.
- **Automations.** Each contributed `flow` draws in its object's rail group, greyed with "from PACKAGE". An object that holds no flow of the base's gets a group of its own. A click opens the flow in the contributing package's Automations pillar.
- **Unchanged.** A writable package, a base whose read lists no contributions, and the contributing package's own surfaces draw as before.
- **New strings.** `@object-ui/i18n`'s studio namespace gains five keys in `en` and `zh` (`engine.studio.contributed.from`, `.navTitle`, `.fieldTitle`, `.flowTitle`, `.undeclaredGroup`). The other languages fall back to `en`, as the whole namespace does.
