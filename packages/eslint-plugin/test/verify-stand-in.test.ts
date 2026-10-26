// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';

import { verifyStandInPlugin } from '../src/index.mjs';
import { lintWith, ruleTester } from './rule-tester.js';

const rule = verifyStandInPlugin.rules['no-asserted-driver-argument'];

/** The guarded names the root config passes today (`VERIFY_STAND_IN_CHECKS`). */
const options = [{ checks: ['checkReadCoercion', 'checkDateBucketParity'] }];

const erased = [{ messageId: 'erased' }];

ruleTester.run('verify-stand-in/no-asserted-driver-argument', rule, {
  valid: [
    { code: 'checkReadCoercion(driver);', options },
    { code: 'checkDateBucketParity(makeFakeDriver(), { tz: "UTC" });', options },
    // A bare non-null assertion asserts no type.
    { code: 'checkReadCoercion(driver!);', options },
    // The options bag is a different type with its own rule.
    { code: 'checkDateBucketParity(driver, opts as never);', options },
    // A same-named METHOD is not the verify helper.
    { code: 'suite.checkReadCoercion(driver as never);', options },
    // Not a guarded name.
    { code: 'checkSomethingElse(driver as never);', options },
    { code: 'const d: Driver = make(); checkReadCoercion(d);', options },
  ],
  invalid: [
    { code: 'checkReadCoercion(driver as never);', options, errors: erased },
    { code: 'checkDateBucketParity(driver as any);', options, errors: erased },
    // Re-labelling the argument with the stand-in asserts the thing under test.
    { code: 'checkReadCoercion(driver as unknown as CoercibleDriver);', options, errors: erased },
    { code: 'checkDateBucketParity(<BucketableDriver>driver);', options, errors: erased },
    { code: 'checkReadCoercion((driver as never)!);', options, errors: erased },
    // The split form, resolved through scope.
    { code: 'const d: any = brokenDriver();\ncheckReadCoercion(d);', options, errors: erased },
    { code: 'const d: never = brokenDriver();\ncheckDateBucketParity(d);', options, errors: erased },
  ],
});

describe('verify-stand-in/no-asserted-driver-argument configuration', () => {
  it('refuses a config that does not pass the guarded set', () => {
    expect(() => lintWith('verify-stand-in', verifyStandInPlugin, 'error', 'const a = 1;'))
      .toThrow(/should NOT have fewer than 1 items/);
  });
});
