---
"@objectstack/rest": minor
---

fix(rest): `POST /meta/:type/:name/publish` and `.../rollback` require the `manage_metadata` capability (#8919)

<!-- adr-0087: not-required (no-migration-prescription) Two route handlers gain
the capability gate their four sibling doors already carry, plus one new test
file. No authorable property is added, renamed, retired or tombstoned, so there
is no conversion to register. The behavioural change is that two metadata write
doors stop accepting callers who hold no authoring capability. -->

**BREAKING for any integration that publishes or rolls back metadata with a
principal holding no authoring capability.** Landing after the v17.0.0 cut, so
it ships as `minor` under the lockstep launch-window convention.

`packages/rest` gates four metadata-authoring doors on ADR-0066 D1's
`manage_metadata` capability — `POST /meta/_migrate-stored`, `PUT /meta/:type/:name`
(#6603), `PUT /meta/:type/:section/:name` and `DELETE /meta/:type/:name` (#7019).
The two **promotion** verbs did not, and promotion is what decides which body is
live: `publishMetaItem` flips the `sys_metadata` row `state: 'draft'` to
`'active'` (ADR-0027 (E)(5) defines sealing a publish as exactly that flip), and
`rollbackMetaItem` restores a caller-supplied `toVersion` as the new live row.

**Measured through a composed host, down to the protocol layer, before the fix:**

| principal | publish | rollback |
|:--|:--|:--|
| anonymous | 401, protocol not reached | 401, protocol not reached |
| authenticated, **no** `manage_metadata` | **200, protocol reached** | **200, protocol reached** |
| authenticated, `manage_metadata` | 200, protocol reached | 200, protocol reached |

So the reachable cohort was every authenticated principal holding no authoring
capability at all: it could take a draft somebody else authored and make it
live, or restore any historical version over the live row. Anonymous callers
were already refused by the `/meta` umbrella (`registerMetadataEndpoints`), so
what these gates add is precisely the authenticated-but-uncapable cohort.

**`rollback` is the sharper of the two.** The caller supplies `toVersion`, which
makes it a mechanism for reverting security hardening — a permission set as it
stood before it was tightened, a validation rule from before it existed, a
layout from before field-level security. It is also the door with the least
behind it: publish at least re-runs `assertRuntimeAuthoringRules` on the
promoted draft (#4463 D1), while rollback runs no content gate at all. Neither
of those reads the caller in any case — D1 answers "is this metadata valid", not
"may you press this button" — so nothing downstream was ever doing this job.
Audit rows are still written either way, so the action remains traceable after
the fact.

**No legitimate caller loses anything, and that is measured rather than
assumed.** The Studio designer's save-then-publish loop saves `?mode=draft` and
then POSTs `/publish`, and its **first** step already demanded
`manage_metadata` — so every principal that can author a draft already clears
the new gate. The shipped sets bear this out: `admin_full_access` (the only set
carrying `studio.access`) carries `manage_metadata` too, while
`organization_admin` and `member_default` are refused at the save door **today**.
The only callers the gap benefited were exactly the ones already refused the
authoring door — able to promote a draft they could not have written.

**Migration — grant `manage_metadata` to any service principal that publishes.**
An integration that promotes metadata on its own schedule (a CI job sealing a
release, an AI authoring agent) needs the capability explicitly; there is no
automatic replacement, deliberately. `isSystem` contexts bypass, as on every
other capability gate on the platform, so in-process callers are unaffected.

The gate is the sibling doors' four lines verbatim, deliberately not a second
way of demanding the same capability, and it fires **before** the protocol is
resolved so 403-vs-501 leaks no kernel capability and nothing is promoted before
the refusal.

⚠️ **An author/publisher capability split is NOT introduced here.** Separating
"may write a draft" from "may make it live" is a defensible design, but it needs
a *different* declared capability and is a product decision; both defensible
designs require a gate, and the state this fixes was neither.

Ships with an **enumeration pin** rather than two assertions. The defect was not
that two handlers forgot a gate — it was that the gate was a convention held by
repetition and nothing else, so the next metadata write door had a one-in-three
chance of copying an ungated neighbour with no test going red. The new suite
derives the write doors from the composed server's own route table and compares
them against a declared list, so a new mutating `/meta` route fails the build
until it is enumerated and its refusal asserted.
