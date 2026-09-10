---
"@objectstack/spec": minor
"@objectstack/plugin-security": minor
"@objectstack/service-analytics": minor
"@objectstack/verify": minor
---

fix(service-analytics)!: `POST /analytics/dataset/query` asks the OBJECT-level read grant before it serves an inline dataset (#16645)

<!-- adr-0087: not-required (no-migration-prescription) Nothing authorable is renamed, retired or re-typed: no `packages/spec` key changes its name, its type or its optionality, no stored shape moves, and every dataset, dashboard and analytics request body parses byte-identically to before — so `objectstack migrate meta` has nothing to rewrite and this changeset carries no rewrite instructions. What narrows is the ACCEPT SET of a published route at REQUEST time: `POST /analytics/dataset/query` (and the `/analytics/query` and `/analytics/sql` doors) now refuse a caller who holds no object-level read grant on an object the request reads, which is the same verdict `GET /data/<object>` already returns for that caller on that deployment. The remedy for a caller who is refused is a GRANT, held in permission-set data rather than in an authored file: the deployment gives the principal read on the object, exactly as it must today to use `/data`. There is no authored artifact and no stored representation for a migration to act on, and the additions to the contract are additive (a new OPTIONAL `ISecurityService.canReadObject`, new optional keys on three option payloads), which is a widening rather than a retirement. -->

**BREAKING** in the accept-set sense — an accept-set narrowing on a published
route — landing in the launch window as `minor` on all four packages (the
lockstep convention: during the window the bump level is not the carrier, this
banner and the disposition above are). Nothing that was already admitted
becomes refused **except** the requests `GET /data/<object>` refuses today for
the same principal, which is the defect. Nothing that was refused becomes
admitted.

`POST /analytics/dataset/query` now asks the OBJECT-level read grant before it serves an inline dataset, so the analytics door and `GET /data/<object>` reach one admission verdict on every driver.

The route accepts an inline dataset definition (`body.dataset`) from any authenticated caller. On a SQL driver the compiled statement ran through the driver's raw `execute()`, which is documented as a tenant-isolation bypass and which no middleware sits in front of — so the request reached the database having passed exactly ONE of the three read layers (the row scope, threaded since ADR-0021 D-C). A caller with **no grant of any kind** on an object received its row count, and with `dimensions` its grouped counts by any column, where the `/data` door answered `403 PERMISSION_DENIED` for the same principal on the same deployment. On the memory driver the identical request fell through to the ObjectQL engine, which applies all three layers in one place, and was refused. The exposure is not opt-in and an application cannot decline it: a deployment shipping 0 datasets and 0 dashboards has the identical surface, because the reachable slot is the inline definition rather than a declared one.

**This change NARROWS what the analytics doors accept.** Requests that were already refused by `/data` are now refused by analytics too; nothing that was refused becomes admitted. "Fails closed" is a statement about a WIRED provider: a deployment with no `security` service registered keeps its previous analytics behaviour by design, because on that deployment `/data` carries no object-level gate either and the equivalence is what is being defended.

- **`ISecurityService.canReadObject(object, context)`** (`@objectstack/spec`, optional) — the object-level half of a read, the sibling of `getReadFilter`'s row-level half. It exists because the two are not interchangeable: `getReadFilter` answers "which rows" and answers `undefined` — "no row restriction" — for a caller who may not read the object at all, so a door holding only the filter reads a caller with NO grant as a caller with NO restriction. Fails CLOSED. Absence is a defined state and its fallback is **not** "admit": a consumer composes the same verdict from `explain`, which is not optional.
- **`@objectstack/plugin-security` implements it** as the middleware's own read gate, arm for arm and in its order — the `isSystem` bypass, the "no permission sets resolved" skip, the #3545 fail-closed refusal on an unresolvable object posture, the ADR-0066 D3 `requiredPermissions` capability AND-gate, the `allowRead` CRUD grant, and the ADR-0090 D10 delegator intersection — from the same primitives the middleware calls, and it is exposed on the registered `security` service.
- **`@objectstack/service-analytics` asks it once at the door**, for the base object and every joined object, **ahead of strategy selection**. Placement is the fix: two strategies each enforcing their own copy of three layers is the CAUSE of the divergence, not its remedy, so both strategies — and any strategy added later — inherit one verdict by construction. `AnalyticsServicePlugin` auto-bridges the new `admitObjectRead` hook to the `security` service (`canReadObject`, falling back to `explain`), the same way it already bridges `getReadScope`, and warns loudly at init when no security service is registered. The bridge tells three resolutions apart: an ABSENT `security` service admits (that deployment has no object-level gate on `/data` either, so the two doors still agree, and this is what keeps a deployment shipping no `plugin-security` working as before); a service that cannot be USED — resolving it throws, or it exposes neither `canReadObject` nor `explain` — DENIES and reports at `error`, because `/data`'s middleware does not fall open in those states.
- **`@objectstack/verify`** gains `bootStack(app, { databaseDriver: 'sqlite-wasm' | 'memory' })`, because a two-driver equivalence property cannot be measured on one driver — which is how the strategies were allowed to disagree.

The refusal is `PERMISSION_DENIED` / 403, the same code and status the engine path already answers, and it names only the object the caller themselves named.
