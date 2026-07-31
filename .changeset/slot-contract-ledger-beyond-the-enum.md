---
"@objectstack/spec": minor
"@objectstack/runtime": patch
---

fix(spec,runtime): the slot→contract ledger extends past `CoreServiceName`, and `/security` stops passing unvalidated input to the security service (#4127)

Batch 3 of the #4127 gate, after #4168 (`getService`) and #4176 (`resolveService`).

Three slots — `security`, `shareLinks`, `objectql` — each had a written
contract, a provider registering them, and call sites already inside the
contract. The only missing link was that the slot name was not a
`CoreServiceName` member, so nothing could connect them and all three sat behind
`as any`.

**The ledger extends past the enum rather than the enum growing.** The two
answer different questions, and conflating them is what left these untyped:
`CoreServiceName` answers *"what happens at boot when this slot is empty?"* — it
sits beside `ServiceCriticality` and drives startup orchestration and discovery,
so adding a member changes runtime behaviour and is effectively permanent. The
ledger answers *"what shape occupies this slot?"* — pure type information. These
three need only the second, so `ServiceSlotContracts extends CoreServiceContracts`
adds them there and `resolveService` keys on `keyof ServiceSlotContracts`. Zero
runtime effect. If one is later promoted to a genuine core service, its entry
moves up and nothing else changes.

Evidence, as always, before an entry: `plugin-security` registers `security` and
`ISecurityService`'s own doc names that registration; `plugin-sharing` registers
`ShareLinkService`, which declares `implements IShareLinkService`; and `objectql`
is an **alias of `data`** — `packages/objectql`'s plugin registers the *same
instance* under both names two lines apart, so one object was resolving as
`IDataEngine` through one name and `any` through the other. `protocol` (22 call
sites) and `mcp` have no written contract and stay unmapped.

**Turning it on found four things, all on the `/security` admin surface:**

1. **Request input reached the security service unvalidated.** `?status=` was
   `String(query.status)` — any string — handed to a method whose contract
   declares exactly three values, and from there into the query's `where`
   clause. Not an injection (the `where` is structured, never interpolated), but
   `?status=garbage` matched no row and returned an empty list, which reads as
   "there are no suggestions" rather than "that is not a status". Now a 400.

2. **A test pinned that bug as expected behaviour.** The existing case asserted
   `status: 'open'` — not one of the three declared values — reached the service
   and returned 200. It proved the delegate carried *a filter* and nothing about
   that filter being a status. Same shape as batch 1's `auth.handler` mocks:
   coverage in appearance, a wrong contract in substance.

3. **and 4. Two writes could not prove they had a caller.**
   `confirmAudienceBindingSuggestion`/`dismissAudienceBindingSuggestion` declare
   `callerContext: SecurityContext` non-optionally — deliberately, since the
   read beside them declares it optional — and the domain passed a possibly-
   `undefined` execution context.

   **This was not a live hole**, and the distinction matters: with no execution
   context `shouldDenyAnonymous` already denied, because it sees no
   `userId`/`isSystem` and its allowlist arm needs a non-empty `path` this seam
   never passes, so it fell through to `return true`. What it never did was
   narrow `ec` itself — it only read `ec?.userId`. Checking `ec` directly is
   behaviour-preserving and makes the invariant legible to the compiler and the
   next reader.

The `?status=` rejection is the one **behaviour change**: an unknown status was
a silent empty list and is now a 400 naming the accepted values. The accepted
set is a `Record` keyed on the contract type, so adding a status to the contract
leaves a key missing and renaming one leaves a key excess — either fails to
compile, where a plain array would have drifted silently.

Verified: `@objectstack/runtime` **945 tests / 66 files** (+8), `@objectstack/spec`
**7141 / 274** (+29), plugin-security **677**, plugin-sharing **225**;
`tsc --noEmit` on spec, runtime, downstream-contract and all four examples;
`pnpm lint`; all nine `check:*` gates.
