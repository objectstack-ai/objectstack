---
"@objectstack/spec": minor
"@objectstack/service-automation": patch
"@objectstack/lint": patch
---

fix(spec): a node that publishes no descriptor configSchema can now own an expression-ledger entry (#4439)

`FLOW_NODE_EXPRESSION_PATHS` is the #4027 ledger that tells `registerFlow` and
`objectstack validate` which config keys hold expressions, and in which dialect.
Its ratchet (`config-expression-ledger.test.ts`) derives what it expects from
descriptor `configSchema` `xExpression` markers, and fails in **both**
directions — an undeclared marker, or a ledger entry nothing declares.

`decision` / `script` / `subflow` publish **no** descriptor `configSchema` on
purpose: a published partial schema would drop the editors their hand-written
Studio forms need (the #4210 incident), so their contract lives in
`schemaless-node-config.zod.ts`. Those two rules compose into a hole — an
expression slot on a schemaless node is structurally unreachable by the ratchet,
and because the reverse direction rejects unclaimed entries, it cannot be
entered by hand either.

`decision.conditions[].expression` sat in that hole. Its own schema says
*"Bare CEL predicate deciding this branch"* and its own comment names `{…}` as
the #1491 trap, and no validator walked it — so `{lead_record.status} ==
'converted'` passed `tsc`, passed `objectstack validate`, passed registration.
#4414 made that fail loudly at run time; this makes it fail at build time,
which is the delay #4027 exists to remove.

## The fix

The ratchet now reads **both** declaration channels:

- **descriptor `configSchema`** — unchanged, enumerated from the live registry;
- **`schemaless-node-config.zod.ts`** — the marker rides
  `.meta({ xExpression })` through `z.toJSONSchema`, the same channel
  `loop.collection` has used since objectui#2670.

Spec hands the second channel over as JSON Schema
(`getSchemalessNodeConfigJsonSchemas()`, memoized, `input` mode — the shape a
descriptor's `configSchema` already is), so the ratchet walks both with the
*same* function. No second notion of "a declared expression property", which is
the duplication a ledger exists to remove, and no `zod` dependency added to
`service-automation`. Each channel is separately asserted non-empty, so a broken
derivation on one side cannot hide behind the other's results.

`SCHEMALESS_NODE_CONFIG_SCHEMAS` is also exported for anything else that needs
to reason about all node config contracts. Additive — objectui's
`flow-node-config` reconciliation imports each schema by name and is unaffected.

## The sweep

The other schemaless slots were checked and deliberately carry no marker:
`script.template` is a template **id**, not a body; `script.inputs` /
`script.variables` / `subflow.input` are values that interpolate `{token}` —
text-with-holes, the shape essentially every node config string has, already
covered generically by `validate-flow-template-paths` and the CLI flow linter.
A `flow-template` ledger entry means something narrower: a *reference that must
resolve to a value*, like `loop.collection`. So `decision.conditions[]
.expression` is the only genuinely declared expression slot on the class — now
recorded in the ledger's header so it is not re-derived.

## Docs corrected

The flows guide taught the **wrong dialect** for decision predicates in three
places (`'{order_amount} > 10000'`), plus a "braces missing in a decision
expression" warning that inverted after #4414 — and `FlowNodeSchema`'s own
`@example` did the same. All corrected to bare CEL, with the history stated so
an author with a braced predicate knows what changed and why their build now
fails. The dialect table drops from three dialects to two: predicates never take
braces, values always do.

Verified: 13 new/updated tests across the ratchet, the engine's registration
pass and `@objectstack/lint` (including the exact app-crm predicate rejected at
both `registerFlow` and `objectstack validate`); `pnpm build`, `pnpm typecheck`
(122 tasks), `pnpm lint` and `check:docs` clean.
