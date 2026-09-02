---
"@objectstack/spec": minor
"@objectstack/plugin-auth": minor
---

feat(spec,plugin-auth): declare `plugins.admin` tri-state, and refuse an explicit `admin: false` beside effective SCIM at construction time (#13816)

**Behavior change** (maintainer ruling 2026-09-01, director batch #21 on #13816 — the
admin-amplification half split out of #13439 by the 2026-08-31 ruling).

Two halves of one coupling made honest:

- **Declaration.** `AuthPluginConfigSchema.admin` moves from
  `z.boolean().default(false)` to tri-state `z.boolean().optional()`, the same
  shape #13439 gave `scim` / `sso` / `ssoDomainVerification`. The materialized
  `false` could not distinguish "the author said nothing" from "the author
  declined the admin surface", and the runtime needs that distinction: absence
  means "effective SCIM decides" (SCIM provisioning forces the better-auth
  `admin` plugin on because SCIM's `active:false` deprovisioning path runs
  through admin ban/unban — ADR-0071), while an explicit value is the author's
  own answer. A parse path that materialized `admin: false` onto a silent
  document said the opposite of what the runtime does under SCIM.
- **Conflict refusal.** Effective SCIM (explicit `plugins.scim`, or
  `OS_SCIM_ENABLED` where the config leaves it unset) beside an explicit
  `plugins.admin: false` is now REFUSED loudly — at `AuthManager`
  construction, on `applyConfigPatch` (merged result), and at the lazy
  better-auth build for env vars that appear after boot. The error names both
  keys, the ADR-0071 coupling, and the two ways out: accept the admin plugin,
  or disable SCIM. Previously the explicit decline was honoured silently and
  SCIM was mounted with its deprovisioning path broken (every `active:false`
  ban attempt failing at runtime).

Unchanged, deliberately: an UNSET `admin` under effective SCIM still gets the
admin plugin forced on (the ADR-0071-backed coupling), and without SCIM unset
still means off — the `?? scimEffective` resolution keeps absent semantics
byte-identical. `resolveScimEnabled()` is now the single decision point shared
by the plugin mount, the advertised `/auth/config` features flag and the
conflict refusal, so the three can never disagree.

**Known risk, named:** a deployment already running the contradiction
(`plugins: { scim: true/env-on, admin: false }`) boots today with silently
broken SCIM deprovisioning; after this change it refuses to construct the auth
manager, with the remedy in the message. That loud stop is the ruled behavior.
Whether SCIM's admin dependency can instead be narrowed to the actions it
actually needs (Shape 1) is #14150's measurement; this refusal is the honest
floor pending that reading.

<!-- adr-0087: not-required (no-migration-prescription) The key is neither removed nor renamed — `admin` stays authorable with the same type; only its materialized default is dropped (declared in DEFAULT_CHANGES_BY_MAJOR under major 17) and one incoherent corner (explicit false beside effective SCIM) becomes a loud construction-time refusal whose message carries the remedy. Nothing mechanical for `objectstack migrate meta` to rewrite: a conflicted config needs a human decision between accepting the admin surface and disabling SCIM. -->
