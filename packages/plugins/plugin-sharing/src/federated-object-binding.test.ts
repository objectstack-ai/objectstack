// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * This plugin holds no copy of the federated-object predicate: the export
 * `federated-phantom-anchors.ts` keeps under its own module path is
 * `@objectstack/core`'s binding itself, which reads the spec's
 * `platformProvisionsStorage`. A local wrapper would answer the same on every
 * object record, so only identity can see one come back.
 */

import { describe, it, expect } from 'vitest';
import { isFederatedObject as coreIsFederatedObject } from '@objectstack/core';
import { isFederatedObject } from './federated-phantom-anchors.js';

describe('plugin-sharing asks core for "is this object federated?"', () => {
  it('re-exports the core binding rather than wrapping it', () => {
    expect(isFederatedObject).toBe(coreIsFederatedObject);
  });
});
