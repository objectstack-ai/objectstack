---
'@objectstack/objectql': minor
---

fix(objectql)!: each element of a multi-valued `lookup` / `user` / `file` / `image` field is held to the single value's stored form — an embedded record, a boolean or a number as an element answers `invalid_type` (#22908)

Clause-②: yes (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, export or stored shape is removed, renamed or re-shaped, so there is nothing for `objectstack migrate meta` to rewrite. The stored form a multi-valued reference or media field declares (`valueSchemaFor`: an array of record ids, or of `sys_file` ids) is unchanged. What narrows is the write path's accept-set, which now refuses an element that form already excluded. Stored rows holding such an element are application data, reported by `os migrate value-shapes` (references) and `os migrate files-to-references` (media) as before. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and no exported declaration is removed or narrowed (not runtime-interface-only or type-surface-only). -->

**BREAKING** (an accept-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.

**FROM.** On a `lookup`, `user`, `file` or `image` field declared `multiple: true`, the record validator checked that the value was an array and stopped there. So an element of the wrong shape was stored:

- REST `POST` / `PATCH /api/v1/data/:object`, as a signed-in caller: an embedded record `[{ id }]` answered `201` / `200` and was stored verbatim. `[false]` and `[42]` were refused only by the reference-existence check, as `reference_not_found`.
- A system write (`isSystem`: seed replay, hooks, package install): `[false]`, `[42]` and `[{ id }]` were all stored verbatim.
- The single-valued field refused the same three `invalid_type` on both doors.

**TO.** Each element is parsed against the single value's stored form (ADR-0104 D1, `valueSchemaFor`): a record id for `lookup` / `user`, an opaque `sys_file` id for `file` / `image`. The deployment's value-shape posture decides, the same posture a single value answers to:

- **Strict** (a fresh store is born attested; or after `os migrate value-shapes --apply` for references, `os migrate files-to-references --apply` for media; or `OS_DATA_VALUE_SHAPE_STRICT_ENABLED=1`): the write is refused `400 VALIDATION_FAILED`, with a `fields[]` entry `{ field, code: 'invalid_type' }` whose detail names the index of the wrong element (`at index 1: …`).
- **Warn-first** (an unverified deployment, or `OS_ALLOW_LAX_VALUE_SHAPES=1` / `OS_ALLOW_LAX_MEDIA_VALUES=1`): the write is admitted, logged and reported as an admitted ADR-0104 violation, exactly as a single value is.
- The shape check runs for a system write too. Whether a referenced id EXISTS is unchanged: a system write still skips that check.
- `os migrate value-shapes` already counted these elements; its report detail now names the index too, because the scan and the write path share one reading.

**Fix, if a write relied on the old answer:** write the ids as the elements, never the record a read with `$expand` returns — `team: ['acc_1', 'acc_2']`, not `team: [{ id: 'acc_1', name: 'Acme' }]`. To find stored rows that hold such an element, run `os migrate value-shapes` (a dry run writes nothing).
