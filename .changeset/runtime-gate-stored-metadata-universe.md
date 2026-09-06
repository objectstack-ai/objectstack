---
"@objectstack/metadata-protocol": patch
---

A dashboard bound to a dataset you just saved now publishes, without restarting the runtime.

The author-time gate that runs on every `active` metadata publish resolves a widget's `dataset` (and a `type: 'page'` view's `pageName`, and the sibling collections the cross-collection security rules compare against) against a resolution universe the host gathers per write. That gather read the SchemaRegistry alone. The registry is filled at boot by code packages, and for every metadata type except `object` a runtime write does not reach it — so a dataset saved through `PUT /api/v1/meta/dataset` was invisible to the gate until the process restarted, while `GET /api/v1/meta/dataset` returned it in the same instant with `_diagnostics.valid: true`.

Measured on the reported shape, in one process with no restart between the steps: the row is in `sys_metadata`, the read API lists six datasets, the registry lists the five code-package ones, and a three-widget board bound to the new dataset was refused `422` with three `widget-dataset-unknown` issues whose hint enumerated every dataset except the one just authored. The same request answered `200` after a restart, nothing else changed.

The gather now folds the stored half onto the registry half for every collection it carries. What that does and does not do:

- **Additive.** A stored row contributes a name the registry does not already carry and never displaces a registry entry — an object's registry copy is its resolved schema (base plus `extend` contributors) and a raw `sys_metadata` row is the base layer alone, so replacing it would trade this phantom for a subtler one. Where an org overlay redefines a code-package item, the gate still judges that item's content from the registry's version.
- **Active rows only.** A draft does not resolve. The refuse-at-publish ruling exists so an author can write the widget first and the dataset second; a draft dataset that satisfied a published board would invert it.
- **Scoped to the write's own partition** — environment-wide rows plus, when the write has one, its own organization. No other organization's overlays are visible to the gate, on any kernel.
- **A failed store read is reported, not swallowed.** Context gathering still never fails a write, but a read that fails for any reason other than an unprovisioned `sys_metadata` now says so once, naming the consequence — a gather that silently shrinks is how a phantom refusal is manufactured in the first place.

The rules themselves are unchanged: a reference that resolves in neither home is still refused, with the same code, status and key path.
