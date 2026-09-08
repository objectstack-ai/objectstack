---
"@objectstack/cli": patch
"@objectstack/lint": patch
---

`objectstack build` now refuses to lower a hook/action body that calls `.create(`, and the shared write-pattern ledger stops advertising the verb. Three layers used to disagree about `ctx.api.object('x').create({ … })`, and the loudest one was wrong.

- The spec contract `IScopedObjectRepository` (`packages/spec/src/contracts/scoped-context.ts`) declares `insert` and names `create` as measured-and-deliberately-excluded.
- The QuickJS sandbox installs exactly `insert / update / delete / updateMany / deleteMany / upsert` as the `ctx.api.object()` write leaves — no `create`. An L2 body calling `.create()` therefore threw `TypeError: not a function` on its **first run**, and under a hook's default `onError: 'abort'` that throw aborted the triggering write, with a message naming no member.
- The extractor ledger nonetheless advertised `.create({…})` as legal `api-crud-literal` syntax and mapped it in `API_WRITE_METHODS`, so `hook-body-write-unknown-field` graded the payload as a live write and stayed silent when the field existed — a clean bill of health for a call that cannot run. Build time said nothing at all.

What changes:

- **`@objectstack/cli`** — `.create(` joins `FORBIDDEN_PATTERNS` in the hook/action body extractor, beside `.sudo(` and for the same reason (a member real on the in-process `ScopedContext` / `ObjectRepository` and absent from the VM). The refusal names `.insert({ ... })` as the spelling the sandbox actually has. Behaviour is the `forbidden-token` fallback every other entry has: the callable is still registered and still shipped through the back-compat `.mjs` bundle, so a handler keeps running in-process where the host `create()` alias exists — `objectstack build` merely declines to *also* emit it as a body that cannot run. Under `--strict-body` it is a hard failure, correctly. The rule is receiver-loose like `.sudo(` (`const repo = ctx.api.object('x'); repo.create(…)` is refused too) with one carve-out: `Object.create()` is a real sandbox global and is **not** affected.
- **`@objectstack/lint`** — `create` is withdrawn from `HOOK_BODY_WRITE_PATTERNS`' advertised `api-crud-literal` syntax and from `API_WRITE_METHODS`, on the hook and action surfaces alike. `hook-body-write-unknown-field` / `action-body-write-unknown-field` no longer grade a `.create()` payload; `hook-api-update-readonly-field` keeps its existing `create` exclusion, whose *reason* is updated — it is no longer "the call throws, so a silently-dropped finding would be false" but "the shape can no longer reach this rule at all".

**Migration.** If a hook or action body calls `ctx.api.object('x').create({ … })`, spell it `ctx.api.object('x').insert({ … })` — the same host method, the one the sandbox installs and the only insert verb the contract declares. The host-side `ObjectRepository.create()` alias is untouched and stays reachable from in-process handlers and actions.
