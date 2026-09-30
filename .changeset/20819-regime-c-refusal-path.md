---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): the refusal of an in-place edit or removal of a packaged flow names the clone and the on/off switch, not a redeploy or `OS_METADATA_WRITABLE` (#20819)

Clause-②: no

A write or removal that targets a flow shipped by a code package, and does not name that package, is refused with `403 NOT_OVERRIDABLE`. That covers `PUT /api/v1/meta/flow/:name` without `?package=`, `DELETE /api/v1/meta/flow/:name`, `PUT` and `DELETE /api/v1/automation/:name`, and `POST /api/v1/automation` onto a packaged flow's name. The refusal used to say "Edit the source artifact and redeploy, or set OS_METADATA_WRITABLE to grant a runtime escape hatch", and cited ADR-0005. The administrator of an installed package can do neither.

The refusal now names the two paths ADR-0126 sanctions for a packaged flow, and cites ADR-0126:

- clone it under a new name to customize it: `POST /api/v1/automation/:name/clone` with `{ name, label }`;
- or switch it off: `POST /api/v1/automation/:name/toggle` with `{ enabled: false }`. Where one install serves several organizations, only the platform operator can use the switch.

The status, the code and which writes are refused are unchanged. `OS_METADATA_WRITABLE=flow` still opens the lock as before; the refusal just no longer suggests it. Every other metadata type's refusal reads exactly as before. A write that names the shipping package with `?package=` is refused with `403 ITEM_LOCKED` by a separate limb, which this change leaves as it was.
