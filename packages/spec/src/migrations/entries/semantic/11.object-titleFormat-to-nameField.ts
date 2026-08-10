// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'object-titleFormat-to-nameField',
  surface: 'object.titleFormat',
  replacement: 'object.nameField',
  reason:
    'A single-field `titleFormat` maps 1:1 to `nameField`, but a composite template ' +
    '(e.g. `{firstName} {lastName}`) has no lossless single-field target — it must ' +
    'become a formula field designated as `nameField`. The choice of formula is a ' +
    'judgment the transform cannot make.',
  acceptanceCriteria:
    'Each object with a `titleFormat` declares a `nameField`; a composite title is ' +
    'backed by a formula field. `objectstack validate` passes and record display ' +
    'names render identically to before.',
};
