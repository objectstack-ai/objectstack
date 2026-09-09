---
"@objectstack/client": minor
---

fix(client): `oauth.applications.register` declares only the members `/oauth2/create-client` accepts — `name`, `scopes` and `metadata` are removed (#15447)

**BREAKING** — three members leave a published request type. A caller who sets one compiles today and gets a type error after this release. That is the point: the route never honoured any of them, so what the compiler now refuses is code that was already having its value thrown away.

## What a caller passing these members should do instead

| you were passing | pass instead | why |
|---|---|---|
| `name: 'My App'` | `client_name: 'My App'` | same `string`, and `client_name` is the member the route reads |
| `scopes: ['openid', 'profile']` | `scope: ['openid', 'profile'].join(' ')` | ⚠️ **not** a rename — `scope` is one space-delimited string; posting an array is refused with `400 [body.scope] Invalid input: expected string, received array` |
| `metadata: { tenant: 'acme' }` | nothing — delete the member | no door this SDK can reach accepts it (see below) |

## ⚠️ These were the vendor's RECORD vocabulary, not typos

`client_name` writes the DB column literally named **`name`**; `scope` writes the DB column literally named **`scopes`**, as a JSON array. The removed members were the *column* names offered next to the *wire* names in the same declared type — an author picking the adjacent one of two got a success receipt and no value. Treating them as misspellings would be the wrong reading of what they were; the prescription above is still the wire member either way.

## Why they had to go rather than be honoured here

`POST /api/v1/auth/oauth2/create-client` is mounted verbatim from `@better-auth/oauth-provider@1.7.2`. Its body schema declares 21 members and sets no `catchall`, so it is zod's default **strip**: an unknown key is dropped, not refused, and the caller gets **HTTP 201 and a client that quietly does not have the value**. Driven end to end against a real `betterAuth` + `oauthProvider` over a real ObjectQL engine on a real socket, through this client: each of the three came back absent from the response, absent from `oauth.applications.get`, absent from `oauth.applications.list`, and `null` in the `sys_oauth_application` row.

A second, independent barrier stands behind that strip — the handler funnels the parsed remainder into the opaque-metadata envelope, and all three names sit in `OPAQUE_METADATA_RESERVED_FIELDS` — so no amount of loosening on the SDK side could ever have made them arrive. `metadata` in particular is honoured only by `PATCH /admin/oauth2/update-client`, which is `SERVER_ONLY` and therefore not an HTTP route at all: over the wire it answers 404 with a zero-byte body.

Nothing else on the method moves. The two members the route does honour, `client_name` and `scope`, are declared exactly as before and still reach the server byte for byte; the method's return type, its URL and its request-building step are unchanged.

Graded `minor` rather than `patch` because a published package's public surface moves, per the maintainer's ruling of 2026-09-04 (decision batch #35) that such a change takes at least `minor`; the banner above carries the breaking-ness the level cannot.

<!-- adr-0087: not-required (no-migration-prescription) Claimed on a POSITIVE argument rather than on the detector finding nothing. Stated plainly: the table above IS a prescription, and it is addressed to a TYPESCRIPT CONSUMER at their own call site, delivered by the compiler — the audience ADR-0087's D8 addendum says the ledger explicitly does not serve. Nothing authorable moves: no spec key, no Zod schema, no object definition, no config field and no stored representation changes spelling or shape, so `objectstack migrate meta` has nothing to visit, `spec-changes.json` has nothing to project and the upgrade guide has no row to gain. Minting a ledger id here would put a prescription in the one ledger this gate keeps true that none of its three consumers can project. The other four categories are closed on facts: `@objectstack/client` publishes to npm (not `unpublished`); no id pre-dates the base (not `already-registered`); no named symbol is a non-metadata runtime interface whose members moved (not `runtime-interface-only`); and `type-surface-only` fails its predicate 4 (`narrowed-from-erased`), because the request type was concretely declared at the merge base rather than `any` — this narrowing removes members from a concrete type instead of replacing an erased one. ⚠️ Residual declared rather than hidden: the vocabulary still has no category for a source-author prescription the ledger must not carry, which is D8's blind spot reached from a third direction; raised for the maintainer in the PR report rather than resolved by dropping the BREAKING banner. -->
