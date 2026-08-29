---
"@objectstack/plugin-security": patch
---

fix(plugin-security): report the two swallowed `tryUpdate` refusals outside the catalog seed (#12970)

Both sites call the shared `tryUpdate` in `permission-set-projection.ts`, which
answers `false` on refusal. That answer is byte-identical to "nothing to do",
and neither caller passed the optional refusal log the helper already accepts —
so a refused write was indistinguishable from a clean pass.

**`permission-set-drift.ts` — a refused diagnostic write silenced its own
report.** `persistPermissionSetDriftDiagnostics` counted only the writes that
landed, and `runPermissionSetDriftDiagnostics` reported only when that count was
non-zero. A boot on which every drift write was refused computed the drift
correctly, persisted none of it, and printed nothing at all — indistinguishable
from a deployment with no drift, while the sets kept enforcing grants that
differ from the shipped artifact. The pass now records refusals, answers a
`refused` count beside `updated`, reports them once per pass on the durability
channel, and emits the drifted-set line when writes were refused as well as when
they landed. A steady-state boot (nothing to write, nothing refused) stays
exactly as quiet as before.

**`permission-set-overlay-discard.ts` — the audit line could describe a discard
that did not happen.** On the degraded-kernel branch the resync write's result
was discarded entirely. On refusal the row was re-read unchanged, so
`objectGrantsAfter` equalled `objectGrantsBefore` while the `info` entry still
announced a completed "sanctioned operator action": every field individually
true, the entry as a whole false. The result is now read, and a refused resync
emits one entry stating what did and did not land — the overlay row deletion
(which had already succeeded) and the refused resync, with the un-healed grant
count named as such — **instead of** the success line, never alongside it.

Both new lines go through the shared durability channel with its mandatory
`warn` fallback, so they still print against a host sink that has no `error`.
They reuse the shared refusal *accumulator* (`createSeedWriteRefusals`, with its
cross-dialect classification and value-free driver-code channel) but not
`reportSeedWriteRefusals`, whose prose is specific to seeding the RBAC catalog
and would misdiagnose either of these paths.

No API is removed or narrowed. `persistPermissionSetDriftDiagnostics` and
`runPermissionSetDriftDiagnostics` answer one additional field (`refused`), and
what `discardPermissionSetOverlay` returns to its caller is deliberately
unchanged.
