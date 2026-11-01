---
'@objectstack/spec': minor
'@objectstack/runtime': patch
'@objectstack/client': patch
'@object-ui/app-shell': patch
---

feat(runtime)!: the flow clone door is "new similar" — the copy lands switched off in a writable package, by default the source's paired `<base>.custom`, never package-less (#28149)

Clause-②: yes (narrowing) — `POST /api/v1/automation/:name/clone` accepts a new optional `package` member and answers a new `packageId` member (the copy's package, beside `flow` and `notice`), and a request it accepted before is now refused: a clone of a flow no read-only package ships, sent with no `package`, is refused `400` where it was written package-less.
Metadata-protocol: added — `CloneFlowRequestSchema` and `CloneFlowResponseSchema` are new authorable API schemas in `@objectstack/spec/api` (the `authorable-surface/api.json` shard gains them), and the request's `package` member is a new key a caller can write. No existing key is removed, refused or changed in meaning.

<!-- adr-0087: not-required (no-migration-prescription) No key of any existing schema is removed, renamed or re-shaped and no stored metadata changes: the door's request body gains one optional member and its answer one, and a copy written before this change stays where it is. The remedy for the newly refused request is the request's own (name the writable package with `package`), so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** request narrowing at the flow clone door (`@objectstack/runtime`'s `/automation` domain), per ADR-0146 D3/D4.

- **Before.** The clone door wrote the copy as a package-less environment row with `status: 'draft'`, which the engine arms like `active`, so a copy of a record-triggered flow ran beside its source as soon as it was saved.
- **Now.** The copy lands in a writable package and is written switched off (`status: 'obsolete'`, the value Studio's Enabled switch writes for Off). With no `package`, the target is the source package's paired customization package `<base>.custom`, ensured through the protocol's ensure door (the one creation path of the pair). With `package`, the target must be installed and writable (`422 WRITABLE_PACKAGE_REQUIRED` otherwise) and depend on the source's package (`409 RESOURCE_CONFLICT` otherwise). Every refusal is answered before anything is written. The save is a first write, so a name the target package already holds is refused `409 RESOURCE_CONFLICT` instead of overwriting it. The answer is `{ flow, packageId, notice }`, and the notice says the copy is switched off.
- **Unchanged.** The whole-definition copy, the mandatory new name and label, the credential refusal, the walled-environment refusal and the absence of clone lineage.
- **New surface.** `CloneFlowRequestSchema` and `CloneFlowResponseSchema` (`@objectstack/spec/api`), the SDK's `client.automation.clone(name, { name, label, package? })`, and the route ledger row now `sdk` with both schemas named. Setup's "Open the clone in Studio" link opens the copy in the package the answer names.
- **Who sees it.** A client that clones a flow authored in the deployment (or in a writable package) without naming a package; and anything that read the copy's `status` as `draft`.

**The remedy.** Name the writable package the copy lands in with `package`. To have the copy run, switch it on (`POST /api/v1/automation/:name/toggle`, body `{enabled: true}`).
