---
'@object-ui/app-shell': patch
---

fix(app-shell): the Studio sharing-defaults overview's Save no longer publishes over a change another admin published since the page loaded

Clause-②: no
Metadata-protocol: none

The overview of every object's org-wide sharing default (Studio → Access) publishes each changed object over the published row its load read, as the object page and the extension, hook, action and flow editors already do. When another admin published the same object between the load and the Save, that object's publish is refused and the conflict dialog asks: reload the live value, overwrite it after a confirmation, or keep editing. The other changed objects in the same Save carry on, each still published over the row its own load read, whichever answer an earlier object got, so a second object another admin changed is asked about too. An object kept unsaved stays pinned to the row its edit was made on, so the next Save asks again. An object reloaded is read back; when it had a draft pending before the Save, that draft is kept, now carrying the edit, and its next Save is asked again. Against a server that serves no published version, the publish goes unpinned, as before.
