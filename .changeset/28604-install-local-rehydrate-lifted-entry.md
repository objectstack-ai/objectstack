---
'@objectstack/cloud-connection': patch
---

fix(cloud-connection)!: install-local judges a ledger entry stored in the CLI's lifted shape through the install door's flatten, at the boot rehydrate and on the sample-data doors (#28604)

Clause-②: no (narrowing) — at `kernel:ready` the install-local rehydrate no longer loads, and `POST /api/v1/marketplace/install-local/:manifestId/reseed-sample-data` and `/purge-sample-data` answer 422 `OS_PROTOCOL_INCOMPATIBLE` for, a ledger entry written by an install before #28535 in the body `os package install <file>` sends (`id` and `version` lifted beside a nested `manifest`) whose nested `engines.protocol` excludes this runtime. Such an entry loaded and those doors acted on it before. A flat entry with the same range was already refused the same way. Nothing is widened.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type changes: the rehydrate's existing ADR-0087 handshake, its ADR-0141 D5 dependency order and the sample-data doors' handshake now read a lifted ledger entry through the flatten the install door already uses, as they already read a flat entry. The refusals are the existing shared answers, so there is nothing for a migration to rewrite. -->

**BREAKING** boot-load and accept-set narrowing for already-ledgered install-local entries (`@objectstack/cloud-connection`): the `kernel:ready` rehydrate and the two sample-data doors, reached by a deployment where `os package install ./dist/objectstack.json` ran before #28535.

An install before #28535 ledgered the CLI's body unflattened, so the entry's `engines` and `dependencies` sat one level down, and the rehydrate and the sample-data doors judged `engines.protocol` at the top: an entry built for another protocol was re-registered at every boot with no error. They now read the entry through the install door's one flatten (`flattenPackageBody`), and the rehydrate orders entries by the dependencies they nest too. Such an entry gets exactly what a flat entry with the same range gets: it is not loaded, one error line names the code, the package and the remedy, the listing marks it `notLoaded`, and DELETE or a compatible reinstall still act on it. A compatible lifted entry rehydrates exactly as before, registering the body as it was ledgered.
