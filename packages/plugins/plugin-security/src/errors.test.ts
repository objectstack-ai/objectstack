// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Every error class `errors.ts` exports declares its HTTP status under BOTH
 * spellings, `status` and `statusCode`, with equal values.
 *
 * The rule is the module's own ("Why each carries BOTH `status` and
 * `statusCode`"): the doors read different property names, so a class that
 * declares one spelling answers a status at the doors that read it and
 * nothing at the doors that read the other. `PermissionDeniedError` was that
 * class — `statusCode` alone — and `plugin-sharing`'s share-link route door,
 * which reads `status`, answered its 403 refusal as a 500. Its two-door pin is
 * the `[#21405]` block of
 * `packages/runtime/src/domains/share-links-enforcement-context.test.ts`.
 *
 * The population is ENUMERATED from the module's exports, never listed by
 * hand, so a class added later is held to the rule the day it lands. The floor
 * below is what keeps the enumeration from passing over nothing: it names the
 * classes the module exports today and fails if any of them is not found.
 */

import { describe, expect, it } from 'vitest';
import * as errorsModule from './errors.js';
import { PermissionDeniedError } from './errors.js';

type ErrorClass = new (...args: unknown[]) => Error;

/** The exported values that are `Error` subclasses, by export name. */
const ERROR_CLASSES: Array<[string, ErrorClass]> = Object.entries(errorsModule)
  .filter(([, value]) => typeof value === 'function' && value.prototype instanceof Error)
  .map(([name, value]) => [name, value as unknown as ErrorClass]);

/**
 * The classes the module exports today. A floor, not the population: a new
 * class is checked without being added here.
 */
const FLOOR = [
  'PermissionDeniedError',
  'MasterDetailRelationMissingError',
  'DetailRecordNotFoundError',
  'MasterReferenceMissingError',
  'MaskedValueWriteError',
  'PermissionSetReadUnansweredError',
  'ExplainObjectNotFoundError',
  'PermissionSetNameConflictError',
];

/**
 * One argument list every class here accepts. Each constructor reads its
 * parameters as text (interpolated, or through `String()`) or as a list
 * (`join`, spread), and a one-element array serves as both.
 */
const ARGS: unknown[] = [['a'], ['b'], ['c'], ['d']];

describe('errors.ts — every exported error class declares status and statusCode, equal', () => {
  it('the enumeration finds every class the module exports today', () => {
    expect(ERROR_CLASSES.map(([name]) => name)).toEqual(expect.arrayContaining(FLOOR));
  });

  it('each one carries both spellings, with equal numeric values', () => {
    const violations: string[] = [];
    for (const [name, ErrorClass] of ERROR_CLASSES) {
      let instance: Error & { status?: unknown; statusCode?: unknown };
      try {
        instance = new ErrorClass(...ARGS);
      } catch (e) {
        violations.push(`${name}: cannot be constructed from the shared argument list (${String(e)})`);
        continue;
      }
      const { status, statusCode } = instance;
      if (typeof status !== 'number' || typeof statusCode !== 'number') {
        violations.push(`${name}: status=${String(status)} statusCode=${String(statusCode)} — declare both`);
      } else if (status !== statusCode) {
        violations.push(`${name}: status ${status} !== statusCode ${statusCode}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('PermissionDeniedError answers 403 under both spellings', () => {
    const e = new PermissionDeniedError('[Security] Access denied: read on crm_account');
    expect(e.code).toBe('PERMISSION_DENIED');
    expect(e.status).toBe(403);
    expect(e.statusCode).toBe(403);
  });
});
