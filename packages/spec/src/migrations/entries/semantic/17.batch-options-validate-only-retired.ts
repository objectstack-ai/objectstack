// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'batch-options-validate-only-retired',
  surface: 'api.batchOptions.validateOnly',
  replacement: '(removed — no dry-run today; open an issue to design a no-commit batch preview)',
  reason:
    'The `validateOnly` key promised a dry-run ("validate records without persisting") but no '
    + 'batch surface ever read it — updateManyData / deleteManyData / batchData persist '
    + 'regardless. There is no behaviour to preserve and nothing stored to rewrite (it only '
    + 'ever appeared in an HTTP request body). Callers must stop sending it.',
  acceptanceCriteria:
    'No /batch, /updateMany or /deleteMany call sends `options.validateOnly`; a request that '
    + 'includes it answers 400 VALIDATION_FAILED with the retirement prescription.',
};
