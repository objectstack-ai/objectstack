---
"@objectstack/lint": minor
---

feat(lint): the five gating object rules cross the runtime publish gate — `object` writes are now judged by `validateFunctionalCompleteness`, `validateManagedApiMethods`, `lintAutonumberFormats`, `validateRuleCompilability` and `validateRuleSchemaFormats` (#4716)

An `active`-state `object` save through `saveMetaItem` (Studio's field editor,
REST `/meta` item CRUD, an MCP/AI author) is now refused with the existing 422
`invalid_metadata` envelope when it carries a defect these five rules judge:
an inert `summary`/`lookup`/`select` shape, a managed-API verb the object's own
affordances refuse, an autonumber format referencing an unknown field, a
`format` regex or `json_schema` schema the runtime's own compilers reject, or a
`json_schema` `format` name ajv would silently drop. All five already gated
`os validate` / `os build` / `os lint`; the runtime door — the only door a
tenant overlay row has — ran none of them.

Scope is deliberately the five **gating** rules only (the #4716 adjudication):
the six advisory-tier object rules stay off the runtime surface, so a clean
save's response is byte-identical and no new advisory volume reaches Studio's
designer. Draft saves are untouched (D1), stored rows keep being served
(ADR-0087 asymmetry — the gate's differential blames a write only for what it
adds), and `OS_ALLOW_UNLINTED_METADATA_WRITES=1` still degrades the refusal to
a loud log for migration windows.

Boot-path note: the two schema-judging rules load ajv lazily, only when the
judged snapshot actually carries a `json_schema` validation — an ordinary
field edit still loads no compiler, which `runtime-lazy-deps.test.ts` now pins
as a three-tier contract (parsers never; ajv never without a schema; ajv
required, on demand, when one is present).
