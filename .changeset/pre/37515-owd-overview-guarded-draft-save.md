---
'@object-ui/app-shell': patch
---

fix(app-shell): the Studio sharing-defaults overview's Save no longer overwrites, or publishes unseen, a draft saved elsewhere since the page loaded

Clause-②: no
Metadata-protocol: none

The overview of every object's org-wide sharing default (Studio → Access) now writes each changed object's draft the way the Studio editors do: pinned to the draft its load read, at the package the save writes. A draft another writer (a copilot, another admin, another tab) saved after the load is no longer replaced by the Save, and a draft that appeared after the load is no longer published live under the author's Save without the unpublished-draft mark ever being shown: the draft save is refused and the conflict dialog asks to reload the saved draft, overwrite it with the author's version after a confirmation, or keep editing. An object whose draft the server will not let this session read is not saved over that draft; the Save names it. An object kept unsaved stays pinned to the reads its edit was made on, and a re-read of the table that a later one overtakes installs nothing. Against a server that serves no draft version, the draft save goes unpinned, as before.
