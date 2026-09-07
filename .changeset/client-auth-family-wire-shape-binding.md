---
"@objectstack/client": minor
---

fix(client)!: the `auth.*` family declares the wire shapes better-auth actually sends — thirteen published `Promise< any >` returns narrowed (#14313)

**BREAKING** for a typed caller, and it breaks nothing that ever worked at runtime. No request bytes, no URL and no response handling change: this is a declaration catching up with what the routes have always answered. It ships as `minor` under the lockstep launch-window convention (`scripts/check-changeset-no-major.mjs`) — the version number is not the migration signal here, this entry is.

<!-- adr-0087: not-required (type-surface-only packages/client/src/index.ts#auth.updateUser, packages/client/src/index.ts#auth.changePassword, packages/client/src/index.ts#auth.setInitialPassword, packages/client/src/index.ts#auth.changeEmail, packages/client/src/index.ts#auth.sendVerificationEmail, packages/client/src/index.ts#auth.verifyEmail, packages/client/src/index.ts#auth.sessions.revoke, packages/client/src/index.ts#auth.sessions.revokeOthers, packages/client/src/index.ts#auth.sessions.revokeAll, packages/client/src/index.ts#auth.twoFactor.verifyTotp, packages/client/src/index.ts#auth.twoFactor.disable, packages/client/src/index.ts#auth.twoFactor.verifyBackupCode, packages/client/src/index.ts#auth.accounts.unlink) A published TYPE-SURFACE narrowing. Each of the thirteen members was UNANNOTATED at the merge base, so lib.dom's `Response.json()` published it as an erased `any`; each now declares the shape its route already answered, read off the wire against a real server. No method body changed, so no request or response byte moves, and the diff touches no `packages/spec` path and no ADR-0087 shape surface. The affected party is a TypeScript consumer and the compiler delivers the break at their own call site; `objectstack migrate meta`, `spec-changes.json` and the upgrade guide have nothing to rewrite, so a ledger entry would be false data in the one ledger this gate keeps true. The fourteenth member, `auth.deleteUser`, is deliberately left unannotated and is not named here. -->

Card 2 of 3 of the #12104 family, under the maintainer's 2026-08-31 ruling: the wire contract is the only source of truth, better-auth's own `Date`-typed fields are the pre-serialization SERVER shape, and every timestamp is declared as the ISO-8601 `string` the wire carries — no `Date`, no revival layer.

## What changed

Thirteen `auth.*` methods ended `return res.json()` with no return annotation, so `lib.dom`'s `Response.json(): Promise< any >` was their published type. Each now declares the shape its route serves, and its `exported-any-returns.json` entry is deleted in the same change (35 entries before, 22 after):

| method | resolved to (before) | resolves to (now) |
|:--|:--|:--|
| `client.auth.updateUser(data)` | `any` | `AuthStatusReceipt` |
| `client.auth.changePassword(req)` | `any` | `AuthPasswordChangeResult` |
| `client.auth.setInitialPassword(req)` | `any` | `AuthSetInitialPasswordResult` |
| `client.auth.changeEmail(req)` | `any` | `AuthStatusReceipt` |
| `client.auth.sendVerificationEmail(req)` | `any` | `AuthStatusReceipt` |
| `client.auth.verifyEmail(params)` | `any` | `AuthEmailVerificationResult` |
| `client.auth.sessions.revoke(token)` | `any` | `AuthStatusReceipt` |
| `client.auth.sessions.revokeOthers()` | `any` | `AuthStatusReceipt` |
| `client.auth.sessions.revokeAll()` | `any` | `AuthStatusReceipt` |
| `client.auth.twoFactor.verifyTotp(req)` | `any` | `AuthTwoFactorVerificationResult` |
| `client.auth.twoFactor.disable(req)` | `any` | `AuthStatusReceipt` |
| `client.auth.twoFactor.verifyBackupCode(req)` | `any` | `AuthTwoFactorVerificationResult` |
| `client.auth.accounts.unlink(req)` | `any` | `AuthStatusReceipt` |

`AuthWireUser`, `AuthStatusReceipt`, `AuthPasswordChangeResult`, `AuthEmailVerificationResult`, `AuthTwoFactorVerificationResult` and `AuthSetInitialPasswordResult` are newly exported from `@objectstack/client`. Twelve of these routes are served BARE by better-auth (`auth-route-ledger.ts` records them `source: 'better-auth'`) — there is no `{ success, data }` envelope to unwrap and none is introduced; `setInitialPassword` is ObjectStack's own mount and answers the platform's `{ success: true }` envelope.

## The exact reads that stop compiling

Everything below compiled before only because `any` is assignable to, and indexable by, everything.

```ts
const r = await client.auth.updateUser({ name: 'Ada' });
r.user;                       // now TS2339 — the route answers `{ status: true }`, NOT the updated user
r.data;                       // now TS2339 — these routes carry NO envelope

const cp = await client.auth.changePassword({ currentPassword, newPassword });
cp.user.createdAt.getTime();  // now TS2339 — the wire sends an ISO-8601 STRING, not a Date
new Date(cp.user.createdAt);  // the correct rewrite
cp.token.length;              // now TS18047 — `token` is `string | null` (null unless other sessions were revoked)

const v = await client.auth.verifyEmail({ token });
v.user.email;                 // now TS18047 — `user` is `AuthWireUser | null` (null on a plain verification)

const ok = await client.auth.setInitialPassword({ newPassword });
ok.status;                    // now TS2339 — ObjectStack's mount answers `{ success: true }`, not `{ status }`

const t = await client.auth.twoFactor.verifyTotp({ code });
t.user.locale;                // now TS2339 — ObjectStack's own sys_user columns are not on better-auth's wire user
```

A caller that only read `status`, `success`, `token` (guarding `null`) or the base user columns needs no change.

## Timestamps: ISO-8601 `string`, never `Date`

`AuthWireUser.createdAt` / `updatedAt` (and `banExpires`) are the vendor's `Date`-typed fields. The adapter is declared `supportsDates: false`, better-auth revives the stored string into a `Date` server-side, and `JSON.stringify` puts an ISO-8601 string back on the wire — measured `"createdAt":"2026-09-07T07:02:20.593Z"` on a real SQL driver. They are declared `string`, a type-level pin holds them there, and no revival layer exists in the SDK.

## Where the vendor's own declarations were the wrong answer

- `updateUser`'s OpenAPI stub promises `{ user }`; its handler answers `{ status: true }` and puts the new fields into the session cookie. The receipt is what is declared.
- `verifyEmail`'s stub declares `user` required; the handler answers `user: null` on a plain verification and the updated user only on a change-email verification.
- A nullable column (`image`, `banReason`, `banExpires`) arrives as `null` on the SQL drivers and as an ABSENT key on a store that does not materialise unset columns — both measured — so each is `?: … | null`.

## `auth.deleteUser` is deliberately NOT bound

The fourteenth method keeps its `Promise< any >` and its ledger entry. Its route is switched off by maintainer ruling (2026-08-12 on #7735; `auth-route-ledger.ts` books it `disabled`), and measured against a real server it answers HTTP 404 with a ZERO-BYTE body once the last-local-credential guard is satisfied — so `this.fetch` throws before `res.json()` ever runs and the method has no success path a caller can observe. No declared return type can be honest for a value the runtime never delivers. That the shrink-only ledger still carries exactly this one `auth.*` entry is the mechanism working.
