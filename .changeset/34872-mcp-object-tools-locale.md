---
'@objectstack/runtime': patch
'@objectstack/mcp': patch
---

feat(mcp): `list_objects` and `describe_object` serve labels and descriptions in the caller's locale

Clause-②: no
Metadata-protocol: none

The two MCP object tools now serve the object's label and description, and each field's label, description and option labels, in the caller's locale, the way the REST `/meta` object door serves them. Before, both tools served the authored text in every locale. A client asking in Chinese about an app with a Chinese translation bundle was shown the English labels.

- **HTTP:** the locale is the request's `Accept-Language` (then `?locale=`, then the i18n service's default), read and translated by the `/meta` door's own routine. The dataset tools already used the same routine.
- **stdio:** the transport carries no request, so the locale is the i18n service's default. The stdio `list_datasets` already uses that locale.

Translation runs on the object as the caller is served it, after the field mask, so a field the caller cannot read stays absent and so does its translated text. Names and option values never change. Where the bundle has no entry for a key, or no i18n service is registered, the tools serve the authored text. Without `Accept-Language`, the HTTP tools now serve the i18n default locale's bundle entries, as the REST door does. An app whose `en` bundle relabels a field (app-crm's `amount` is "Deal Value") shows that label there.

The answer's shape is unchanged. Validation rule messages are translated by the same routine where the bundle carries them.
