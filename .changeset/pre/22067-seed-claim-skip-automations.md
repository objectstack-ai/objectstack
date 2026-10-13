---
'@objectstack/plugin-security': patch
---

The seed ownership claim no longer fires app hooks or record-change flows

Clause-②: no

On a freshly seeded database, the first sign-up promotes the first user to platform admin, and `claimSeedOwnership` hands every seeded row to that admin inside the same request. That write ran under a bare system context, so every claimed row went through the full write pipeline: hooks bound from app metadata fired, record-change flows ran, approvals opened on seeded records and notifications went to the new admin. Measured on hotcrm `56d98f7e` (17.7.0, a 354-row seed), the first sign-up took about 45 s, and in that time the claim fired 1,254 app hooks, ran 8 flows, opened 2 approvals and handed 8 emails to the transport.

The claim's write now runs with `{ isSystem: true, skipAutomations: true }`. The seed itself is end-state data written without automation, and the claim keeps that rule for the write that completes it.

- **App hooks no longer fire for the seed ownership claim.** No hook bound from metadata (an app's `hooks`, sandboxed bodies included) runs on the claim's owner change, and no record-change flow is dispatched for it. So the claim opens no approval and sends no notification.
- **Which claims.** Every pass of the claim: the promotion pass inside the first sign-up, and the pass that runs on `app:seeded` on every boot, the first and every later one.
- **Still runs.** Hooks that plugins register in code still run, so the claim still writes one audit row per claimed record (plugin-audit) and plugin-sharing still recomputes the grants the owner change earns. Every claimed row's `owner_id` is the admin and its `updated_at` still advances, exactly as before. The per-row hook ceiling and the paged fallback for very large objects are unchanged.
- **If an app relied on it.** An app hook or flow that reacted to the claim's owner change no longer sees it, just as it never saw the seed's own writes. None of the hooks or flows in ObjectStack's own example apps reads it.
