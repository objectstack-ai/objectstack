---
"@objectstack/client": minor
---

fix(client)!: the `oauth.*` family declares the wire shapes better-auth actually sends — four published `Promise< any >` returns narrowed (#14312)

**BREAKING** for a typed caller, and it breaks nothing that ever worked at runtime. No request bytes, no URL and no response handling change: this is a declaration catching up with what the routes have always answered. It ships as `minor` under the lockstep launch-window convention (`scripts/check-changeset-no-major.mjs`) — the version number is not the migration signal here, this entry is.

<!-- adr-0087: not-required (type-surface-only packages/client/src/index.ts#register, packages/client/src/index.ts#getPublic, packages/client/src/index.ts#consent) A published TYPE-SURFACE narrowing. Each member was UNANNOTATED at the merge base, so lib.dom's `Response.json()` published it as an erased `any`; each now declares the shape its route already answered. No method body changed, so no request or response byte moves, and the diff touches no `packages/spec` path and no ADR-0087 shape surface. The affected party is a TypeScript consumer and the compiler delivers the break at their own call site; `objectstack migrate meta`, `spec-changes.json` and the upgrade guide have nothing to rewrite, so a ledger entry would be false data in the one ledger this gate keeps true. DISCLOSURE, not an omission: the fourth narrowed member of this changeset is `oauth.applications.get` (index.ts line 3184; unannotated at base, `Promise` of `OAuthApplication` at HEAD). It satisfies this same predicate on a direct reading, but it is deliberately NOT named above, because the reference `packages/client/src/index.ts#get` does not address it: this file declares 13 members named `get`, predicate 4 reads the FIRST one (line 1928), and that member is unrelated and unannotated at both revs. Naming it would assert a verified fact about the wrong member; the ambiguity is filed as its own card. -->

Card 1 of 3 of the #12104 family, under the maintainer's 2026-08-31 ruling: the wire contract is the only source of truth, and better-auth's own `Date`-typed fields are the pre-serialization SERVER shape, not the wire fact.

## What changed

Four methods ended `return res.json()` with no return annotation, so `lib.dom`'s `Response.json(): Promise< any >` was their published type. Each now declares the shape its route serves, and its `exported-any-returns.json` entry is deleted in the same change:

| method | resolved to (before) | resolves to (now) |
|:--|:--|:--|
| `client.oauth.applications.register(req)` | `any` | `OAuthApplicationRegistration` |
| `client.oauth.applications.get(id)` | `any` | `OAuthApplication` |
| `client.oauth.applications.getPublic(id)` | `any` | `OAuthApplicationPublic` |
| `client.oauth.consent(req)` | `any` | `OAuthConsentResult` |

`OAuthApplication`, `OAuthApplicationRegistration`, `OAuthApplicationPublic` and `OAuthConsentResult` are newly exported from `@objectstack/client`. These four routes are served BARE by better-auth (`auth-route-ledger.ts` records them `source: 'better-auth'`) — there is no `{ success, data }` envelope to unwrap, and none is introduced.

## The exact reads that stop compiling

Everything below compiled before only because `any` is assignable to, and indexable by, everything.

```ts
const app = await client.oauth.applications.get('c_1');
app.data;                     // was fine; now TS2339 — these routes carry NO envelope
app.anythingAtAll;            // was fine; now TS2339

const pub = await client.oauth.applications.getPublic('c_1');
pub.client_secret;            // now TS2339 — the public projection hand-picks 7 columns
pub.grant_types;              // now TS2339 — same reason
pub.disabled;                 // now TS2339 — same reason

const decision = await client.oauth.consent({ accept: true });
decision.client_id;           // now TS2339 — consent answers `{ redirect, url }`

// Timestamps are RFC 7591 NUMBERS (Unix epoch seconds), so a caller that
// guessed `Date` or ISO `string` now fails:
new Date(app.client_id_issued_at!).toISOString();   // TS2769: number is not a Date arg
app.client_id_issued_at!.slice(0, 10);              // TS2339: not a string
new Date(app.client_id_issued_at! * 1000);          // the correct rewrite
```

A caller that only read `client_id`, `client_secret`, `redirect_uris` or `url` needs no change.

## Timestamps: `number`, not `Date` and not ISO-8601

The ruling ordered every `Date`-typed field declared as an ISO `string` and forbade both a `Date` declaration and a runtime revival layer. **This family has no `Date` field to convert.** RFC 7591 carries `client_id_issued_at` and `client_secret_expires_at` as Unix-epoch SECONDS, and the provider converts its stored `Date` to a number before serialising, so the wire sends neither a `Date` nor an ISO string. Both are declared `number`, and a type-level pin holds them there. The ruling's prohibitions are satisfied: nothing declares a `Date`, and no revival layer exists.

## Two places better-auth's own types were the wrong answer

Read off the wire against a real server, not off the vendor's `.d.ts`:

- `getPublic` is declared `OAuthClient` — the full row — but its handler hand-picks seven columns. `OAuthApplicationPublic` is that projection, derived with `Pick` so it cannot drift from its parent. Its `redirect_uris` is always `[]` on this route and carries no information.
- `user_id` and `application_type` are declared nullable by the vendor, but the serialiser folds a null column to `undefined`, so `null` is unreachable and is not declared.

## `oauth.applications.delete` is deliberately NOT bound

The fifth method of the family keeps its `Promise< any >` and its ledger entry. Its route answers HTTP 200 with a zero-byte body, so its `res.json()` rejects with a `SyntaxError` on every successful delete. No annotation can be honest while that call stands, and binding it needs a behaviour change — a decision beyond this card's type-narrowing scope. That the shrink-only ledger still carries exactly this one entry is the mechanism working.
