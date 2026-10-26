/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7659 — `validation-engine.js` is RETIRED from `@object-ui/core`.
 *
 * The package published two client-side field-validation vocabularies for one
 * job: the snake_case rules `ValidationEngine` dispatched (`min_length`,
 * `field_match`, `field_compare`, …) and the react-hook-form rules that
 * `buildValidationRules` in `@object-ui/fields` compiles from field metadata.
 * Only the second had consumers; the measurement that found none for the engine
 * is recorded on objectui#7659 and is not re-derived here. Maintainer ruling A
 * on objectui#7659 (decision batch #40, item 4,
 * ADR-0049 enforce-or-remove): the module and its four exports are removed, and
 * the #3110 carve-out in `validation/index.ts` no longer names it.
 *
 * ⛔ Not the same module as the deprecated object-level `ObjectValidationEngine`
 * (`validators/`, #3110). That one stays exported, and
 * `validation-engine-stays-unwired.test.ts` keeps guarding it; it is a firing
 * control below, so this file also fails if the retirement ever takes it along.
 *
 * What this pins is the entry's SHAPE, both halves:
 *
 *   - runtime: none of the four names is an own key of the public entry's
 *     namespace. Firing controls on the same probe: the live schema validator
 *     exported from the same `validation/` barrel, and the deprecated
 *     object-level engine exported through it.
 *   - compile time: the class does not resolve as a type through the entry, and
 *     none of the three value names resolves through a type query. Compiled by
 *     this package's `tsconfig.test.json` (chained off `type-check`): an export
 *     that comes back fails there with "Unused '@ts-expect-error' directive".
 *
 * Deleting this file is deleting the ruling. Bringing the engine back is a new
 * decision on objectui#7659, not an edit here.
 */

import { describe, expect, it } from 'vitest';
import * as corePublicEntry from '../../index.js';

/** The four exports `validation-engine.js` published, and nothing else. */
const RETIRED = ['ValidationEngine', 'defaultValidationEngine', 'validate', 'validateFields'] as const;

describe('@object-ui/core entry — validation-engine.js retired (objectui#7659)', () => {
  it('exports none of the four names, while its live neighbours still resolve', () => {
    const keys = Object.keys(corePublicEntry);

    // Firing controls. Without them an empty or mis-resolved namespace would
    // pass the absence assertion below.
    expect(keys.length, 'nothing read out of the @object-ui/core entry').toBeGreaterThan(100);
    expect(
      typeof (corePublicEntry as Record<string, unknown>).validateSchema,
      'the live schema validator is missing, so this file is not reading the real entry',
    ).toBe('function');
    expect(
      typeof (corePublicEntry as Record<string, unknown>).ObjectValidationEngine,
      'the deprecated object-level engine (#3110) is a different module and stays exported',
    ).toBe('function');

    expect(
      RETIRED.filter((name) => keys.includes(name)),
      [
        '@object-ui/core exports a name of the retired validation-engine.js again.',
        'Maintainer ruling A on objectui#7659 removed it: it was a second field-validation',
        'vocabulary that no renderer ever consumed. Client-side field validation is',
        'buildValidationRules in @object-ui/fields.',
      ].join('\n'),
    ).toEqual([]);
  });

  it('resolves none of them as a type through the entry', () => {
    // @ts-expect-error retired with validation-engine.js (objectui#7659). If the
    // export comes back, tsc fails with "Unused '@ts-expect-error' directive".
    type _EngineClassRetired = import('../../index.js').ValidationEngine;
    // @ts-expect-error retired with validation-engine.js (objectui#7659), as above.
    type _DefaultInstanceRetired = typeof import('../../index.js').defaultValidationEngine;
    // @ts-expect-error retired with validation-engine.js (objectui#7659), as above.
    type _ValidateRetired = typeof import('../../index.js').validate;
    // @ts-expect-error retired with validation-engine.js (objectui#7659), as above.
    type _ValidateFieldsRetired = typeof import('../../index.js').validateFields;
    // Controls: the same two query shapes resolve live neighbours, so the four
    // errors above are readings of the entry and not of a bad path.
    type _ObjectEngineResolves = import('../../index.js').ObjectValidationEngine;
    type _SchemaValidatorResolves = typeof import('../../index.js').validateSchema;
  });
});
