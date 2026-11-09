// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `isFederatedObject` is the negation of the spec's `platformProvisionsStorage`
 * and restates nothing of its own.
 *
 * The spec predicate is the one spelling of "the platform provisions this
 * object's storage" (the #7865 convergence map). Every runtime layer asks
 * core's binding (objectql, plugin-security and plugin-sharing re-export it),
 * so the two must agree on every input, the inputs that are not object records
 * included: there the spec answers "provisioned", which is what the presence
 * test this binding replaced answered too.
 */

import { describe, it, expect } from 'vitest';
import { platformProvisionsStorage } from '@objectstack/spec/data';
import { isFederatedObject } from './tenant-field.js';
import { isFederatedObject as fromCoreBarrel } from '../index.js';

const CASES: ReadonlyArray<readonly [label: string, input: unknown, federated: boolean]> = [
  ['an object with no external block', {}, false],
  ['an object with an external block', { external: {} }, true],
  ['an object whose external is null', { external: null }, false],
  ['an object whose external is undefined', { external: undefined }, false],
  ['null', null, false],
  ['undefined', undefined, false],
  ['an array', [], false],
];

describe('isFederatedObject reads the spec predicate', () => {
  it.each(CASES)('agrees with !platformProvisionsStorage on %s', (_label, input, federated) => {
    expect(isFederatedObject(input)).toBe(!platformProvisionsStorage(input));
    expect(isFederatedObject(input)).toBe(federated);
  });

  it('is the binding the package barrel exports', () => {
    expect(fromCoreBarrel).toBe(isFederatedObject);
  });
});
