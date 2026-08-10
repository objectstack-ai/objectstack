// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'export-field-meta-constraints-retired',
  surface:
    '@objectstack/rest: ExportFieldMeta.required / .system / .readonly / .hasDefault / '
    + '.min / .max / .minLength / .maxLength (the map built by `buildFieldMetaMap`, '
    + 'reached as `PreparedImport.metaMap` from `prepareImportRequest`)',
  replacement:
    'the object schema you already hold — read `fields[name].required` / `.system` / '
    + '`.readonly` / `.defaultValue` / `.min` / `.max` / `.minLength` / `.maxLength` off '
    + 'the same `ObjectSchema` you passed to `buildFieldMetaMap`, which is where the '
    + 'ENGINE reads them and therefore the only copy that cannot drift',
  reason:
    'ADR-0049 enforce-or-remove. These eight were never a source of truth: '
    + '`buildFieldMetaMap(schema)` DERIVED each one from the very `schema` its caller '
    + 'passed in, so the map carried a second copy of facts the caller already held. '
    + "They existed for exactly one consumer — the import dry run's hand-copied "
    + 'pre-check mirror (`firstMissingRequiredField` / `firstConstraintViolation`, '
    + 'framework#3956) — and #4633 ruling D retired that mirror (PR #6532): the dry run '
    + "now asks `DataProtocol.validateData` for the engine's verdict, which reads the "
    + "object's own schema. That left all eight computed on every import and read by "
    + 'NOTHING, which is the declared-and-unread shape ADR-0049 exists for; a constraint '
    + 'vocabulary standing next to the presentation one with no enforcer behind it is '
    + 'precisely the thing an AI-authored consumer mistakes for a contract. Verified '
    + 'zero-reader before removal, per key and by type, across this repo (`packages/rest` '
    + 'itself, and all five in-repo dependents of `@objectstack/rest`: runtime, cli, '
    + "verify, plugin-auth, plugin-dev) and the `objectui` sibling; plugin-auth's "
    + 'identity import forwards `prepared.metaMap` into `runImport` but reads only the '
    + 'presentation keys through `coerceRow`. '
    + 'Why this needs a ledger entry despite that sweep: it is the `findStream` (#4484) / '
    + '`IStorageService.list` (#5540) / `actor-user-roles-to-positions` (#6011) '
    + 'disposition — a published TS surface with NO spec schema, so there is no '
    + '`retiredKey()` tombstone and no parse rejection that could carry a prescription, '
    + 'and the ledger is the only channel that reaches an upgrader. It is if anything '
    + 'blinder than those three: the keys shipped in a FINAL release (`@objectstack/rest` '
    + '14.5.0) and have been published in every release since, and because they were '
    + 'OPTIONAL keys on an interface that itself survives, a JavaScript consumer reading '
    + '`meta.required` after the upgrade gets `undefined` with no error at all — tsc '
    + 'reports at the read site only for a typed consumer. '
    + 'Why D3 semantic and not a D2 conversion: there is nothing to convert. No authored '
    + 'or stored metadata changes shape — `required` / `min` / `maxLength` and the rest '
    + 'remain fully authorable on a field definition and fully enforced by the engine, '
    + 'which is where they always lived. The only place these eight are ever spelled is '
    + "inside a consumer's own TypeScript, so no `objectstack migrate meta` transform can "
    + 'reach them. ADR-0049 / ADR-0087, #6536 (the sweep PR #6532 deliberately deferred).',
  acceptanceCriteria:
    'No code of yours reads any of the eight off a `buildFieldMetaMap` / '
    + '`prepareImportRequest` result. Grep your sources for `.required` / `.hasDefault` / '
    + '`.minLength` / `.maxLength` / `.min` / `.max` / `.system` / `.readonly` on an '
    + '`ExportFieldMeta`-typed value; each hit moves to the object schema you already '
    + 'passed in. ⚠️ Prove it against a RUN, not against tsc: these were optional keys, '
    + 'so an untyped or `any`-typed read compiles clean and silently becomes `undefined` '
    + '— assert that the constraint your code acts on is still observed on a real import, '
    + 'not merely that the build is green. Note `hasDefault` has no one-to-one '
    + "replacement key: it was the derived predicate `defaultValue != null`, mirroring the "
    + "engine's `applyFieldDefaults` gate, so read `fields[name].defaultValue` and apply "
    + 'that same `!= null` test yourself.',
};
