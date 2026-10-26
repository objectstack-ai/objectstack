// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25653] The app-automation elevation mark at its home: how it is set, read
 * and carried. Its two producers and its one reader are driven end to end in
 * runtime (`app-automation-identity-write-refusal.integration.test.ts`).
 */

import { describe, it, expect } from 'vitest';
import { ExecutionContextSchema } from '@objectstack/spec/kernel';

import {
  APP_AUTOMATION_ELEVATION,
  appAutomationElevationOf,
  carryAppAutomationElevation,
  markAppAutomationElevation,
} from './app-automation-elevation.js';

describe('the app-automation elevation mark', () => {
  it('is the registry symbol, so an ESM and a CJS copy of this package agree on it', () => {
    expect(APP_AUTOMATION_ELEVATION).toBe(Symbol.for('objectstack.core.appAutomationElevation'));
  });

  it('marks a fresh copy and leaves the given context unchanged', () => {
    const context = { isSystem: true, userId: 'u1' };
    const marked = markAppAutomationElevation(context, 'hook');
    expect(marked).not.toBe(context);
    expect(appAutomationElevationOf(marked)).toBe('hook');
    expect(appAutomationElevationOf(context)).toBe(undefined);
    expect(marked).toMatchObject({ isSystem: true, userId: 'u1' });
  });

  it('rides a spread, as every sudo()-shaped derivation spreads its caller', () => {
    const marked = markAppAutomationElevation({ isSystem: true }, 'action');
    expect(appAutomationElevationOf({ ...marked, transaction: {} })).toBe('action');
  });

  it('reads nothing from a context that carries none, a value outside the two sources, or a non-object', () => {
    expect(appAutomationElevationOf({ isSystem: true })).toBe(undefined);
    expect(appAutomationElevationOf({ [APP_AUTOMATION_ELEVATION]: 'flow' })).toBe(undefined);
    expect(appAutomationElevationOf(null)).toBe(undefined);
    expect(appAutomationElevationOf('hook')).toBe(undefined);
  });

  it('cannot be spelled by a JSON payload', () => {
    const parsed = JSON.parse(JSON.stringify({ isSystem: true, 'objectstack.core.appAutomationElevation': 'hook' }));
    expect(appAutomationElevationOf(parsed)).toBe(undefined);
  });

  it('is dropped by the schema parse, and carried across it', () => {
    const marked = markAppAutomationElevation({ isSystem: true, userId: 'u1' }, 'action');
    const parsed = ExecutionContextSchema.parse(marked);
    expect(appAutomationElevationOf(parsed)).toBe(undefined);

    const carried = carryAppAutomationElevation(marked, parsed);
    expect(appAutomationElevationOf(carried)).toBe('action');
    expect(carried).toMatchObject({ isSystem: true, userId: 'u1' });

    const unmarked = ExecutionContextSchema.parse({ isSystem: true });
    expect(carryAppAutomationElevation({ isSystem: true }, unmarked)).toBe(unmarked);
  });
});
