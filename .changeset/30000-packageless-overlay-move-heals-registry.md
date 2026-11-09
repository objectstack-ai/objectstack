---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): `os migrate packageless-overlays --apply` heals the registry after it deletes the unbound row, as the delete door does

Clause-②: no
Metadata-protocol: none

- **Now.** After the ceremony saves a row into its base's `<base>.custom` pair and reads it back, it deletes the unbound row through the protocol's one repository and then runs the delete door's registry heal for an active row. The unbound row's registration leaves with the row, and the pair's row is registered again, so the process serves what a restart serves. Before, the delete went through a second repository and no heal followed, so the unbound row stayed registered beside the base's entry until the next restart. The five reads of the item already served the pair's row, so no read answered differently.
- **Unchanged.** A draft row's removal heals nothing, as a draft discard does not. Outcomes, receipts and the rows written are the same.
