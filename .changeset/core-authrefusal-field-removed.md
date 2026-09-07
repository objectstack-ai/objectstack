---
"@objectstack/core": minor
---

fix(core): `ResolvedAuthzContext.authRefusal` is removed — a published member nothing ever read (#14273)

**BREAKING** published-type narrowing, shipped as `minor` under the repo's
launch-window convention for breaking changes. `ResolvedAuthzContext` — the
envelope `resolveAuthzContext` answers, exported from `@objectstack/core`'s
root entry — loses its optional `authRefusal?: { reason; message }` member.
Maintainer ruling 2026-09-02 (option A, ADR-0049 enforce-or-remove),
re-affirmed 2026-09-03 as A1 with the carriers a published narrowing owes
once the type was measured as public API: the member was written by the two
posture-conditional API-key refusals (`organization_required` at admission,
`organization_membership_ended` after grants) since #8287 and read by nothing
— zero runtime readers across every transport and consumer in the repo for
its whole life; only test assertions ever looked at it.

What changes:

- `ResolvedAuthzContext` no longer declares `authRefusal`. Code that reads
  `ctx.authRefusal` stops compiling (`TS2339`); at runtime the property was
  already absent from every resolved context except the two refused ones.
- The two refusals themselves are UNCHANGED: they still fire, still fail
  closed (no `userId`, empty grants), and every transport still answers the
  generic anonymous `401 UNAUTHENTICATED`. No status code, body or header
  moves — a holder of someone else's key learns nothing, exactly as before.
- The refusal REASON is observable on exactly one surface, and it is not the
  envelope: the server-side `[security] API key refused (reason) ...` `warn`
  line at the decision point (#15256 / 2A), which names the key row id,
  principal and organization for the operator. The pins that kept the two
  reasons distinguishable through the field now read that line.
- `ApiKeyRefusalReason` and `ApiKeyAdmission` are unchanged — the reason
  vocabulary still exists; it just no longer has a copy on the resolved
  context.

**Migration.** A consumer that read `ctx.authRefusal` deletes the read; there
is no replacement on the envelope, by design — disclosing the reason to a
caller (option B) was ruled out as a security-boundary question, and the
recorded fallback if a reader ever appears is an audit-side outlet (option C),
never the wire. Fail-closed handling keys on the absent `userId`, as every
in-repo transport already did. An operator who needs the reason reads the
server log line.

<!-- adr-0087: not-required (runtime-interface-only packages/core/src/security/resolve-authz-context.ts#ResolvedAuthzContext) A published runtime TypeScript interface lost an optional member. No Zod schema, no `packages/spec` declaration, no object definition and no stored representation is touched — `ResolvedAuthzContext` is a plain interface in `packages/core`, projected from no schema and referenced by no metadata surface — so `objectstack migrate meta` has nothing to rewrite and there is no tombstone to mint. The channel that reaches an affected consumer is the compiler at the read site (`TS2339`), which is more precise than a ledger line. The in-repo census (zero runtime readers; the only readers were test assertions, relocated onto the `warnApiKeyRefusal` line) and the workspace typecheck are recorded on the PR. -->
