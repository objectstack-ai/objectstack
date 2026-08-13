// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'field-runtime-create-withdrawn',
  surface: 'PUT /api/v1/meta/field/{object}.{name} (runtime-authored standalone `field` items)',
  replacement:
    'Author the field inside its object and write the whole object — '
    + 'PUT /api/v1/meta/object/{object} with the new field in `fields` — '
    + 'or declare it in the object source (`**/*.object.ts`) and redeploy',
  reason:
    'The `field` registry entry declared `allowRuntimeCreate: true` and the platform never '
    + 'built a read path for it. Measured end-to-end through the real HttpDispatcher -> '
    + 'ObjectStackProtocolImplementation -> SysMetadataRepository (#7893): '
    + "`PUT /api/v1/meta/field/showcase_task.zz_probe` answered 200 with "
    + '{"success":true,"state":"active","message":"Saved field …"}, the row persisted, and '
    + '`GET /api/v1/meta/object/showcase_task` then listed fields = [title, status] with '
    + 'zz_probe ABSENT — forever. The row is even self-readable by name '
    + '(`GET /meta/field/showcase_task.zz_probe` -> 200, `_diagnostics.valid: true`), which '
    + 'makes it well-formed and universally inert rather than malformed. The seam is that '
    + '`field` is the ONE declared type with no standalone existence: fields are authored '
    + 'inside the object (`ObjectSchema.fields`), a `field` write mints a SEPARATE row keyed '
    + "('field','<object>.<name>'), and nothing composes fragment rows into their parent — "
    + "`applyRegistryWriteThrough` routes only `type === 'object'`, and `filePatterns` "
    + '(`**/*.field.ts`) match nothing in any app. A declared capability the platform cannot '
    + 'honour is ADR-0049 false compliance, and the maintainer ruled REMOVE on 2026-08-12 '
    + 'rather than build the read path, which is a feature spanning at least three packages '
    + '(a composition step that does not exist, ~20 `gate.fields` call sites, physical '
    + 'schema/migrations, and cold boot via `loadMetaFromDb`); if ever wanted it is a '
    + 'separate card — implementation first, declaration second. '
    + '⚠️ This is NOT the #5488 (`api`) rationale reused: that ruling rested on "zero '
    + 'business pull", and "add a field" is the opposite — a core Studio/CRM operation. The '
    + 'justification here is that the operation REMAINS AVAILABLE on the route that actually '
    + 'composes: `object` keeps `allowRuntimeCreate: true`, so what is withdrawn is a second, '
    + 'broken SPELLING of adding a field, not the ability to add one. '
    + 'There is NO D2 conversion, for the reason this list exists: nothing in an authored '
    + 'source spells this key. `allowRuntimeCreate` is a PLATFORM registry value, not an '
    + 'authorable one, and no authored source changes — an `**/*.object.ts` file valid before '
    + 'this change is valid after it, byte for byte. What changed is a runtime HTTP verdict, '
    + 'so it is one semantic TODO for operators and Studio callers rather than a stack '
    + 'conversion — the same disposition `api` (#5488) and `BatchOptions.validateOnly` '
    + '(#4052) take. ADR-0049 / ADR-0087, #7893 (split from #7743).',
  acceptanceCriteria:
    'No caller creates a standalone `field` item through the runtime metadata API. '
    + '`PUT /api/v1/meta/field/{object}.{name}` answers 403 with `code: "NOT_CREATABLE"` and '
    + 'a body naming both flags (`allowRuntimeCreate=false, allowOrgOverride=false`) and the '
    + 'prescription `PUT /api/v1/meta/object/:object with the new field in `fields``. The '
    + 'plural spelling `PUT /api/v1/meta/fields/{object}.{name}` folds onto the singular '
    + '(#7894) and earns the same refusal — verify it, because it was a separate door until '
    + '2026-08-12. ⚠️ Verify the OBJECT route is UNAFFECTED, which is the whole point of the '
    + 'change: `PUT /api/v1/meta/object/{name}` with a new entry in `fields` still answers '
    + '200, and `GET /api/v1/meta/object/{name}` READS THE NEW FIELD BACK (assert on '
    + '`body.data.item.fields`, not `body.item`, which is undefined and makes an empty read '
    + 'look like a pass). Assert a DECLARED field is present in the same response, so a dead '
    + 'read cannot be what makes the check pass. '
    + '⚠️ #7743\'s overlay refusal is untouched and must stay: overwriting a field a code '
    + 'package ships is still 403 `NOT_OVERRIDABLE`, a different gate for a different '
    + 'question — making field OVERRIDES legal was never part of this decision. '
    + 'DISPOSITION OF EXISTING ROWS: `field` rows already written through the retired channel '
    + 'stay in `sys_metadata` and are INERT — they were inert before this change too, since '
    + 'no read path ever composed them into an object, so nothing that used to work stops '
    + 'working and no data is silently reinterpreted. They remain self-readable by name and '
    + 'still report `_diagnostics.valid: true`, which asserts only that the isolated document '
    + 'is well-formed (see #8169 — the envelope has no "in effect" axis). They may be deleted '
    + 'at leisure: `deleteMetaItem` is deliberately NOT gated by this refusal, so repair stays '
    + 'possible. An operator who needs the write door back on one deployment sets '
    + '`OS_METADATA_WRITABLE=field`; note this unlocks the WRITE only — the field still will '
    + 'not reach its object, which is why it is a diagnostic and not a workaround.',
};
