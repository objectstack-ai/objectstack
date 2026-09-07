---
"@objectstack/client": minor
---

fix(client)!: the `organizations.*` family declares the wire shapes better-auth actually sends — nineteen published `Promise< any >` returns narrowed, twenty ledger entries closed (#14314)

**BREAKING** for a typed caller, and it breaks nothing that ever worked at runtime. No request bytes, no URL and no response handling change: this is a declaration catching up with what the routes have always answered. It ships as `minor` under the lockstep launch-window convention (`scripts/check-changeset-no-major.mjs`) — the version number is not the migration signal here, this entry is.

<!-- adr-0087: not-required (type-surface-only packages/client/src/index.ts#organizations.create, packages/client/src/index.ts#organizations.update, packages/client/src/index.ts#organizations.setActive, packages/client/src/index.ts#organizations.get, packages/client/src/index.ts#organizations.listMembers, packages/client/src/index.ts#organizations.invite, packages/client/src/index.ts#organizations.leave, packages/client/src/index.ts#organizations.delete, packages/client/src/index.ts#organizations.removeMember, packages/client/src/index.ts#organizations.updateMemberRole, packages/client/src/index.ts#organizations.getActiveMember, packages/client/src/index.ts#organizations.invitations.cancel, packages/client/src/index.ts#organizations.invitations.accept, packages/client/src/index.ts#organizations.invitations.reject, packages/client/src/index.ts#organizations.teams.create, packages/client/src/index.ts#organizations.teams.update, packages/client/src/index.ts#organizations.teams.delete, packages/client/src/index.ts#organizations.teams.addMember, packages/client/src/index.ts#organizations.teams.removeMember) A published TYPE-SURFACE narrowing. Each of the nineteen members was UNANNOTATED at the merge base, so lib.dom's `Response.json()` published it as an erased `any`; each now declares the shape its route already answered, read off the wire against a real server. No method body changed, so no request or response byte moves, and the diff touches no `packages/spec` path and no ADR-0087 shape surface. The affected party is a TypeScript consumer and the compiler delivers the break at their own call site; `objectstack migrate meta`, `spec-changes.json` and the upgrade guide have nothing to rewrite, so a ledger entry would be false data in the one ledger this gate keeps true. The twentieth ledger entry, `organizations.invitations.resend`, carries no annotation of its own and closes because it delegates to the now-bound `invite`; it is not named here because its site is unchanged. -->

Card 3 of 3 of the #12104 family, under the maintainer's 2026-08-31 ruling: the wire contract is the only source of truth, better-auth's own `Date`-typed fields are the pre-serialization SERVER shape, and every timestamp is declared as the ISO-8601 `string` the wire carries — no `Date`, no revival layer.

## What changed

Nineteen `organizations.*` methods ended `return res.json()` with no return annotation, so `lib.dom`'s `Response.json(): Promise< any >` was their published type. Each now declares the shape its route serves, and its `exported-any-returns.json` entry is deleted in the same change — together with the entry for `organizations.invitations.resend`, which has no annotation of its own and inherits `invite`'s (22 entries before, 2 after):

| method | resolved to (before) | resolves to (now) |
|:--|:--|:--|
| `client.organizations.create(req)` | `any` | `OrganizationCreateResult` |
| `client.organizations.update(id, data)` | `any` | `OrganizationEchoWire` |
| `client.organizations.setActive(id)` | `any` | `OrganizationWire \| null` |
| `client.organizations.get(id)` | `any` | `OrganizationFullWire \| null` |
| `client.organizations.listMembers(id)` | `any` | `OrganizationMembersPage` |
| `client.organizations.invite(req)` | `any` | `OrganizationInvitationWire<'pending'>` |
| `client.organizations.leave(id)` | `any` | `OrganizationMemberWithUserWire` |
| `client.organizations.delete(id)` | `any` | `OrganizationWire` |
| `client.organizations.removeMember(id, params)` | `any` | `OrganizationRemoveMemberResult` |
| `client.organizations.updateMemberRole(id, params)` | `any` | `OrganizationMemberWire` |
| `client.organizations.getActiveMember(id)` | `any` | `OrganizationMemberWithUserWire` |
| `client.organizations.invitations.cancel(id)` | `any` | `OrganizationInvitationWire<'canceled'>` |
| `client.organizations.invitations.accept(id)` | `any` | `OrganizationInvitationAcceptResult` |
| `client.organizations.invitations.reject(id)` | `any` | `OrganizationInvitationRejectResult` |
| `client.organizations.invitations.resend(inv)` | `any` (inherited) | `OrganizationInvitationWire<'pending'>` (inherited from `invite`) |
| `client.organizations.teams.create(req)` | `any` | `OrganizationTeamWire` |
| `client.organizations.teams.update(params)` | `any` | `OrganizationTeamWire` |
| `client.organizations.teams.delete(params)` | `any` | `OrganizationTeamRemovedReceipt` |
| `client.organizations.teams.addMember(params)` | `any` | `OrganizationTeamMemberWire` |
| `client.organizations.teams.removeMember(params)` | `any` | `OrganizationTeamMemberRemovedReceipt` |

`OrganizationWire`, `OrganizationEchoWire`, `OrganizationCreateResult`, `OrganizationFullWire`, `OrganizationMemberWire`, `OrganizationMemberUserWire`, `OrganizationMemberWithUserWire`, `OrganizationMembersPage`, `OrganizationRemoveMemberResult`, `OrganizationInvitationWire`, `OrganizationInvitationAcceptResult`, `OrganizationInvitationRejectResult`, `OrganizationTeamWire`, `OrganizationFullTeamWire`, `OrganizationTeamMemberWire`, `OrganizationTeamRemovedReceipt` and `OrganizationTeamMemberRemovedReceipt` are newly exported from `@objectstack/client`. Every one of these routes is served BARE by better-auth (`auth-route-ledger.ts` records them `source: 'better-auth'`) — there is no `{ success, data }` envelope to unwrap and none is introduced. `@objectstack/spec/identity`'s `Organization` / `Member` / `Invitation` are deliberately NOT relayed: each declares `updatedAt` required, and the wire never carries it (the adapter's output transform walks better-auth's own schema, which has no such column); `InvitationStatus` IS relayed, narrowed to the literal each handler pins.

## The exact reads that stop compiling

Everything below compiled before only because `any` is assignable to, and indexable by, everything.

```ts
const org = await client.organizations.setActive(id);
org.id;                          // now TS18047 — `setActive` (and `get`) answer `null` for an empty id with no active organization
JSON.parse(org!.metadata);       // fine — on the READ routes `metadata` is the stored JSON text
(await client.organizations.get(id))!.metadata.plan;   // now TS2339 — it is a string here, not an object

const echo = await client.organizations.update(id, { metadata: { plan: 'pro' } });
JSON.parse(echo.metadata);       // now TS2345 — the two WRITE routes (`create`, `update`) echo `metadata` already decoded

const deleted = await client.organizations.delete(id);
deleted.length;                  // now TS2339 — the route answers the organization ROW, not the id string the vendor's OpenAPI stub declares
deleted.updatedAt;               // now TS2339 — `sys_organization.updated_at` never reaches the wire
deleted.createdAt.getTime();     // now TS2339 — ISO-8601 STRING, not a Date; `new Date(deleted.createdAt)` is the rewrite

const m = await client.organizations.updateMemberRole(id, { memberId, role: 'admin' });
m.member.role;                   // now TS2339 — the row is answered BARE, not as `{ member }` (the vendor's stub is wrong)

const removed = await client.organizations.removeMember(id, { memberIdOrEmail });
removed.member.user.email;       // now TS18048 — `user` is joined on ONLY when the member was addressed by email

const inv = await client.organizations.invite({ email, organizationId: id });
if (inv.status === 'accepted') { /* now TS2367 — `invite` answers the literal `'pending'` */ }

(await client.organizations.listMembers(id)).data;   // now TS2339 — no envelope on any route of this family
```

A caller that read `id`, `name`, `slug`, `role`, `email`, `members`, `total` or `message` off these values, or narrowed `null` where it can arrive, needs no change.

## Timestamps: ISO-8601 `string`, never `Date`

`createdAt` on every row type, `updatedAt` on teams and `expiresAt` on invitations are the vendor's `Date`-typed fields. The adapter is declared `supportsDates: false`, better-auth revives the stored string into a `Date` server-side, and `JSON.stringify` puts an ISO-8601 string back on the wire — measured `"createdAt":"2026-09-07T09:27:01.545Z"` on a real SQL driver. They are declared `string`, a type-level pin holds them there, and no revival layer exists in the SDK.

## Where the vendor's own declarations were the wrong answer

- `delete`'s OpenAPI stub declares the deleted id as a `string`; the handler answers the organization row.
- `updateMemberRole`'s stub declares `{ member }`; the handler answers the membership row bare, without `user`.
- `metadata` is one column with two wire forms: `create` and `update` decode it, every read route answers the stored JSON text (`setActive`, `get`, `delete`, `list`).
- `removeMember` joins `user` on only when the member was addressed by email; the by-id path strips it.
- Inside `get(...).teams` the vendor's `memberCount` is NOT stripped (it is on `teams.create` / `teams.update`), and the default team minted at organization creation carries no `updatedAt` on a store that does not materialise unset columns.

## Not a behaviour change

`getActiveMember(organizationId)` keeps sending its query parameter; the measured fact that the server ignores it and answers the session's ACTIVE organization is recorded in the method's JSDoc and filed separately — a body change is outside this family's ruled narrowing scope.
