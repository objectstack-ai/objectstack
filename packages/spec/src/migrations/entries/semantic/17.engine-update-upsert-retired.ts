// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'engine-update-upsert-retired',
  surface: 'data.engine.update options.upsert',
  replacement:
    '(removed — never implemented; express create-if-absent explicitly: `findOne` first, then '
    + '`insert` or `update` on what you find)',
  reason:
    'The `upsert` flag promised insert-if-absent on `engine.update()` but no engine or driver '
    + 'path ever read it: the key was declared on both update-options schemas and allowlisted by '
    + 'the unknown-option gate, yet `ObjectQL.update()` never referenced it and it was not a '
    + 'driver pass-through key — `{ upsert: true }` was accepted and silently dropped and the '
    + 'update stayed a plain update (ADR-0049 declared-but-unenforced). There is no behaviour to '
    + 'preserve and nothing stored to rewrite (it only ever appeared in a call-time option bag). '
    + "Any future first-class upsert must reconcile with #7867's not-found gate — a by-id update "
    + 'whose id names no row throws RECORD_NOT_FOUND rather than inserting — which is why the '
    + 'flag is removed rather than implemented here.',
  acceptanceCriteria:
    'No caller passes `options.upsert` to `engine.update()`; a call that includes it is refused '
    + 'loudly (the engine gate and both schemas quote the #8057 prescription) instead of '
    + 'succeeding with the option silently ignored.',
};
