---
"@objectstack/spec": minor
"@objectstack/runtime": patch
---

fix(runtime,spec): guard the service-lookup typing with a lint rule — which immediately found the project-membership gate not gating (#4127)

Batch 4 of the #4127 gate. #4168/#4176/#4202 made a slot lookup return the
slot's contract. Nothing protected that: an `any` annotation on the **result**
switches the checking back off for that call site, silently, with no test
failing and no visual difference from code that has it. Three such sites already
existed and were found by grep — the same unrepeatable sweep this work replaced.

**The rule** bans `: any` / `as any` on a `resolveService` / `getService` /
`getRequestKernelService` result. Slots with no written contract (`protocol`,
`mcp`, `kernel-resolver`, `scope-manager`) are exempted **by name, centrally**,
in `eslint.config.mjs` — not by inline disables, because `pnpm lint` runs
`--no-inline-config` and ignores those on purpose. The effect is the one worth
having: a deliberate gap is a reviewed line in one file, a careless one is a
build failure, and they stop looking identical in the code.

**Its first run found a live fail-open.** `enforceProjectMembership` read the
session as `authService?.api?.getSession?.(…)` with no `getApi()` fallback — the
only one of the codebase's three `.api` readers without it. `plugin-auth`
registers `AuthManager`, which has **no `.api` member at all**. So the read
yielded `undefined`, `userId` stayed unset, and the function returned at its
"anonymous — upstream auth will decide" line **before ever querying
`sys_environment_member`**. A signed-in non-member passed the gate, on every
deployment with project scoping on — which is where the flag defaults to true.
Anonymous callers were still denied elsewhere (#2567/#3963), so this was
specifically the signed-in-non-member case.

The existing test for that gate mocked auth as `{ api: { getSession } }` — the
legacy shape the shipped provider does not have — so it was green throughout.
That is the **fourth** test in this work line found encoding a contract nobody
implements, after batch 1's three `auth.handler` mocks and batch 3's
`status: 'open'`. The new test uses the `getApi()` shape and fails against the
pre-fix code.

**Also found by the rule**, all the same #4127 shape (implemented, called,
undeclared) and all now declared: `IAuthService` gains `api`, `getApi`,
`isAuthGateActive` and `verifyMcpAccessToken`; `IMetadataService` gains `load`
and `loadDiagnosed`. `getApi`'s return type is the **evidenced subset** —
`getSession({headers})` and the three fields callers read — not a re-declaration
of better-auth's handle, which belongs to that library.

**And the pattern's real root:** the lookup facade returning `any` was
re-declared in **three** places. Batches 1-3 typed `DomainHandlerDeps` and left
`ActionExecutionDeps` and `resolve-execution-context`'s `ResolveOptions` still
saying `any` — so the copy that stayed untyped was the way around all the
others, and it is where the auth reads lived. All three are typed now.

Completing the interface: `getRequestKernelService` gets the same overload split
(its one caller resolves the same `objectql` slot the `resolveService` fallback
beside it does, so the two arms of one expression had different types), and
share-links' `getEngine` loses a `Promise<any>` return annotation — a **third**
erasure syntax after `: any` and `as any`, and one this AST rule cannot see.
That residual is documented in the config.

`getObjectQL` **stays** `any`, deliberately, with the reason recorded: it exists
to reach ObjectQL's surface beyond `IDataEngine` (`registry`, `executeAction`),
which has no contract. Typing it `IDataEngine` would be the comfortable-looking
lie.

Verified: `@objectstack/runtime` **952 tests / 67 files**, `@objectstack/spec`
**7147 / 275**, plugin-auth **579**, rest **512**; `tsc --noEmit` on spec,
runtime, downstream-contract and all four examples; `pnpm lint` (with
`--no-inline-config`); all nine `check:*` gates.
