---
"@objectstack/plugin-auth": minor
---

`POST /admin/sso/verify-domain` now answers the DISABLED condition the way its
sibling always has. When SSO domain verification is off for an environment,
`@better-auth/sso` never mounts the inner endpoint and answers `404` with no
code. Both bridge routes recognise that shape, and they used to answer it
differently (#10859):

| route | answered | answers instead |
| --- | --- | --- |
| `POST /admin/sso/request-domain-verification` | `400` `DOMAIN_VERIFICATION_DISABLED` | unchanged |
| `POST /admin/sso/verify-domain` | `404` `DOMAIN_VERIFICATION_FAILED` | `400` `DOMAIN_VERIFICATION_DISABLED` |

`verify-domain` rewrote only the `message` for that branch and let the code fall
through to its generic failure default, so the response carried "the feature is
off" copy under a code that means "verification failed". A caller can only act
on the machine-readable half, and the two halves disagreed. The status moves
with the code: the inner `404` describes the INNER endpoint, which is unmounted,
whereas this bridge route is mounted unconditionally — passing that status
through said "no such endpoint" about a resource that exists.

If you match on `DOMAIN_VERIFICATION_FAILED` (or on `404`) to detect the
disabled case on `verify-domain`, match on `DOMAIN_VERIFICATION_DISABLED` (or on
`400`) instead — the same pair `request-domain-verification` has always
answered. The distinction is worth having: `DISABLED` means "turn on
`OS_SSO_DOMAIN_VERIFICATION`", `FAILED` means "the DNS TXT record is not visible
yet, retry".

**No `packages/spec` change, and the emitted vocabulary gains no member.** Both
codes are already registered for `@objectstack/plugin-auth` in the error-code
ledger, with exactly these meanings (`DOMAIN_VERIFICATION_DISABLED` — "domain
verification is off on this deployment"). This route was emitting a *declared*
code whose registered meaning is a different condition, so this is
declared-vs-enforced restoration rather than a new contract decision.

**A genuine verification failure still answers the failure code, and the vendor
pass-through arm is untouched on both routes.** The rewrite is keyed to the
disabled shape specifically — `404` *without* a code. A `404` that carries
`@better-auth/sso`'s own code is the vendor's diagnosis and reaches the caller
verbatim, status included, as does every non-404 failure. That direction is the
load-bearing one — an implementation keyed to "any 404", or to `!resp.ok`, would
satisfy the disabled case while destroying the diagnosis a caller acts on — and
it is pinned in both directions in
`packages/plugins/plugin-auth/src/sso-domain-verification-error-codes.test.ts`.

Shipped as `minor`, following the same call the casing rename on these two
routes made (#10716). The argument for it: the vocabulary is unchanged, and the
old pairing was self-contradictory rather than a contract anyone could have
relied on deliberately. The argument against it, stated here rather than
settled: unlike that rename — whose old spellings were undeclared values no
schema admitted — `DOMAIN_VERIFICATION_FAILED` *is* a declared, registered code,
so a client keyed to it for this case was keyed to something the published
contract admitted, and both halves of the answer change. A reviewer who reads
that as `major` is not reading it wrong; this PR does not decide it silently.
