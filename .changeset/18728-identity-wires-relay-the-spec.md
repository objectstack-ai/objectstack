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

⚠️ **BREAKING** for a consumer that reads the organization wire's `metadata`, even though the level ships as `minor`: the repo's launch-window convention refuses `major` (`check-changeset-no-major`) and breaking-ness is carried by this banner plus the ADR-0087 disposition rather than by the level.

**FROM → TO**: `organization.metadata` was the stored JSON text and is now the decoded object.

```ts
// before — the caller decoded it
const meta = JSON.parse(org.metadata ?? '{}');
// after — the producer decoded it; the key is ABSENT when unset
const meta = org.metadata ?? {};
```

`updatedAt` needs no migration in either direction: it was never on this family's wire, so no caller can have been reading a value, and the declaration now says so.

<!-- adr-0087: not-required (no-migration-prescription) Nothing authorable moves. No authored metadata property, object definition or accepted request shape changes its spelling, type or legality in a direction an author must act on: the only `packages/spec` edit makes `updatedAt` OPTIONAL on three identity wire schemas, which is pure widening — every document that parsed before still parses, byte for byte, so `objectstack migrate meta` has nothing to visit, `spec-changes.json` has nothing to project and the upgrade guide has no row to gain. These three schemas are not metadata types either: they are not in `DEFAULT_METADATA_TYPE_REGISTRY`, carry no authorable surface, and had zero in-repo consumers before this change. The other categories are closed on facts: all three packages publish to npm, declare no `private` and ship `dist` in `files[]` (not `unpublished`); no ADR-0087 id is minted in this diff (not `registered`) and none pre-dates the base that would cover it (not `already-registered`); and exported declarations DO change — `OrganizationWire` and `OrganizationMemberWire` become type aliases of the spec declarations and `OrganizationInvitationWire` becomes an intersection over one — so neither `runtime-interface-only` nor `type-surface-only` applies. plugin-auth's new module is package-internal and is NOT re-exported from its entry, so it adds no published declaration. The BREAKING banner above is carried rather than dropped, because the served wire shape of `@objectstack/plugin-auth` changes and `@objectstack/client`'s declaration of it changes with it. -->
