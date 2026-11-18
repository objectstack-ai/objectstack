---
'@objectstack/mcp': patch
---

fix(mcp): the `objectstack://objects` resources serve labels in the locale the object tools speak

Clause-②: no
Metadata-protocol: none

Over the stdio transport, the `objectstack://objects` and `objectstack://objects/{name}` resources now answer an object's label, description, field labels, field descriptions and option labels in the workspace's default locale, as `list_objects` and `describe_object` have since the object tools were localized. Before, the resources served the authored text, so a resource read and a tool call for the same object could name it in two languages.

- The resources read the same localized view the two tools read, through the same translation the HTTP door's `/meta` answers use. A resource read and a tool call for one object answer the same labels.
- A field the caller cannot read stays absent from the resources, its translated text with it.
- With no default locale, or a key the bundle does not carry, the authored text is served, as before. Names never change.
- The Streamable HTTP door registers no resources, so nothing changes there.
