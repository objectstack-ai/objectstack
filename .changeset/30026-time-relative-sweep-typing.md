---
'@objectstack/lint': minor
'@objectstack/mcp': minor
---

fix(lint)!: a time-relative flow whose start node names no `objectName` has its conditions typed against the object it sweeps (`timeRelative.object`), so a text-vs-number comparison there is refused like on a sweep of the start node's object; a sweep of another object is told why it only warns; and `validate_expression` takes the swept object (#30026)

Clause-②: yes (narrowing) — the author-time gate (`os build`, `os validate`, the package publish and the flow publish door) refuses a `type-mismatch` in the start, edge and `decision` conditions of a time-relative flow whose start node names no `objectName`, which it passed with no type verdict at all before. Added beside it (the widening half): the optional `sweepObject` input of the `validate_expression` MCP tool.
Metadata-protocol: narrowed
Skills-docs: updated here — the MCP skill text in `packages/mcp/src/skill-md.ts` (the new `sweepObject` input); `skills/**` teaches no time-relative flow condition with a text-vs-number comparison, so no skill or eval moves.

<!-- adr-0087: not-required (already-registered flow-record-read-and-decision-type-mismatch-refused) the entry already prescribes this exact rewrite for a time-relative flow's conditions: the same refusal code, the same replacement and the same reason (each run's record is a row of the swept object); this change extends it to a sweep whose start names no objectName -->

**BREAKING** accept-set narrowing at the author-time expression gate, served by `os build`, `os validate` and `POST /api/v1/packages/:id/publish-drafts`.

- **Before.** A time-relative flow was typed only against its start node's `objectName`. A start that named none, with the swept object in `timeRelative.object` (the key the descriptor requires), got no type verdict on its conditions at all: `title > 5` on a text field published clean, and every run the sweep launched failed at that condition.
- **Now.** The conditions of such a flow are typed against `timeRelative.object`: each run's record is a row of that object, so a text-vs-number comparison in its start, edge or `decision` conditions is refused as `type-mismatch-run-fails`, the verdict a sweep of the start node's object already gets. Field reads, the shadowing warning and the root check are judged against the same object.
- **A sweep of another object** (the start node's `objectName` is not `timeRelative.object`) keeps the `type-mismatch-run-may-fail` warning, and the flow now gets one more warning, at its start node's `config.objectName`, saying why: the conditions are checked against that object's fields while each run's record is a row of the swept one. It is served only on a flow that got a warning it explains.
- **`validate_expression` (MCP).** New optional input `sweepObject` (site `flow_condition` with `triggerKind: 'time_relative'` only; a tool error anywhere else): the flow's `timeRelative.object`. When it is another object than `objectName`, a type mismatch is the gate's warning instead of the run-fails error. A call that does not pass it answers as before.
- **Correction to the 18.x changeset of the flow-condition type check.** It described a time-relative flow whose `timeRelative.object` "is omitted" as sweeping the start node's object. That shape never binds: `TimeRelativeTriggerSchema` requires `object`, and the gate refuses its absence (`flow-time-relative-descriptor-invalid`). Such a flow now gets the warning, not the run-fails verdict, on its conditions, since no run of it binds a row.

**FROM → TO.** In a time-relative flow whose start names no `objectName`, sweeping `crm_opportunity` with a text field `title`: `title > 5` (or `record.title > 5`, or a decision branch `title * 2 > 10`) → `size(title) > 5` for its length, a number field for a value, or `double(title) > 5` only when every value is numeric text. A flow whose start names one object and sweeps another: set the start node's `objectName` to the swept object, or remove it.
