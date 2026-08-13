---
'@objectstack/spec': major
'@objectstack/metadata-protocol': major
---

`field` loses `allowRuntimeCreate` — a standalone `field` write is refused instead of silently doing nothing (#7893, ADR-0049 enforce-or-remove, maintainer-ruled 2026-08-12)

**BEHAVIOUR CHANGE — what now gets refused, and what to do instead.**

| | Before | After |
| --- | --- | --- |
| `PUT /api/v1/meta/field/{object}.{name}` | `200 {"success":true,"state":"active"}` — row persisted, `_diagnostics.valid: true`, and the field **never** appeared in the object's `fields` | `403 NOT_CREATABLE`, naming the remedy |
| `PUT /api/v1/meta/fields/{object}.{name}` (plural) | `200` — same, via the URL fold closed in #7894 | `403 NOT_CREATABLE` — folds onto the singular and earns the same verdict |
| `PUT /api/v1/meta/object/{name}` with the field in `fields` | `200`, and the field **is** read back | unchanged — this is the route to use |

**The one-line fix:** author the field inside its object and write the whole
object — `PUT /api/v1/meta/object/{object}` with the new entry in `fields` — or
declare it in the object source (`**/*.object.ts`) and redeploy. The refusal
body says exactly this.

**Adding a field at runtime is not lost.** `object` keeps
`allowRuntimeCreate: true`, so the operation still works on the route that
actually composes; what is withdrawn is a second, broken *spelling* of it. This
is deliberately **not** the `api` (#5488) rationale reused — that ruling rested
on "zero business pull", and "add a field" is the opposite, a core Studio/CRM
operation.

**Why it was removed rather than built.** `field` is the one declared type with
no standalone existence: fields are authored inside the object
(`ObjectSchema.fields`), so a `field` write minted a *separate* `sys_metadata`
row keyed `('field','<object>.<name>')` and nothing composed fragment rows into
their parent — `applyRegistryWriteThrough` routes only `type === 'object'`, and
`filePatterns` (`**/*.field.ts`) match nothing in any app. Measured end-to-end:
the write answered 200 `state=active` and `GET /meta/object/showcase_task` then
listed `fields = [title, status]` with the new field absent, forever. The row
was even self-readable by name with `_diagnostics.valid: true` — well-formed and
universally inert. Building the read path is a feature spanning at least three
packages (a composition step that does not exist, ~20 `gate.fields` call sites,
physical schema/migrations, cold boot); if ever wanted it is a separate card,
implementation first and declaration second.

**Existing rows.** `field` rows already written through the retired channel stay
in `sys_metadata` and are **inert** — they were inert before this change too,
because no read path ever composed them into an object. Nothing that used to
work stops working, and no stored data is reinterpreted. They remain
self-readable by name and still report `_diagnostics.valid: true`, which asserts
only that the isolated document is well-formed (#8169 — the envelope has no "in
effect" axis). Delete them at leisure: `deleteMetaItem` is deliberately not
gated by this refusal, so repair stays possible.

**Not changed:** #7743's overlay refusal. Overwriting a field a code package
ships is still `403 NOT_OVERRIDABLE` — a different gate for a different
question. Making field *overrides* legal was never part of this decision.

**Escape hatch:** an operator may set `OS_METADATA_WRITABLE=field` on a single
deployment. Note this unlocks the *write* only — the field still will not reach
its object, so it is a diagnostic, not a workaround.

The retirement kit:

- `field` flipped to `allowRuntimeCreate: false` in
  `DEFAULT_METADATA_TYPE_REGISTRY`, with the ruling, the measurement and the
  rejected options recorded at the entry.
- ADR-0087 D3 `SemanticMigration` `field-runtime-create-withdrawn` (major 17).
  There is **no** D2 conversion, deliberately: `allowRuntimeCreate` is a
  platform registry value, not an authorable one, so no authored source
  changes — an `**/*.object.ts` file valid before this change is valid after it,
  byte for byte. What changed is a runtime HTTP verdict.
- The refusal's prescription no longer reads `field`'s own `filePatterns` back:
  `**/*.field.ts` names a route that has never worked, so `codeOnlySourceHint`
  gives fragment types their real remedy instead.
- `field` auto-enrolled into the derived code-only refusal suite (both kernel
  topologies), and the plural spelling is pinned as folding onto the same gate.
