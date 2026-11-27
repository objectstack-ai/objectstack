// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'flow-variable-key-reserved-segment-refused',
  surface:
    'automation.Flow registered by the automation engine (a package load, a boot, a save or publish through the '
    + 'metadata doors, os migrate meta --stored): a variable key the flow names — a declared variable\'s name, an '
    + 'assignment node\'s target, a node\'s outputVariable / iteratorVariable / indexVariable / errorVariable, or a '
    + 'screen field\'s name — whose name, or any dot-separated part of it, is __proto__, constructor or prototype; '
    + 'and the same key in a resume signal\'s output or inputs (POST /api/v1/automation/NAME/runs/RUN/resume)',
  replacement:
    'Rename the key to one that is none of the three words and has none of them as a dot-separated part (for '
    + 'example constructor to constructor_name, cfg.prototype to cfg.prototype_value), update every expression and '
    + 'text hole that reads it, and send a screen\'s declared field names on resume',
  reason:
    'A flow variable key may not use __proto__, constructor or prototype as its name or as any dot-separated part '
    + 'of it. Registration refuses a flow that names one, listing each key and where it sits, and a resume signal '
    + 'carrying one answers 400 INVALID_SIGNAL with nothing applied and the run still paused. A name that only '
    + 'contains one of the words (constructor_name) is unaffected. There is no mechanical rewrite: the new name, '
    + 'and every reader of the old one, is the author\'s choice.',
  acceptanceCriteria:
    'os migrate meta --stored lists no flow with such a key; every flow registers at boot with no registration '
    + 'refusal naming a variable key; a screen run resumed with its declared field names answers 2xx.',
};
