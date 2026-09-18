---
"@objectstack/spec": minor
"@objectstack/client": minor
"@objectstack/plugin-auth": minor
---

The identity read routes now serve what `@objectstack/spec/identity` declares: `metadata` arrives DECODED on every organization route that reads the row back, and `updatedAt` is declared optional on `Organization` / `Member` / `Invitation` — the shape better-auth's own serializer documents (#18728).

Clause-②: yes (widening) — `updatedAt` moves from required to optional on three published schemas, so the set a consumer may hand to `OrganizationSchema` / `MemberSchema` / `InvitationSchema` grows by exactly one shape: the key being absent. Nothing previously admitted is refused, nothing is renamed, and no producer is required to write it. Contract-review tier.

Three published schemas could not parse a served response. `OrganizationSchema` declared `updatedAt` required and `metadata` an object; the four organization read routes (`setActive`, `get`, `delete`, `list`) carried no `updatedAt` at all and served `metadata` as the stored JSON text. `@objectstack/client` had recorded that as three 「not relayed」 notes rather than as a defect, and with zero in-repo consumers nothing went red — the audience was entirely external. Maintainer ruling C (batch #158 item 4) fixed the producer and made the one remaining key conditional on a measurement, which is what decided each half:

- **`metadata` is decoded at the producer, unconditionally** — it is our column. plugin-auth's data adapter decodes `sys_organization.metadata` out of its stored JSON text on its READ verbs, so all four routes serve the object the spec declares, and an unset column is OMITTED rather than sent as `null`. ⛔ The write verbs are deliberately untouched: better-auth's own organization adapter decodes the `create` / `update` echoes itself and discriminates on the value still being a string, so decoding there would fold the create echo's `metadata` to `undefined`. Both directions are pinned.
- **`updatedAt` aligns to the documented wire** — ruling C's own fallback A, and its two conditions were measured against the installed better-auth 1.7.3 rather than assumed. The routes are better-auth's endpoints mounted through a single catch-all, each answering `ctx.json(...)` with no ObjectStack post-processing; and the vendor's `organization`, `member` and `invitation` models declare no `updatedAt` field, while its adapter factory's output transform iterates the declared fields only, so an undeclared column is dropped before any route sees it. Control, in the same file: the vendor's `team` and `organizationRole` models DO declare `updatedAt`, so the absence is a reading. For `member` and `invitation` there is additionally no column to serve — `sys_member` and `sys_invitation` are `managedBy: 'better-auth'`, the one disposition under which the platform injects no audit family, and neither declares `updated_at` itself.
- **`@objectstack/client` relays the schemas.** `OrganizationWire` is the spec's `Organization`, `OrganizationMemberWire` is `Member`, and `OrganizationInvitationWire` is `Invitation` with `status` narrowed per route plus the three members the platform adds on top (`teamId` and the two ADR-0105 D8 placement fields, which the non-strict schema strips). The three 「not relayed」 notes are gone.
- **The negative controls are the point.** "The client relays the spec schemas" and "the client stopped validating" look identical from a green positive test, so every accepted body is paired with a refused one — a required field genuinely missing, `metadata` still arriving as the stored JSON TEXT, and a `createdAt` or `updatedAt` present but not a datetime. `.optional()` widened the accept set by absence ONLY; a value that is there is still held to `z.string().datetime()`.

**Not declared breaking, and the reason is the repo's own criterion** rather than the level being convenient. AGENTS.md binds the breaking class to removing or renaming something an author can write, and to the `(narrowing)` arm of the clause-② pair. Neither holds here: nothing is removed, renamed or retired; the one `packages/spec` edit only widens an accept set; and the `metadata` half is a producer brought into line with a contract this package has published all along — `OrganizationSchema.metadata` has declared an object since it was written, and the client's own comment called the served text 「not relayed」 rather than a shape anyone was promised. No ADR-0087 disposition is claimed because no breaking change is declared: no authored metadata moves, so `objectstack migrate meta` has nothing to visit, `spec-changes.json` has nothing to project and the upgrade guide has no row to gain. These three schemas are not metadata types — not in `DEFAULT_METADATA_TYPE_REGISTRY`, no authorable surface. ⚠️ Stated here rather than assumed silently, because it is the one judgement in this diff that the contract review the `Clause-②: yes` declaration commissions should confirm.

**What a consumer notices**, and where it is delivered: `organization.metadata` was the stored JSON text and is now the decoded object, so a caller that decoded it itself drops that step.

```ts
// before — the caller decoded what the route sent
const meta = JSON.parse(org.metadata ?? '{}');
// after — the producer decoded it; the key is ABSENT when unset
const meta = org.metadata ?? {};
```

The channel that reaches that caller is the compiler, on the line that used to work: `JSON.parse` no longer accepts the value. `updatedAt` needs nothing in either direction — it was never on this family's wire, so no caller can have been reading a value, and the declaration now says so out loud instead of promising one.
