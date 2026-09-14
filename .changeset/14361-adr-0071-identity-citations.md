---
'@objectstack/plugin-auth': patch
'@objectstack/platform-objects': patch
'@objectstack/spec': patch
---

docs(identity): re-point the SCIM/identity `ADR-0071` citations at the records that mean them (#14361)

From this repository's point of view `ADR-0071` named two unrelated decisions,
and only one of them had a record here. `docs/adr/0071-dataset-semantic-layer-depth.md`
is *Dataset semantic-layer depth — multi-hop joins*. The identity and SCIM
citations mean something else entirely: the enterprise-identity decision taken in
`objectstack-ai/cloud`, whose open mechanism half has been mirrored into this
repo since 2026-09-07 as
[ADR-0134](https://github.com/objectstack-ai/objectstack/blob/main/docs/adr/0134-env-side-scim-provisioning.md).
So a reader following one of those citations landed on a real page about the
wrong subject — worse than a dangling id, because a plausible-looking record
invites belief rather than a second question.

44 identity-meaning citations now name the record that holds the decision they
describe. 43 of them read `ADR-0134` (the open mechanism half: effective SCIM
forces the better-auth `admin` plugin on, `active:false` lands as a ban plus
session revocation, the SCIM 2.0 Service Provider mounts in the environment, and
the seven stable `sys_scim_*` models). One reads `cloud ADR-0071` — the
"paid Identity lifecycle" note in `auth-manager.ts`, which names the commercial
half that deliberately stays in the cloud record.

What actually reaches a consumer of these packages:

- `@objectstack/plugin-auth` — the **operator-facing construction-time refusal**
  raised when SCIM is effective beside an explicit `plugins.admin: false` now
  cites ADR-0134 instead of ADR-0071. The condition that triggers the refusal,
  its wording otherwise, and the two documented ways out are unchanged; only the
  ADR number in the sentence moves. ⚠️ A deployment that greps that message for
  the literal `ADR-0071` should grep for `ADR-0134`.
- `@objectstack/spec` — the `admin` flag's `.describe()` text (shipped both as
  `src/system/auth-config.zod.ts` and in the generated `json-schema/` bundle),
  and therefore the generated `content/docs/references/system/auth-config.mdx`
  reference page app authors read.
- `@objectstack/platform-objects` — the `protection.reason` strings on the eight
  `sys_scim_*` identity objects and on `sys_user`.

No behaviour moves. No schema accepts or refuses anything it did not accept or
refuse before, no security or permission semantics are touched, and no ADR
record is written or edited. Bare `ADR-0071` still resolves exactly as it did:
the 22 dataset-meaning citations are byte-identical to `main` and
`check:adr-anchors` reports the same 35477 resolving citations before and after.
Historical archives — the six package CHANGELOGs — are deliberately untouched.
