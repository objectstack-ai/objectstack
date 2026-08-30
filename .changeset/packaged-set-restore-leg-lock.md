---
'@objectstack/plugin-security': patch
---

Extend the packaged-permission-set lock ("lock the base, clone to customize", 2026-08-24 ruling) to the `restore` leg of the permission-set write-through — the one write point that did not consult it. The leg now checks provenance before re-authoring a restored record's definition into metadata: a package-declared name (or one whose provenance cannot be resolved — fail-closed) has its re-author refused and the refusal reported loudly on the durability channel, while the engine's un-trash stands (this leg runs after it and deliberately never throws). With the mint refused, boot reconciliation re-projects the declared body, so the environment converges to the package truth instead of a silent fork. Org-owned sets restore exactly as before.
