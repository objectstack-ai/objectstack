---
'@objectstack/types': patch
'@objectstack/plugin-sharing': patch
'@objectstack/runtime': patch
'@object-ui/console': patch
---

fix(share-links): the share-link page names the shared object by its label in the reader's language and no longer lists the fields the object hides

Clause-②: yes (widening)
Metadata-protocol: none

`GET /api/v1/share-links/{token}/resolve` answers two more facts, on both of its mounts (the sharing plugin's route and the runtime dispatcher's `/share-links` domain):

- `link.object_label` — the shared object's label in the request's locale: the request's `Accept-Language` top tag, else the i18n service's default locale, translated the way `GET /meta/object/NAME` translates it (the translation bundle over the declared `label`, with the deployment's fallback locale and authored language). With no i18n service, or no bundle entry for that locale, the declared label is served. An object that declares no label carries no `object_label`.
- `fields[NAME].hidden: true` — for a field the object declares hidden, including the injected scope and queue columns, which are hidden at their source. A field that is not hidden carries no `hidden` key.

`ShareLinkResolvedLink` and `ShareLinkFieldDisplay` (`@objectstack/types`) gain the two optional keys, and `buildShareLinkResolveAnswer` takes an optional fourth argument with the request's `Accept-Language` value and the i18n service. `registerShareLinkRoutes` (`@objectstack/plugin-sharing`) takes an optional `i18n` resolver, which `SharingServicePlugin` wires to the kernel's i18n service.

The console's share-link page (`@object-ui/console`) titles the page with the label ("Shared Client Brief"), falling back to the object's name from a server that does not send one, and leaves off every field the answer marks hidden, as the record page does. Its resolve and messages requests state the console's UI language as `Accept-Language`, so the label arrives in the language the rest of the page is in.

Nothing to migrate: a caller that reads neither key is unaffected.
