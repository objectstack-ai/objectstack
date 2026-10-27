---
'@object-ui/console': patch
---

fix(console): the standalone `/forms/:name` route shows select option labels in the language the user chose

Clause-②: no
Metadata-protocol: none

- **Before.** A user whose chosen language differed from the browser's (a zh-CN user on an en-US browser) saw the form's field labels in their language and every select option in the browser's. The route read the form view, the object schema and the record with a bare `fetch`, so the server localized the schema, option labels included, by the browser's `Accept-Language`.
- **Now.** The internal form route (`/forms/:name` and `/apps/:appName/forms/:name`) sends its API requests through the console's authenticated fetch, the same channel the in-app record form (`?form=ID`) reads the object schema over. That fetch sends the session's language as `Accept-Language`, so the server answers option labels in the language the user chose. An option the translation bundle does not cover keeps its authored label. No second translator is added.
- **Unchanged.** The public anonymous form `/f/:slug` keeps its bare `fetch`.
