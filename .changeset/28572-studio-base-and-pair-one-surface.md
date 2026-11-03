---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(studio): a read-only base and its `<base>.custom` pair as one surface, with "customized" and "added" marks, an only-customizations filter, and New landing in the pair

Clause-②: no
Metadata-protocol: none

Studio now shows a read-only package and its paired customization package (`<base>.custom`, ADR-0146 D3, "On top, one surface") as one surface. The pair no longer looks like a second package beside its base.

- **One list per pillar.** The Data, Automations, Access and Interfaces rails list the base's items, then each item of the pair whose name the base does not hold. An override the pair serves under the base's name stays the base's row.
- **Marks.** A row the base's customization read (`GET /api/v1/packages/:id/customizations`) lists as an override is marked "customized". Any other row of the pair is marked "added". Every other row carries no mark. ⛔ Nothing is computed from the documents. A failed read marks nothing and says why.
- **Only customizations.** Each rail gets an "Only customizations (n)" toggle, shown once a row carries a mark. On the Interfaces rail it lists every marked page, dashboard, report and view in place of the navigation tree, including the ones a nav entry opens.
- **Package switcher.** The pair has no row of its own. Its base's row names it ("with `<pair>`"). A pair whose base is not listed keeps its row.
- **The pair's URLs.** A pillar URL of the pair (`/studio/<pair>/<pillar>`) lands on the base's surface, with its query and state kept. A `?surface=` link to an item the pair adds opens that item once the pair is known. The pair's "All metadata" URL (`/studio/<pair>/metadata`) is not redirected, because the area lists the pair's items there and the redirect would loop.
- **Items the pair adds** open writable on the base's surface. They are read and saved at the pair they were listed in, as the items they are. They declare no override. Their item header names the pair ("In `<pair>`").
- **New on a read-only base** goes in the pair. It calls `POST /api/v1/packages/:id/ensure-customization`, then saves into the package that answer names. ⛔ A create never names a `.custom` id spelled in the browser. On Interfaces, a new page, dashboard or report links no nav entry, because the base's app takes no edit. The "+" offers only those three kinds there. A walled admin is offered no New.
- **Not drawn.** Items another package contributes to the base (fields extending its objects, flows on its objects, ADR-0029 D7 navigation entries) are not drawn. No served read names the package that contributes them (objectstack#28722).
- **Unchanged.** A writable package, and a read-only base with no pair, read and draw as before. Customized items keep the objectstack#28562 Customize path.
- **New strings.** `@object-ui/i18n`'s studio namespace gains five keys in `en` and `zh` (`engine.studio.customize.addedIn`, `engine.studio.customize.addedInTitle`, `engine.studio.pkg.withPair`, `engine.studio.if.addInPairTitle`, `engine.studio.interfaces.create.descriptionInPair`). The other languages fall back to `en`, as the whole namespace does.
