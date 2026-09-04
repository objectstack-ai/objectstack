---
"@objectstack/rest": patch
"@objectstack/core": patch
---

fix(rest,core): an organization-less or ex-member API key on a walled single-kernel deployment now answers 401 where it answered 200

Under a wall-enforcing tenancy posture (`isolated`), an API key stamped with an
organization its owner is no longer a member of **read and wrote that
organization's rows** on the wiring the open core actually builds. Not a silent
empty set — a GET that returned the other organization's records, and a POST
that landed a row read back from the store carrying that organization's id and
the ex-member as its creator. An organization-less key on the same deployment
read `200` with an empty set, which is the silent failure the wall exists to
replace.

The cause was a seam, not a predicate. `RestServer.computeExecCtx` derived the
effective tenancy posture from a per-request kernel, and on the single-kernel
wiring there is no per-request kernel — so the posture was `undefined` on every
request, and both posture-conditional API-key refusals are gated on it:
`organization_required` in `api-key.ts` and `organization_membership_ended` in
`resolve-authz-context.ts`. Neither ever ran. The Layer 0 wall itself was
active the whole time; it compares against the caller's active organization,
and an API key's tenant is `sys_api_key.active_organization_id` copied verbatim
— the holder's own stored claim. Enforcing the wall is what let the ex-member
through, because the one fact that would expose the ended membership was not an
input to the layer that could act on it.

The single-kernel branch now derives the posture from a provider `rest-api-plugin`
wires to the lone local kernel's `tenancy` service, in the same shape as the
auth-service provider beside it. A host that registers no `tenancy` service is
unchanged and still admits: there is no wall on such a deployment, so there is
nothing for an organization-less key to be walled out of. A `tenancy` service
that was registered and **failed to build** is an outage and answers `503`, not
an admission — a posture that could not be read is not a posture that is absent.

Refusals are now also said out loud on the server side, at `warn`, where each
one is decided: the key's row id (never the credential or its hash), the
principal, the organization and the reason. **The wire is unchanged** — both
refusals still answer the generic `401 UNAUTHENTICATED` with no reason in the
body, so a holder of someone else's key learns nothing a plain 401 does not
already tell them. The operator, who previously had a key that was neither
revoked nor expired and a 401 that said nothing, now has a line to find.

Behaviour that does not move: a current member's key on the same route still
returns its rows and still writes; a request with no credential still answers
401; and an unknown, revoked or expired key is not a refusal at all, so a key
scanner produces no log volume.
