---
'@objectstack/objectql': patch
---

fix(objectql): a standalone action saved at runtime with `objectName` is listed on the object it names

Clause-②: no
Metadata-protocol: none

A standalone `action` saved through the metadata door (`PUT /api/v1/meta/action/NAME`, Studio, or an AI author) with `objectName` set was stored and could be run, but no served object listed it: `GET /api/v1/meta/object/OBJECT` and the object list left it out of `actions`, so no record header, list toolbar or other object surface showed it. The registry attached bound actions to their object only when a code package shipped them.

Now every bound action the registry serves is attached, whoever authored it:

- **Runtime-authored actions appear on their object.** After the save, the object's served `actions` list the object's own actions first, then the bound ones, ordered by `order`. A re-save serves the new body, and a delete takes it off the object at once.
- **A customised action replaces the packaged one.** Where a stored row overlays a packaged bound action of the same name, the object lists the stored version, the one the action route already runs.
- **Boot checks are unchanged.** A runtime action naming an object that does not exist is listed nowhere and does not fail the boot. Only code-shipped actions are checked against their target at boot.
