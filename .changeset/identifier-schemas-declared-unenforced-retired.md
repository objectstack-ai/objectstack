---
"@objectstack/spec": minor
---

feat(spec): retire the six branded identifier schemas and EventNameSchema — declared-but-unenforced identifier layers removed (#13612, #13613)

<!-- adr-0087: registered branded-identifier-schemas-retired, event-name-schema-retired -->

**BREAKING** published-export removals from `@objectstack/spec/shared`,
shipped as `minor` under the repo's launch-window convention for breaking
changes; both migration prescriptions are registered under protocol
major 18. Maintainer ruling 2026-09-01 (director decision batch C, verbatim
「同意」: retire) on both cards, under ADR-0049 enforce-or-remove.

**#13612 — the six branded identifier schemas** (`shared/branded-types.zod.ts`,
removed whole): `ObjectNameSchema`, `FieldNameSchema`, `ViewNameSchema`,
`AppNameSchema`, `FlowNameSchema`, `RoleNameSchema`, with their type exports
(`ObjectName`/`ObjectNameParsed` through `RoleName`/`RoleNameParsed`). The
brands promised compile-time safety no consumer could obtain — no schema in
either repository ever composed one, so nothing produced or accepted a
branded value — while the surfaces they were named for are validated by
inline regexes (`data/object.zod.ts`, `data/field.zod.ts`,
`automation/flow.zod.ts`) or bare `SnakeCaseIdentifierSchema`
(`ui/app.zod.ts`, `identity/position.zod.ts`). Those five real validators
are the contract of record and are untouched. Binding was weighed and not
adopted: it would silently change five surfaces' accept sets (the inline
regexes admit a leading underscore the brand base does not).

**#13613 — `EventNameSchema`** and its `EventName` type
(`shared/identifiers.zod.ts`). Its only three binding fields
(`EventTypeDefinitionSchema.name`, `EventSchema.name`,
`EventMessageSchema.eventName`) had zero runtime consumers; the vocabulary
the platform actually checks is the closed literal enums `DataEventType` /
`BulkDataEventType` (`api/events.zod.ts`), which never referenced it. The
three fields stay and widen to plain `z.string()` — every previously valid
document stays valid. The enums are byte-for-byte untouched and stand as the
only event-name contract; `WebSocketEventSchema.channel` stays a deliberate
bare `z.string()` (the ruling adds no constraint there).

FROM → TO:

- `import { ObjectNameSchema, … , RoleNameSchema } from '@objectstack/spec/shared'`
  → removed, no replacement brand layer (TS2305 on upgrade). Fix: parse an
  identifier through the schema of the surface that stores it; for a
  standalone check use `SnakeCaseIdentifierSchema` or
  `SystemIdentifierSchema`, both still published from the same subpath.
- `import { EventNameSchema } from '@objectstack/spec/shared'` → removed
  (TS2305 on upgrade). Fix: delete the import; to validate platform event
  names, parse through `DataEventType` / `BulkDataEventType` from
  `@objectstack/spec/api`.
- Documents parsed by `EventTypeDefinitionSchema`, `EventSchema` or
  `EventMessageSchema`: no change required — the `name`/`eventName` accept
  set widens from the dot-notation grammar to any string, so no stored
  metadata breaks and no source rewrite ships.

No authored document ever embedded a branded value and the event-field
change is a widening, so there is no tombstone, no D2 conversion, and
nothing for `objectstack migrate meta` to rewrite; the
`RETIRED_DEFS_BY_MAJOR` rows (seven `shared/*` defs) plus the two D3
semantic entries are the declaration.
