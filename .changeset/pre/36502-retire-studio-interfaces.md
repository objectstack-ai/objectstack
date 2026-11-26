---
'@objectstack/runtime': patch
'@objectstack/cli': patch
'@object-ui/i18n': patch
'@object-ui/plugin-chatbot': patch
---

fix(studio): Studio's Interfaces column is retired; its old links land on the Studio home and its Changes links open from the Data pillar

Clause-②: no
Metadata-protocol: none

objectstack#36502. Menus, header actions, list views, dashboards, reports and record pages are designed in the running app. Studio keeps Data, Automations, Access and All metadata, and every view, dashboard, report and page stays readable and editable as metadata on its All-metadata item page. No metadata type, key or stored shape changes.

- **Old links still open.** `/studio/<package>/interfaces`, with or without a `?surface=` deep link, lands on the package's Data pillar and says once, there, "Interface edits have moved into the app" (「界面的修改已经搬到应用里」) with a link back to the app. A `?changes=review` request travels with it.
- **`@objectstack/runtime`, `@objectstack/cli`.** The review link the MCP authoring tools and `os meta register --draft` print is `/studio/<package>/data?changes=review` (it was `/studio/<package>/interfaces?changes=review`, which still works through the redirect).
- **`@object-ui/i18n`.** Adds `engine.studio.interfacesRetired.sentence`, `.backToApp` and `.dismiss` (en, zh).
- **`@object-ui/plugin-chatbot`.** The `onDesignBuiltApp` doc example names the Data route.
- The console's "Edit in Studio" links for a dashboard, page, report or view open its All-metadata item page.
- **Customize moves with them.** On a read-only base, a view, dashboard, report or page is customized on its All-metadata item page, in the type's designer, into the base's pair (`<base>.custom`), with the override mark and "Restore package original" as before. It was the Interfaces column's header.
