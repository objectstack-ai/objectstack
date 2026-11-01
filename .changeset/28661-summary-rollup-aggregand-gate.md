---
'@objectstack/lint': minor
'@objectstack/metadata-protocol': patch
'@objectstack/types': minor
'@objectstack/rest': patch
'@objectstack/runtime': patch
---

fix(lint,metadata-protocol,rest,runtime,types): a roll-up the engine refuses at every recompute is refused at save and publish, and a child write that landed answers its success (#28661)

Clause-②: no
Metadata-protocol: narrowed
Skills-docs: none — `skills/objectstack-data/rules/relationships.md` and `rules/field-types.md` teach `summaryOperations` only with `sum` over a numeric `amount` and `count`; no file under `skills/**` teaches a `sum`/`avg` over a text field or a roll-up naming a missing child, and every taught example stays admitted.

**Narrowed** for a `summary` field whose `sum` or `avg` names a child field the engine does not aggregate, and for one whose `summaryOperations.object` names no object in the deployment.

- **Before.** A published `summary` field with `sum` or `avg` over a child `text` field published as valid (`publish-drafts`, the draft's `_diagnostics: { valid: true }`, `os validate`, `os build`). Every later create, update and delete of a child then answered `500 INTERNAL_ERROR`, though the write had landed and the parent's valid roll-ups had recomputed: the recompute's aggregate refuses the pair after the commit. A client that retried a create made a duplicate. A `summaryOperations.object` naming no object (`qsf_nope`) published as valid too, and the roll-up read nothing.
- **Now, at the doors.** The roll-up rule moves from `os lint` alone into the authoring-rule registry (`lintSummaryRollups`, gating, on `os validate`, `os build`, `os lint` and the runtime object save/publish door). A `sum` or `avg` over a child field outside the aggregate × field-type table (`AGGREGATE_FIELD_TYPE_COMPATIBILITY`, the table the engine's aggregate door reads) is refused under `rollup/non-numeric-aggregand`, at `objects.<parent>.fields.<field>.summaryOperations.field`, with the accepted child types and `count` as the fix. The `min`/`max` arm `os lint` already reported keeps its message and now also gates `os validate` and `os build`. A child object that names no object in the deployment is refused under the new `rollup/unknown-child-object`, at `…summaryOperations.object`, at the runtime door only: a child staged as a draft in the same publish batch is admitted, and `os validate` judging one app stays silent, because the child may come from another package. `os lint` no longer reports the rule a second time.
- **Now, after a write.** When a parent's roll-up cannot be recomputed after a child write — a roll-up stored before this gate, or any other recompute failure — `POST`, `PATCH` and `DELETE /api/v1/data/:object[/:id]` answer the write's own success (`201`/`200`, the same body the write answers when every roll-up recomputes), on both `RestServer` and the runtime dispatcher. The stale summary column is logged once per field at `error`, with the fix. The protocol's `createData`/`updateData`/`deleteData` still throw `ERR_SUMMARY_RECOMPUTE` carrying `written`, so the import runner and seed loader read it as before. The recogniser and the earned-answer carrier (`isSummaryRecomputeRefusal`, `earnedAnswerOf`, `staleSummaryAnswerLines`) are new exports of `@objectstack/types`, the one package the protocol, `rest` and `runtime` all depend on.
- **Who moves.** No `examples/**` or `hotcrm` roll-up is refused: every `sum`/`avg`/`min`/`max` there aggregates a `number` or `currency` child field, and every child object exists.

<!-- adr-0087: not-required (no-migration-prescription) the diff registers no retirement and no key changes shape: a roll-up summing or averaging a non-numeric child field, or naming a missing child object, never answered a value, and the fix is an authoring choice (a numeric child field, count, or the right child object) that no mechanical rewrite can make -->
