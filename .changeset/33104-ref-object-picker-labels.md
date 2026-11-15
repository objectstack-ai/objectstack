---
'@object-ui/console': patch
---

fix(console): the Studio All-metadata object-reference picker offers objects by label

Clause-②: no
Metadata-protocol: none

On an All-metadata form, the object-reference select (for example Page → Object on Create new) listed every object by its bare machine name. Each option now shows the object's label first, with the machine name after it in small monospace text, the way the flow trigger Object picker and the Lookup Related object picker already show an object. An object that declares no label is shown by its name, once. The labels come from the object list the form already reads, so no extra request is made, and the value saved is still the machine name.
