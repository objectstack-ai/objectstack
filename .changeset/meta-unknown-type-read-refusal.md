---
"@objectstack/rest": patch
---

fix(rest): `GET /api/v1/meta/:type` refuses a type name that names nothing, instead of serving it as an empty collection (#9488)

<!-- adr-0087: not-required (no-migration-prescription) Nothing authorable is
renamed, retired or tombstoned, and no `packages/spec` declaration moves. This
narrows the accept-set of one READ route over type-name segments that were
already refused by the WRITE door for the same name, so there is no stored
configuration for a migration to prescribe a rewrite of. -->

```
GET /api/v1/meta/totally_invented_type   →  200 {"type":"totally_invented_type","items":[]}
PUT /api/v1/meta/totally_invented_type/x →  400 "'totally_invented_type' is not a metadata type"
```

The two doors disagreed about which type names exist. A
200-with-an-empty-collection is **indistinguishable from "this type exists and
holds nothing"**, so a typo'd or renamed type name read as an empty surface
rather than as a mistake — the same trap `GET /meta/app?id=<unknown>` was
already filed for, where the answer read to a runner as "the app metadata is
gone".

The list door now answers **`400` / `INVALID_REQUEST`**, naming the type: the
same status and the same code the write door has emitted since `PUT /meta//x`
was closed, so one condition has one answer on both doors. `INVALID_REQUEST` is
already registered to `@objectstack/rest` in the ADR-0112 `ERROR_CODE_LEDGER`;
no code is minted. The refusal is thrown rather than hand-built, so its wire
body is byte-identical to the write door's for the same condition.

**What still answers `200` with an empty collection**, because a type that
exists and has no items is the legitimate case the defect was indistinguishable
from — breaking it would be worse than the bug:

- every member of the static spelling contract (`sharing_rule`, `theme`,
  `objects`, `api`, …), whether or not the deployment holds one item of it;
- the live-only keys an ordinary `registerApp` produces — `data`, `kind`,
  `package`, `policy` — which sit outside the static contract but are
  enumerated by `GET /api/v1/meta/types`;
- a plugin's own type, which enters the live set as a side effect of
  registering items of it.

That is why the rule is the **union** of the two authorities the platform
already has — the static predicate the write door consults, and the live
listing `GET /meta/types` serves — rather than the static predicate alone.
Refusing on the static half alone would answer `400` for types this same
service advertises, which is the objection recorded when the write-side verdict
landed and was deliberately not raised on the read entries then. Neither list
is restated here; both are read from their producers.

The static verdict runs first and is silent for every accepted spelling, so an
ordinary list request pays nothing; the live listing is consulted only by a
request already headed for a refusal. If that listing cannot be read — no
`getMetaTypes` on the host's protocol, or a rejecting call — the route **fails
open** and keeps its prior answer: "no such type" is an existence claim, and
stating it while the authority that would know is unreachable is the mistake
the write door's own store probe avoids.

**Scope.** The list door only. The compound arity `/meta/lead/views/all_leads`
carries an *object* name in the `:type` segment, which no static contract can
enumerate, and is untouched. The single-item doors already refuse
distinguishably (`404 RESOURCE_NOT_FOUND`, or `501 NOT_IMPLEMENTED` on the
`/references`, `/layers`, `/history`, `/audit`, `/diff`, `/published` limbs), so
none of them carried this defect.
