---
"@objectstack/spec": minor
"@objectstack/runtime": patch
---

fix(spec,runtime): a service-slot lookup returns the slot's contract, not `any` — and it immediately found two more gaps (#4127)

#4127's most valuable item was the one it did not do: "**给这个类别加个 gate**".
The four contract gaps it catalogued were found by a human sweeping the
dispatcher by hand. A sweep is not repeatable, and this one was not complete —
see `/auth` below.

The root was one line:

```ts
// domain-handler-registry.ts
getService(name: string): any;   // ← every domain's service handle
```

Against `any`, a domain calling a method its contract declares and a domain
calling a method nobody declares typecheck identically. That is what let #4087
ship a `/storage` handler passing two arguments no implementation takes, and
what hid #4127's four.

**`CoreServiceContracts` — the slot → contract ledger.** `CoreServiceName` named
the slots and `contracts/*` described them; nothing connected the two. It does
now, and `getService<K>(name: K)` resolves through it, so a call outside the
contract is a **compile error at the call site**.

An entry is a claim, so entries are only made where the binding is evidenced —
by the provider that registers the slot (`service-storage` → `file-storage`,
`objectql` → `data`, whose own comment reads "ObjectQL implements IDataEngine"),
or by dispatcher work that proved it (#4143/#4150 for `automation`,
`notification`, `i18n`). **`ui` is deliberately unmapped**: the slot exists and
`domains/ui.ts` serves it, but no `IUiService` was ever written. An unmapped slot
resolves to `unknown`, not `any` — it must be cast deliberately, so the gap stays
legible instead of looking checked.

**Two findings, within minutes of turning it on:**

**`/auth` called a method that does not exist.** `domains/auth.ts` probed
`authService.handler(request, response)`. `IAuthService` declares
`handleRequest(request): Promise<Response>`; `AuthManager` implements exactly
that and has no `handler`. The probe was false on every deployment — #4143's dead
`automation.trigger` again. **#4127's manual sweep never mentions `/auth`**,
neither in its gap list nor in its "扫干净的" list: the file the compiler flagged
first is the one the human pass skipped entirely.

Not a live hole: the Hono adapter calls `handleRequest` itself and only falls
through to the dispatcher when no usable auth service answered, so nothing was
served by the mock in that deployment. But reading the contract makes the branch
reachable for the first time — a host calling `handleAuth` directly WITH an auth
service registered used to get `mockAuthFallback`'s `mock_<uuid>` session instead
of real authentication, and now gets the auth service.

**`POST /analytics/sql` invoked an optional method unguarded.** `generateSql?` is
optional on `IAnalyticsService` — unlike `query`/`getMeta` beside it — and the
call had no probe, so a provider without it answers a 500 from `TypeError`
instead of saying the capability is absent. service-analytics implements it,
which is why nothing noticed; the contract permits a provider that does not, and
this slot is multi-provider by design. It answers `handled: false` now, the same
404 the file's entry gate already gives for absent analytics capability.

**`isServiceServeable` is a type guard now** (`svc is NonNullable<T>`). Every
domain already calls it first on a resolved slot, so one predicate narrows away
the `undefined` for the whole handler body — the null check and the capability
check were always the same check.

**The test-side hole, closed for this batch.** #4127's last section predicted it:
the mocks are written to what the handler wants, so handler and test agree with
each other and with no implementation. **Three** tests across two files mocked
`{ handler }` for auth — including one whose entire subject was the *resolution
path*, so it proved the lookup worked and nothing about the call. `ContractMock<T>`
(`Partial<Record<keyof T, unknown>>`) now guards the mocks: keys are checked
against the contract, signatures deliberately left `unknown` so `vi.fn()` does not
force everything back to `as any`. The automation mock's `trigger` — genuinely
not on the contract — stays as an explicit, labelled negative control outside the
checked literal, because a test asserting the route *never* calls it is the point.

Nothing is renamed and no runtime behavior changes except the two fixes above.
The 12 domains not calling `getService` are untouched; `resolveService` (which
also takes non-`CoreServiceName` names like `protocol` and `objectql`) is
deliberately left for a later batch rather than widened here.

Verified: `@objectstack/runtime` **933 tests / 65 files**, `@objectstack/spec`
**7095 / 272** (6 new, pinning the map against the enum in both directions),
service-automation **457**, service-analytics **413**, service-messaging **137**,
service-i18n **62**, adapter-hono **73**; `tsc --noEmit` on spec, runtime,
downstream-contract and all four examples; `pnpm lint`; and all nine
`@objectstack/spec` `check:*` gates — clean.
