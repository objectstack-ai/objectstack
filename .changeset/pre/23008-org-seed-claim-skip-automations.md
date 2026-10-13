---
'@objectstack/organizations': patch
---

The organization seed ownership claim no longer fires app hooks or record-change flows

Clause-②: no

When an organization's owner is established (for example, `ensureDefaultOrganization` binding the platform admin as the default organization's owner), `claimOrgSeedOwnership` hands that organization's owner-less seeded rows to the owner. That write ran under a bare system context, so every claimed row went through the full write pipeline: hooks bound from app metadata fired, record-change flows ran, and the approvals and notifications those flows start went out for a bookkeeping write. The single-tenant claim, `claimSeedOwnership` in `@objectstack/plugin-security`, already wrote without automation; the organization claim did not.

The claim's write now runs with `{ isSystem: true, skipAutomations: true }`, the same context the single-tenant claim uses.

- **App hooks no longer fire for the organization seed ownership claim.** No hook bound from metadata runs on the claim's owner change, and no record-change flow is dispatched for it, so the claim opens no approval and sends no notification.
- **Still runs.** Hooks that plugins register in code still run on every claimed row: the audit writer, capability gates and the sharing projection. Every claimed row's `owner_id` is the organization owner, as before.
- **The read is unchanged.** The claim's per-object read is still a plain system read.
- **If an app relied on it.** An app hook or flow that reacted to the claim's owner change no longer sees it, just as it never saw the seed's own writes.
