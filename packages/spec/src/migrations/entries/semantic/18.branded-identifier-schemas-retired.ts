// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'branded-identifier-schemas-retired',
  surface:
    'the six branded identifier schemas of `@objectstack/spec/shared` '
    + '(`shared/branded-types.zod.ts`, removed whole): `ObjectNameSchema`, '
    + '`FieldNameSchema`, `ViewNameSchema`, `AppNameSchema`, `FlowNameSchema`, '
    + '`RoleNameSchema`, and their type exports (`ObjectName`/`ObjectNameParsed` '
    + 'through `RoleName`/`RoleNameParsed`).',
  replacement:
    '(removed — no replacement brand layer. Parse an identifier through the '
    + 'schema of the surface that stores it: object and field names through '
    + '`ObjectSchema`/`FieldSchema` (inline snake_case regex), flow names '
    + 'through `FlowSchema`, app names through `AppSchema` '
    + '(`SnakeCaseIdentifierSchema`), position/role names through '
    + '`PositionSchema`. A caller that wants a standalone identifier check '
    + 'uses `SnakeCaseIdentifierSchema` or `SystemIdentifierSchema` from '
    + '`@objectstack/spec/shared` directly — both stay published.)',
  reason:
    'Maintainer ruling 2026-09-01 on #13612 (director decision batch C, '
    + 'verbatim 「同意」: retire) — ADR-0049 enforce-or-remove. The brands '
    + 'promised compile-time safety ("you cannot pass an ObjectName where a '
    + 'FieldName is expected") that no consumer could obtain: no schema in '
    + 'either repository ever composed a brand, so nothing produced or '
    + 'accepted a branded value, while the surfaces the brands were named for '
    + 'are validated by inline regexes or bare `SnakeCaseIdentifierSchema` '
    + 'three files away. Binding was weighed and not adopted: zero consumers '
    + 'exist, binding would silently change five surfaces\' accept sets (the '
    + 'inline regexes admit a leading underscore the brand base does not), '
    + 'and a future real need for centralized identifier grammar re-opens '
    + 'freely against actual pull.',
  acceptanceCriteria:
    'No code imports any of the six schemas or their types from '
    + '`@objectstack/spec/shared` (TS2305 after upgrade — the module is '
    + 'removed, not stubbed); the five surfaces\' validators are byte-for-byte '
    + 'untouched (inline regexes at `data/object.zod.ts`, `data/field.zod.ts`, '
    + '`automation/flow.zod.ts`; bare `SnakeCaseIdentifierSchema` at '
    + '`ui/app.zod.ts`, `identity/position.zod.ts`); '
    + '`SnakeCaseIdentifierSchema` and `SystemIdentifierSchema` themselves '
    + 'remain published and unchanged; the six def keys (`shared/ObjectName`, '
    + '`shared/FieldName`, `shared/ViewName`, `shared/AppName`, '
    + '`shared/FlowName`, `shared/RoleName`) leave '
    + '`json-schema.manifest/shared.json` in the same change that registers '
    + 'this entry. No authored metadata document ever embedded a branded '
    + 'value, so no source rewrite ships and `objectstack migrate meta` has '
    + 'nothing to visit.',
};
