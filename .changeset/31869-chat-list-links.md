---
'@object-ui/plugin-chatbot': patch
'@object-ui/i18n': patch
---

feat(ui): a chat answer can link the list it counted, and a list link whose filter names a field the reader cannot filter on opens without it, with a notice

Clause-②: yes (widening)
Metadata-protocol: none

An assistant answer can now name a list with a second fixed link form beside `/record/OBJECT/ID`: `/list/OBJECT`, optionally with `view=VIEW` and `uf__filter=` the percent-encoded Filter panel envelope `{"logic":"and"|"or","conditions":[{"field","operator","value"}…]}` (each condition one spec `ViewFilterRule`). The form is closed: any other query key, a repeated or empty one, a fragment, or a filter that is not that envelope keeps the default link-safety dialog. `ChatbotEnhanced` takes a new optional `onOpenList({ objectName, view?, filter? })`; without it a list link keeps the dialog. The Console's AI chat wires it: it resolves the object's app and builds `/apps/APP/OBJECT?view=…&uf__filter=…` from the parsed values, never forwarding the link's own query string.

On the Console list, a link's `uf__filter` is now judged whole: if any condition names a field the object does not declare or the reader cannot read (once permissions are loaded), or one the spec's rule schema refuses, the list opens on the view's own filter, the address bar loses `uf__filter`, and a notice says why (new key `console.objectView.linkFilterRefused` in every locale). Before, only that condition was dropped, silently, so the list answered a wider (AND) or narrower (OR) question than the link asked. The reader's own stored filter keeps its per-condition drop.
