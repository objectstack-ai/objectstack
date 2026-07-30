# ADR-0115: The stub table is retired — plugin-dev assembles real plugins, and an empty slot means the same thing in every mode

**Status**: Accepted (2026-07-30)
**Deciders**: ObjectStack Protocol Architects
**Builds on**: [ADR-0076](./0076-objectql-core-tiering.md) (D12 honest capabilities — its red line "a fallback may degrade features, never security semantics" and its conclusion 3 are the two rules this ADR generalizes), [ADR-0078](./0078-no-silently-inert-metadata.md) (no silently inert declarations — a filled slot that fabricates is the runtime-service form of the same lie), [ADR-0049](./0049-no-unenforced-security-properties.md) (enforce-or-remove — the disposition method reused here)
**Consumers**: `@objectstack/plugin-dev` (the stub table and registration loop), `@objectstack/core` (`src/fallbacks/` becomes the one memory-fallback family), `@objectstack/runtime` (no changes — the #4086 gates already treat `handlerReady: false` as an empty slot), `content/docs/plugins/packages.mdx` + plugin-dev README (descriptions converge on reality)
**Surfaced by**: [#4093](https://github.com/objectstack-ai/objectstack/issues/4093) — the one-level-up question after [#4000](https://github.com/objectstack-ai/objectstack/issues/4000) (PR #4062) and [#4058](https://github.com/objectstack-ai/objectstack/issues/4058) (PRs #4082/#4086) retired four stubs one at a time

---

## TL;DR

plugin-dev's founding design — *"any core-service slot not occupied by a real plugin gets a dev stub, so the full kernel service map is populated"* — is **retired as a design**, not shaved one slot at a time. Its stated premise (downstream code needs correct return types instead of `undefined`) is refuted by the platform's own production semantics: every one of these services is optional, so every consumer must already survive an empty slot, and a consumer that cannot is a production bug to fix — not to mask in dev by feeding it fabricated data. Four slot retirements (#4000, #4058) proved this empirically; #4086 emptied three at once with every affected suite green and the kernel serving end-to-end.

What remains of plugin-dev is the part that was always its real value: **assembly** — one plugin that wires ObjectQL, driver-memory, auth, security, the HTTP server, REST, the dispatcher, and app metadata for a zero-config dev boot. An unoccupied slot stays unoccupied in every mode; "the capability is present" means the same thing in dev as in production.

Disposition is tiered (fabricators go first, duplicates merge into core's fallback family, the working in-memory implementations point at the real packages that already exist) — not a flag-day.

## Context

### The design under evaluation

`dev-plugin.ts` registers child plugins, then walks all 17 `CoreServiceName` slots plus the three `security.*` handles and fills every slot still empty from a `DEV_STUB_FACTORIES` table (a slot with no factory gets a shapeless `{ _serviceName }` placeholder). The comment above the loop states the premise: fill the map *"so that … downstream code receives correct return types (arrays, booleans, objects — not undefined)"*.

The design has been dismantled one slot at a time by the D12 lineage: #3891/#3989 retired the degraded analytics *shim* because honest labelling could not fix fabricated security semantics; #4000 retired the dev analytics *stub* because refilling the slot re-created the retired shape one layer down; #4058 step 1 (#4082) replaced the blanket `_dev: true` with per-implementation honesty classes; #4058 step 2 (#4086) retired `automation`, `notification`, and `ai` and gated every dispatcher domain on `handlerReady`. #4093 asks the question those four retirements kept converging on: whether the table itself should exist.

### State after #4086

| Class | Slots | Implementation |
|:---|:---|:---|
| `degraded` (really works, in-memory) | `cache`, `queue`, `job`, `i18n` | wrappers around core's `createMemory*` |
| | `metadata` | a second hand-written copy of core's fallback |
| | `file-storage`, `search`, `realtime`, `workflow` | plugin-dev-only implementations |
| `stub` (fabricates) | `data`, `auth`, `security.permissions`, `security.rls`, `security.fieldMasker` | hand-written |
| | `ui` | no factory → shapeless `{}` placeholder |
| retired | `analytics` (#4000), `automation`, `notification`, `ai` (#4058) | — |

### Evidence 1 — the premise is refuted by production semantics

In production every one of these slots is empty unless a real plugin is installed: the services are optional, and since #4086 the dispatcher, the route mounts, and discovery all treat an unserveable occupant exactly like an empty slot. So the population of consumers the stub table claims to protect — code that breaks on `undefined` — either does not exist (nothing surfaced across four retirements: runtime 923 / plugin-dev 8 / objectql 1183 / metadata-protocol 99 tests green, kernel + dispatcher serving end-to-end) or is broken *in production*, where no stub will save it. The premise assumes the very bug class it purports to prevent, and hides it where it would otherwise surface loudly.

The two `data`-service consumers in the repo (`runtime/src/default-datasource-plugin.ts`, `service-automation/src/builtin/crud-nodes.ts`) illustrate the correct pattern: both resolve defensively and tolerate absence, as the `security-service` contract explicitly instructs (*"Consumers MUST tolerate absence … rather than assume registration"*).

### Evidence 2 — the security-shaped fakes cross the D12 red line

ADR-0076 D12 (via #3891): **"A fallback may degrade features, never security semantics."** Three stubs do exactly the latter, in the fail-open direction:

```ts
security.permissions → checkObjectPermission() { return true; }   // allow-all
security.rls         → compileFilter()        { return null; }    // no row filter
security.fieldMasker → maskResults(r)         { return r; }       // no masking
```

`packages/spec/src/contracts/security-service.ts` says these three handles "are implementation internals and deliberately NOT part of this contract" — they belong to `plugin-security`'s own interior. plugin-dev fabricates another plugin's internals, and against the same contract's fail-closed stance (*"Access-narrowing answers fail CLOSED … never treat a thrown error or a deny filter as 'no restriction'"*). The trigger is one missing dependency: plugin-dev degrades gracefully per child plugin, so a stack where `@objectstack/plugin-security` fails to load gets one `warn` line and a silently allow-all, unfiltered, unmasked data plane.

Precision, for the record: the `auth` stub is **dead code on the real identity path** — `resolve-execution-context.ts` authenticates via `authService.api.getSession()` / `getApi()` / `verifyMcpAccessToken()`, none of which the stub implements, so identity degrades to anonymous (fail-closed, and #3963/#4043 deny anonymous data access). It is a *potential* hole, not a live one: `verify() → { success: true, user: { roles: ['admin'] } }` is precisely the shape the next consumer would trust, and the occupied slot makes discovery advertise auth as present.

### Evidence 3 — the duplicate family, with a paid receipt

`metadata` is a hand-written second copy of core's `createMemoryMetadata` (`packages/core/src/fallbacks/memory-metadata.ts`). The cost is not hypothetical — `packages/core/CHANGELOG.md` (the #2111 follow-up) records one missing-`registerInMemory` bug fixed **in both copies**: *"Both in-memory `metadata` fallbacks (`@objectstack/core`'s `createMemoryMetadata` **and** `@objectstack/plugin-dev`'s dev stub) now implement `registerInMemory` …"*. Same shape as #3891's "the same security gate had to be built twice", at smaller stakes. The `cache`/`queue`/`job`/`i18n` entries delegate to core (no duplication), but they make plugin-dev a second *registration* path for implementations core already owns.

### Evidence 4 — published, unguarded, unused, misdescribed

- `@objectstack/plugin-dev` is **published** (`17.0.0-rc.0`, not private) and has **no environment guard** — nothing in `dev-plugin.ts` checks `NODE_ENV`; installing it registers the whole table wherever it runs.
- **No in-repo consumer**: `os dev` boots through serve's real capability assembly (`cli/src/commands/dev.ts` never references `DevPlugin`); examples, `create-objectstack` templates, and apps have no usage. The stub table protects nobody in this repository.
- The docs entry (`content/docs/plugins/packages.mdx`) describes a different plugin altogether: *"Metadata validation, schema introspection, debugging tools"*. It neither validates metadata nor introspects schemas; it assembles a stack and fills slots.

### Evidence 5 (new in this evaluation) — Tier C's migration paths already exist, or are needed by nobody

#4093 held out the four working in-memory implementations (`file-storage`, `search`, `realtime`, `workflow`) as "the only tier worth discussing", with the open question of whether real InMemory strategies must be built before retiring them. Verified against source, the question dissolves:

- **`realtime`** — the real package already ships the strategy: `@objectstack/service-realtime` contains `in-memory-realtime-adapter.ts` and registers the `realtime` slot with it. plugin-dev's copy is a parallel duplicate of an existing dev path, i.e. Tier B in disguise.
- **`file-storage`** — `@objectstack/service-storage` is real (local-disk + S3 adapters, attachment lifecycle, its own routes) and registers `file-storage`. The local adapter is the dev path; an in-memory Map that loses files on restart is not a capability the platform needs a second copy of.
- **`search`, `workflow`** — **no code in this repository resolves either slot.** There is no `getService('search')` or `getService('workflow')` call site anywhere in `packages/` (the only touches are plugin-dev's own registration probe and the generic discovery walk); the dispatcher has no domain for them, and REST's `/api/v1/search` is the data-plane search, not the `search` service. These stubs serve no reachable code path — retiring them can regress nothing. When a real search or workflow service ships, it brings its own InMemory strategy, exactly as `service-analytics` did (the #4000 migration path).
- **`ui`** — same verification: zero consumers of the slot; the shapeless placeholder exists only so `getService('ui')` doesn't throw for a caller that does not exist.

## Decision

**D1 — The stub table is retired as a design.** plugin-dev's contract is **assembly**: instantiate and wire the real plugins for a zero-config dev boot. It registers no service implementations of its own; a slot no child plugin fills stays empty, and the #4086 machinery already makes empty slots honest (404/501, `unavailable` in discovery) identically in dev and production. A consumer that breaks on an empty optional slot is a production bug — fix the consumer (fail closed, or feature off), never feed it fabricated data in development. This closes the class the D12 lineage retired one member at a time.

**D2 — The fabricators go first and wait for nothing else (Tier A: `security.permissions`, `security.rls`, `security.fieldMasker`, `auth`, `data`, and the shapeless `ui` placeholder).** The security trio violates the D12 red line today and fakes another plugin's declared implementation internals in the fail-open direction; `auth` is fail-closed-by-accident (Evidence 2) and stays only until someone consumes the shape it advertises; `data` and `ui` fabricate or occupy for consumers that handle absence anyway. Empty is the production semantic; these slots get it now. This tier is deliberately independent of any discussion about dev ergonomics — none of these six ever provided any.

**D3 — One memory-fallback family, owned by core (Tier B: `metadata`, plus the `cache`/`queue`/`job`/`i18n` wrappers).** plugin-dev's hand-written `metadata` copy is deleted; core's `createMemoryMetadata` is the only one. The four delegating wrappers are dropped with it — core's fallbacks and the service packages' own memory adapters (`service-cache`/`service-queue`/`service-job`, `I18nServicePlugin`) are the registration paths; plugin-dev stops being a third. Lands together with [#4089](https://github.com/objectstack-ai/objectstack/issues/4089) (core fallbacks get `__serviceInfo`), which settles "who is the one copy" and its honest self-description in a single change.

**D4 — Tier C retires without a rebuild phase (`file-storage`, `search`, `realtime`, `workflow`).** Per Evidence 5 there is nothing to build first: `realtime` and `file-storage` point at `@objectstack/service-realtime` / `@objectstack/service-storage` (which exist and self-register), and `search` / `workflow` have no consumers to lose. The tombstone lives in the changeset and the retirement messages: *install the real service*. Resolves #4093 open question 2 — the "InMemory strategies first" ordering was predicated on the strategies not existing; they exist where they should (in the real packages), or the demand for them doesn't.

*Refinement (maintainer review, 2026-07-30):* the dev-experience cost drops to near zero because Tier C's correct landing shape is **assembly, not absence**: plugin-dev's child-plugin list grows optional entries for `@objectstack/service-storage` and `@objectstack/service-realtime` — dynamically imported, wired when installed, skipped when not, exactly the existing 3b i18n auto-detect precedent (`I18nServicePlugin` when translations are present). The zero-config dev promise is kept by real implementations instead of fakes. `search`/`workflow` get no such wiring: there is nothing to wire for a consumer that does not exist.

**D5 — Direct cut inside the 17.x rc window; the changeset carries the FROM → TO per slot.** No deprecation window and no stub-preserving grace release: the honest `stub`/`degraded` self-descriptions shipped by #4082/#4086 already are the deprecation notice (discovery has been telling every consumer these are not capabilities), and keeping an allow-all security fake alive one extra release "to be polite" is exactly what D2 forbids. External rc consumers get the standard breaking-changeset prescription (Post-Task Checklist rule: FROM → TO and the one-line fix — *install the corresponding real service, or handle the absent slot as production already requires*). Resolves open question 1.

**D6 — plugin-dev grows a production guard, in the same change as Tier A.** `DevPlugin.init` throws when `NODE_ENV === 'production'`, escape hatch `OS_ALLOW_DEV_PLUGIN=1` (Prime Directive #9 `OS_ALLOW_*` shape — deliberately scary; the shipped name, landed by #4126's subset). Deleting the fakes removes the security-semantics hazard; the guard covers what deletion cannot: the plugin still assembles a stack around a well-known default auth secret and a seeded dev admin, which no production deployment should get by accident. It does not ship as a separate earlier fix because Tier A itself waits for nothing (resolves open question 3 — the "maybe it shouldn't wait" concern was about the security stubs, and D2 removes them rather than gating them).

**D7 — The descriptions converge on what the plugin is.** `content/docs/plugins/packages.mdx` and the plugin README/class doc describe an assembly plugin ("auto-wires ObjectQL + driver-memory + auth + security + HTTP server + REST + dispatcher + app metadata for local development"); the "Stub services" section and the "simulating all 17+ kernel services" claim are removed. Docs describing the retired design are ADR-0078's silent lie in prose form.

### What deliberately stays

- **plugin-dev itself.** Assembly is real value; nothing here shrinks `DevPluginOptions` or the child-plugin set. The `services` toggles keep governing child plugins.
- **Core's `fallbacks/` family.** Those are production degraded-mode implementations governed by D12 honesty (+#4089), not dev fakes — `handlerReady: true` because they really serve.
- **The #4086 gates.** Unchanged; this ADR removes the last producers those gates exist to catch, it does not remove the catch.

## Execution

Sequenced to avoid editing `dev-plugin.ts` under an in-flight PR. Ratified by the maintainer on 2026-07-30: D5's direct cut confirmed, and the tier work collapses into **two implementation PRs** — Tier A and Tier C are the same mechanical act on the same table (delete entries), so splitting them buys a second end-to-end verification round of the same file and a worse changeset narrative; Tier B stays separate because it reaches into core and carries #4089. Tracked in #4104.

1. **#4086 merges first** (open at evaluation time — #4058 step 2). Its classification table is this ADR's baseline, and its tests are the harness the removals run against.
2. **PR-1 — Tier A + Tier C + guard + assembly auto-wire** (D2 + D4 + D6): delete the six fabricator entries and the four in-memory implementations, simplify the registration loop, add the production assert, wire the optional `service-storage` / `service-realtime` child plugins, one breaking changeset carrying the full FROM → TO table per slot. (If #4086 stalls in review, the guard alone may ship first — it touches only the top of `init` and conflicts with nothing.)
3. **PR-2 — Tier B + #4089 + docs** (D3 + D7): `__serviceInfo` on core's five fallbacks; delete plugin-dev's `metadata` copy and the four wrappers — the stub table and fill loop die here entirely; packages.mdx entry, README, and class doc converge.

End state, mechanically checkable: `DEV_STUB_FACTORIES`, `DEV_STUB_SELF_INFO`, `SHAPELESS_STUB_SELF_INFO`, `NO_DEV_STUB_SERVICES`, and the fill loop no longer exist in `dev-plugin.ts`; `grep -r "createMemoryMetadata\|registerInMemory" packages/plugins/plugin-dev` is empty. The two-PR split is the ratified shape; the tier boundaries remain the decision.

### Update (2026-07-30, post-#4086 reconciliation): executed as ONE PR

Three facts changed between ratification and execution, all shrinking the work:

1. **#4086's merged form deleted nothing.** It gated the six dispatcher domains on `handlerReady` and explicitly deferred "should the fabricators keep occupying slots" to this ADR's Tier A. So `ai` / `automation` / `notification` join Tier A's deletion list here — the Context table's "retired" row described their HTTP surface (gated to empty-slot answers since #4086), not their registration.
2. **#4089 closed at the source.** #4082 had already given core's five fallbacks their `__serviceInfo` self-descriptions, so Tier B's core half was done before PR-2 existed; what remained of Tier B was only plugin-dev's `metadata` copy and the four wrappers.
3. **With the core half gone, the PR-1/PR-2 boundary lost its reason** (Tier B no longer reached into core), and the maintainer directed completing all remaining work at once. The implementation therefore landed as one PR: Tiers A+B+C, the D6 guard, the D4 assembly auto-wire, and the D7 docs convergence — the full end state above, under a single FROM → TO changeset narrative.
4. **#4126 landed the D2 security trio + D6 guard as a first subset while the full PR was in flight.** Its choices are canonical where they overlap: the escape hatch is `OS_ALLOW_DEV_PLUGIN` (not the longer name this ADR first wrote), the guard is a module-level `assertNotProduction()`, and an empty security slot gets one loud boot-log warn ("RBAC, row-level security and field masking are NOT enforced") instead of silence. It also filed #4113 — the dispatcher's `/auth` domain carries its own mock fallback in `packages/runtime` — as the remaining fabricator OUTSIDE plugin-dev; retiring plugin-dev's `auth` stub neither worsens nor fixes that path (both the stub and the runtime mock fabricate a 200; neither yields a session the identity resolver accepts), so #4113 stays the one place that class of fake survives. *(Update: #4113 is now closed too — the `/auth` mock is deleted and an unserved `auth` slot answers 501. That makes this ADR's rule hold platform-wide rather than only inside plugin-dev, and it was the one member of the class that shipped to production rather than to a dev assembly. 501 rather than the 404 an empty optional slot usually takes, following `/i18n`: the route is mounted, the implementation behind it is not, and 404 would misdescribe that.)*

## Consequences

- **+** "The capability is present" has one meaning across dev and production; the D12 producer inventory for plugin-dev closes completely instead of shrinking by one per issue.
- **+** One copy of every memory implementation; the next `registerInMemory`-class bug is fixed once.
- **+** The published package stops shipping unguarded allow-all security shapes; discovery stops advertising services nobody implemented.
- **−** Breaking for any external 17.x-rc consumer that relied on a stub — mitigated by D5's changeset prescription, and softened in practice by #4082/#4086 having already advertised those slots as `stub`/non-serveable.
- **−** A dev stack without a given real service cannot "try" that capability at all. Accepted deliberately: that trade was already made four times (#4000, #4058), and the alternative was fabricated answers.
- **Risk**: a consumer outside this repo's test surface assumes a filled slot and now throws in dev. That is the design working — it surfaced a bug that production (empty slots) already had. The fix goes in the consumer, per D1.
