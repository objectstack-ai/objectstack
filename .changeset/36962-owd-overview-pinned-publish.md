---
'@object-ui/app-shell': patch
---

fix(app-shell): the Studio sharing-defaults overview's Save no longer publishes over a change another admin published since the page loaded

Clause-②: no
Metadata-protocol: none

The overview of every object's org-wide sharing default (Studio → Access) publishes each changed object over the published row its load read, as the object page and the extension, hook, action and flow editors already do. When another admin published the same object between the load and the Save, that object's publish is refused and the conflict dialog asks: reload the live value, overwrite it after a confirmation, or keep editing. The other changed objects in the same Save are published as before; an object kept unsaved stays pinned to the row its edit was made on, so the next Save asks again. Against a server that serves no published version, the publish goes unpinned, as before.
