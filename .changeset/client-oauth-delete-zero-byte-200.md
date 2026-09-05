---
"@objectstack/client": minor
---

fix(client)!: `oauth.applications.delete` resolves on the zero-byte 200 its route answers, instead of rejecting on every successful delete (#15451)

**BREAKING** on two independent axes, and it makes a published method usable for the first time. Before this change `client.oauth.applications.delete(id)` **rejected on every successful delete** — there was no success path a caller could observe. It ships as `minor` under the lockstep launch-window convention (`scripts/check-changeset-no-major.mjs`); the version number is not the migration signal here, this entry is.

<!-- ADR-0087 disposition: BLOCKED ON A DECISION, and deliberately not claimed. This is
     NOT a disposition marker and must not be read as one; the gate is expected to red on
     this changeset until a maintainer settles which category applies. Measured, both legs:
     (1) `type-surface-only packages/client/src/index.ts#delete` is REFUSED at predicate 4
     -- a reference is a bare identifier resolved to the FIRST same-named definition, and
     this file declares TEN members named `delete`; the first (line 2397) is unannotated at
     both revs, so the gate reads "still UNANNOTATED" about a member this diff never
     touched. That is issue #15627, filed off PR #15445 where the same ambiguity cost the
     `get` member its place in the marker -- here it blocks the ONLY member there is.
     (2) `no-migration-prescription` is mechanically ACCEPTED (the detector finds no
     prescription in this body) and is not claimed for that reason: ADR-0087's own D7
     records that #8277 held this exemption on a detector MISS rather than a positive
     finding, and names that as the pattern the sixth category was created to stop.
     Claiming it here, with the measurement in hand, would repeat it knowingly.
     Neighbouring open card: #14502. Full analysis in this PR's body. -->

The fifth and last method of the `oauth.*` family, and the one #14312 / PR #15445 deliberately could not close: its ruling fenced that card to *narrowing published return types*, and no declared return type could be true while the `res.json()` call stood.

## The defect, measured end to end

Real `betterAuth` + real `@better-auth/oauth-provider` over the real ObjectQL adapter on real SQLite, a real signed-up user and a real session, driven through the **real** `ObjectStackClient` with only the socket stood in for:

```
POST /api/v1/auth/oauth2/delete-client  ->  200 · 0 bytes
                                            content-type: application/json
                                            content-length: (absent)
through the client, BEFORE  ->  REJECTED: SyntaxError | Unexpected end of JSON input
the row, server-side        ->  ALREADY GONE (get-client answers 404 not_found)
through the client, AFTER   ->  RESOLVED | undefined
```

The handler returns nothing and the vendor declares the endpoint `void`. `res.json()` had nothing to parse, so the method rejected — *after* the delete had committed. A caller who did the obvious thing saw a failure, retried, and the retry failed **differently**, because the row no longer existed.

## What changes for a caller

| | before | now |
|:--|:--|:--|
| a successful delete | rejects `SyntaxError` | resolves |
| the resolved value | `any` (unreachable — the promise never resolved) | `void` |
| deleting a client that is not there | rejects `not_found` | rejects `not_found` — unchanged |
| a malformed non-empty body | rejects `SyntaxError` | rejects `SyntaxError` — unchanged |

⚠️ **The `catch` you wrote around this call stops firing on success.** Code shaped like

```ts
try { await client.oauth.applications.delete(id); }
catch { /* the delete probably worked anyway */ }
```

still compiles and still runs, but its catch block was executing on **every** successful delete and now executes only on a real failure. Any workaround that lived in there is now inert and can be deleted. And because the promise never used to resolve, a read off its resolved value — `(await …delete(id)).deleted` — was dead code that has never executed; it now stops compiling (TS2339), which is the compiler delivering the change at the call site.

## Why `void`, and not `{ deleted: boolean }`

"Deleted" and "was already gone" **are** distinguished by the route, but on the error channel: a missing client answers 404 `{ error: 'not_found' }`, which the client already raises as a throw. The 200 answer carries zero bytes and therefore zero information, so a synthesised `{ deleted: true }` would be a shape the wire never sends and strictly less informative than the 404 a caller already receives.

## Why the emptiness is detected by reading the body

Both shortcuts were measured against the real route and both are unusable: the status is **200**, not the `204` five other delete surfaces in this client key off, and the response carries **no `content-length` header at all** — so a header test would never fire and would leave the defect in place while looking like a fix. The body itself is the only thing that answers.

A non-empty body is still parsed and its failure still thrown, so **the only behaviour this change moves is the zero-byte case**: a malformed response stays loud, and the day this route grows a payload, surfacing it is a deliberate widening of the return type rather than a silent change of shape.

`packages/client/exported-any-returns.json` loses this method's entry in the same change — the ledger is shrink-only, so the entry goes **with** the binding. Its last `oauth.*` entry is now gone; 35 sites remain open.
