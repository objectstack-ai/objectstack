---
"@objectstack/spec": patch
---

docs(spec): `manifest.runtime` trust-tier text states publish-gate-only enforcement truthfully (#11330)

Text-only correction on a published spec surface. **No schema shape, no
accept/reject behaviour, and no generated accept-set changes** — `runtime` still
accepts `node` / `sandbox` / `worker` and still may be unset, pinned in
`plugin-runtime-tier-truthful-text.test.ts` and confirmed by a green
`check:authorable-surface` (the authorable-surface products are byte-identical).

`manifest.loading`'s tombstone told every upgrading author, verbatim, that
`loading.sandboxing` "never isolated anything … If you were relying on it for
isolation, you had none — use the plugin trust tier (`manifest.runtime`) and the
permission declarations, **which are enforced**". Measured, that redirection
pointed at a key this repo does not enforce at all: nothing dispatches on the
tier — its only reads are two CLI progress lines that echo the value, and the
QuickJS runner under `packages/runtime/src/sandbox/` is the hook/action
*script-body* sandbox, never reached from a plugin's declared tier. An author who
followed the prescription got the same nothing they were being warned about, one
key over: ADR-0049 false compliance with a shipped migration message attached.

The honest statement is a **split**, and the corrected text now carries both
halves everywhere the claim ships:

- **Enforced at the cloud marketplace publish gate** — an unverified publisher
  requesting the `node` tier is hard-rejected (HTTP 422) and forced to manual
  review. That gate is a real consumer, which is why the key is **not** retired.
- **Not enforced at load** — load-side enforcement is not implemented, so a
  locally installed plugin is not isolated by the tier it declares. `sandbox` and
  `worker` name the isolation the publish gate assumes, not isolation the loader
  applies.

Corrected in all four places the claim is published: the `loading` tombstone
prescription, the `PluginRuntime` enum describe, the `manifest.runtime` field
describe, and the ADR-0087 D3 entry `plugin-manifest-loading-retired` (which
renders into `docs/protocol-upgrade-guide.md` — fixing only the schema would have
left the upgrade guide still calling the tier a surface "the platform actually
enforces"). The `packages/spec/liveness/` ledger row and README narrative are
brought to the same reading.

Maintainer ruling 2026-08-30 (option **B now**): say it truthfully first.
Enforcing the tier at load is option **A**, tracked as a v18 direction and
deliberately not built here. Retirement (option **C**) was ruled out. ⚠️ The
**permissions** half of that same tombstone sentence — "and the permission
declarations, which are enforced" — is preserved **verbatim** and rides with
#11333 per the ruling's coordination pin; a pin test asserts it is untouched so
the handoff is visible rather than silent.

<!-- adr-0087: not-required (no-migration-prescription) Nothing is removed, renamed or re-shaped: the accepted value set of `manifest.runtime` is byte-identical and the `loading` tombstone it corrects is already a registered retirement (`plugin-manifest-loading-retired`, whose own prescription text this change fixes in place). There is no key for `objectstack migrate meta` to rewrite — the defect was a false claim in guidance, and the channel that reaches an affected author is the corrected guidance itself, at the same parse site and the same upgrade-guide entry that carried the wrong version. -->
