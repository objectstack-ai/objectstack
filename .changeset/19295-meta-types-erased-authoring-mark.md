---
"@objectstack/metadata-protocol": minor
---

`GET /meta/types` now marks a member whose AUTHORING arm the output derivation erased, so a consumer can tell an erased authoring type from a member that genuinely admits anything (#19295).

Every predicate slot the platform serves — `hook.condition`, `field.visibleWhen` / `readonlyWhen` / `requiredWhen`, a flow `edge.condition`, `job.schedule.expression` — composes the expression-input family, a two-arm union whose string arm is a `ZodPipe`. The served derivation is zod's default `io: 'output'`, which describes what comes OUT of the transform, so the arm's own input type is erased and the member is served as

```json
{ "anyOf": [ {}, { "type": "object", "properties": { "dialect": {}, "source": {} } } ] }
```

On the wire `{}` means "admits everything", so a metadata designer could not tell that husk from a member that really does accept any instance, and a condition builder had to veto both.

Each such husk arm now carries one vendor-prefixed keyword:

```json
{ "x-objectstack-erased-authoring-input": { "version": 1, "type": "string" } }
```

`Clause-②: no`

- **Read the mark, never the key name.** A consumer that enables a builder by matching `hook.condition` / `visibleWhen` / the rest keeps a second, hand-written copy of that list and drifts the moment a new predicate slot lands. The keyword is the whole contract, and `version` travels inside the value so a consumer gates on the shape it understands rather than on mere presence.
- **It constrains nothing.** JSON Schema ignores an unrecognised keyword, so every document accepts exactly what it accepted before — the payload is byte-different and semantically identical. This is deliberately NOT the blanket `io: 'input'` derivation, which was measured across the served surface and refused as a weakening of a published contract (24 of 26 types answer differently; `required` entries 1132 to 867). That refusal and its pin are untouched.
- **The predicate is structural, and declines on absence of evidence.** Three facts must hold: the emitted subschema admits everything, the zod node behind it is a pipe, and the pipe's input side derives a named `type`. `z.unknown()` and `z.any()` emit `{}` too and are not pipes, so they stay bare — including the ADR-0089 envelope's own `ast`, which sits one level below a marked arm. Measured over the served surface: 78 marked arms across eight types, 187 `{}` nodes left unmarked.
- **`action` carries no mark, and that is the honest answer.** It is the one type served from the `io: 'input'` retry, where a pipe derives from its input side, nothing is erased, and the predicate slot already publishes its real string arm.
