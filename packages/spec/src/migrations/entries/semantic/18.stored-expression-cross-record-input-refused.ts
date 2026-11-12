// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The upgrade-guide entry of the authoring rule `stored-expression-cross-record-input`
// (`@objectstack/lint`). No D2 conversion: where the value should live — read on
// every read, totalled on the related object, or copied by a flow — is a
// judgement about the field, which only the author can make.
export const entry: SemanticMigration = {
  id: 'stored-expression-cross-record-input-refused',
  surface:
    'data.Field.expression on a stored computed field (a field whose type is not formula and that declares an '
    + 'expression) of an object saved live or published through the metadata doors (PUT /api/v1/meta/object/NAME '
    + 'live save, the per-item publish, POST /api/v1/packages/PKG/publish-drafts, and the restore doors; Studio, '
    + 'REST and MCP authors), and of an object os validate / os build / os lint judge: an expression that reads a '
    + 'field of another record through a lookup, master_detail, user or tree field of the same object '
    + '(record.employee.daily_hours, by any spelling the engine resolves). A read of the reference itself or of its '
    + 'id is not one',
  replacement:
    'Keep a stored expression to its own record\'s fields. To show the related value, make the field a formula '
    + '(type: \'formula\', with its returnType), which is computed on every read but cannot be totalled. To total it, '
    + 'compute it on the related object: a summary field there rolls up this object\'s own stored values, and a '
    + 'formula beside it combines that total with the related object\'s field. To keep a copy on this record, write '
    + 'it with a flow on the related object that runs when the value changes',
  reason:
    'A stored computed field is computed from the row each write stores, on every insert and every update by id, '
    + 'and the result is stored. Its expression may read one relationship hop, and the write reads that value from '
    + 'the related record when it computes; nothing computes the row again when the related record changes, so the '
    + 'stored value keeps the old input and every total over it drifts, with no fault and no log (measured: a leave '
    + 'request\'s stored hours stayed 40 after the employee\'s daily hours moved to 30). The authoring rule '
    + 'stored-expression-cross-record-input (severity error) now refuses it in os validate, os build and os lint, and '
    + 'a live save, a publish and a restore answer 422 INVALID_METADATA with the rule in issues[], at '
    + '`object \'OBJECT\' · field \'FIELD\' expression`, naming each read and the related object. A draft save '
    + '(mode=draft) runs no rule and still stores; the draft is judged at its publish. A formula field reading the '
    + 'same hop is not judged: it is computed on every read. The parse is not narrowed: an object row stored before '
    + 'this release stays stored, loads and keeps computing the field at each write as before, and an artifact built '
    + 'earlier still loads; a live re-save of that object is refused until the expression is rewritten, because the '
    + 'gate charges a write with the written object\'s own findings whatever the stored row held, and a history '
    + 'version holding the read can no longer be restored (the same 422). OS_ALLOW_UNLINTED_METADATA_WRITES=1 turns '
    + 'the save, publish and restore refusal into a logged warning for a migration window. There is no mechanical '
    + 'rewrite: the three repairs put the value in different places, and which one the author meant is a judgement '
    + 'about the field.',
  acceptanceCriteria:
    'Run `objectstack validate` over every stack authored in config files and confirm no '
    + 'stored-expression-cross-record-input finding. For stored objects, PUT /api/v1/meta/object/NAME with each '
    + 'stored computed field\'s expression reading only the record\'s own fields answers 200, and POST '
    + '/api/v1/packages/PKG/publish-drafts publishes the package that holds it.',
};
