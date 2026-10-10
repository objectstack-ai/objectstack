---
'@objectstack/spec': patch
---

A locale bundle's page `label` no longer replaces a `page:header` title that says something else, such as a dynamic `'{name}'`

Clause-②: no

`translatePage` resolved a root-level `page:header` title as the bundle's `pages.<name>.title`, else the bundle's `pages.<name>.label`, and wrote it over whatever the header authored. A pack that translated the page label and left out the title therefore turned a record page's `'{name}'` heading into the page's static name in that locale, with no warning at build, lint or serve.

The header title now resolves in this order, at a region root and a `slots.<slot>` root alike:

1. the bundle's `pages.<name>.title`;
2. the title the header authors (a template, a plain string or an inline locale map), left as written;
3. the bundle's `pages.<name>.label`, only where the header authors no title, or where its title restates the page's own `label`. That second case is the one `os i18n extract` already covers by offering `label` alone, so those headers keep their translation.

The doors that serve the translated page are `GET /api/v1/meta/page/:name` and `GET /api/v1/meta/page`, through `translateMetadataDocument('page', …)`, and the console reads them. What changes for an author: a header whose title differs from the page label, in a locale whose pack carries `label` but no `title`, now shows the authored title. To translate that header, add `pages.<name>.title` to the pack (`os i18n extract` offers that key for such a header). No schema, key, accepted value or export changes. The `pages.<name>.title` describe and the reference page now state this order.
