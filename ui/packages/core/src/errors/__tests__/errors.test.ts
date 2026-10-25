/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import {
  ObjectUIError,
  SchemaError,
  RegistryError,
  ExpressionError,
  PluginError,
  FieldValidationError,
  ERROR_CODES,
  createError,
  formatErrorMessage,
  isObjectUIError,
  isErrorCode,
} from '../index';

// ---------------------------------------------------------------------------
// ObjectUIError base class
// ---------------------------------------------------------------------------

describe('ObjectUIError', () => {
  it('should create an error with code and message', () => {
    const err = new ObjectUIError('something broke', 'OBJUI-001');

    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ObjectUIError);
    expect(err.name).toBe('ObjectUIError');
    expect(err.message).toBe('something broke');
    expect(err.code).toBe('OBJUI-001');
    expect(err.details).toBeUndefined();
  });

  it('should accept optional details', () => {
    const details = { type: 'fancy-button' };
    const err = new ObjectUIError('oops', 'OBJUI-001', details);

    expect(err.details).toEqual(details);
  });

  it('should serialize to JSON', () => {
    const err = new ObjectUIError('oops', 'OBJUI-001', { a: 1 });
    const json = err.toJSON();

    expect(json).toEqual(
      expect.objectContaining({
        name: 'ObjectUIError',
        message: 'oops',
        code: 'OBJUI-001',
        details: { a: 1 },
      }),
    );
    expect(json.stack).toBeDefined();
  });

  it('should have a proper stack trace', () => {
    const err = new ObjectUIError('trace me', 'OBJUI-001');
    expect(err.stack).toBeDefined();
    expect(err.stack).toContain('trace me');
  });
});

// ---------------------------------------------------------------------------
// ERROR_CODES registry
// ---------------------------------------------------------------------------

describe('ERROR_CODES', () => {
  it('should contain all 10 defined error codes', () => {
    const expectedCodes = [
      'OBJUI-001',
      'OBJUI-002',
      'OBJUI-003',
      'OBJUI-004',
      'OBJUI-005',
      'OBJUI-006',
      'OBJUI-007',
      'OBJUI-008',
      'OBJUI-009',
      'OBJUI-010',
    ];

    for (const code of expectedCodes) {
      expect(ERROR_CODES[code]).toBeDefined();
      expect(ERROR_CODES[code].code).toBe(code);
      expect(ERROR_CODES[code].message).toBeTruthy();
      expect(ERROR_CODES[code].suggestion).toBeTruthy();
      expect(ERROR_CODES[code].docUrl).toContain(code);
    }
  });
});

// ---------------------------------------------------------------------------
// isErrorCode type guard
// ---------------------------------------------------------------------------

describe('isErrorCode', () => {
  it('should return true for known codes', () => {
    expect(isErrorCode('OBJUI-001')).toBe(true);
    expect(isErrorCode('OBJUI-010')).toBe(true);
  });

  it('should return false for unknown codes', () => {
    expect(isErrorCode('OBJUI-999')).toBe(false);
    expect(isErrorCode(42)).toBe(false);
    expect(isErrorCode(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isObjectUIError type guard
// ---------------------------------------------------------------------------

describe('isObjectUIError', () => {
  it('should return true for ObjectUIError instances', () => {
    expect(isObjectUIError(new ObjectUIError('a', 'OBJUI-001'))).toBe(true);
  });

  it('should return true for subclass instances', () => {
    expect(isObjectUIError(new SchemaError('bad schema'))).toBe(true);
    expect(isObjectUIError(new ExpressionError('bad expr'))).toBe(true);
  });

  it('should return false for plain errors', () => {
    expect(isObjectUIError(new Error('plain'))).toBe(false);
    expect(isObjectUIError('string')).toBe(false);
    expect(isObjectUIError(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Specialized error classes
// ---------------------------------------------------------------------------

describe('SchemaError', () => {
  it('should default to OBJUI-002', () => {
    const err = new SchemaError('bad schema');
    expect(err.name).toBe('SchemaError');
    expect(err.code).toBe('OBJUI-002');
    expect(err).toBeInstanceOf(ObjectUIError);
  });
});

describe('RegistryError', () => {
  it('should accept a custom code', () => {
    const err = new RegistryError('not found', 'OBJUI-001');
    expect(err.name).toBe('RegistryError');
    expect(err.code).toBe('OBJUI-001');
    expect(err).toBeInstanceOf(ObjectUIError);
  });
});

describe('ExpressionError', () => {
  it('should default to OBJUI-003', () => {
    const err = new ExpressionError('eval failed');
    expect(err.name).toBe('ExpressionError');
    expect(err.code).toBe('OBJUI-003');
  });
});

describe('PluginError', () => {
  it('should accept a custom code', () => {
    const err = new PluginError('missing dep', 'OBJUI-004');
    expect(err.name).toBe('PluginError');
    expect(err.code).toBe('OBJUI-004');
  });
});

describe('FieldValidationError', () => {
  it('should default to OBJUI-009', () => {
    const err = new FieldValidationError('invalid field');
    expect(err.name).toBe('FieldValidationError');
    expect(err.code).toBe('OBJUI-009');
  });
});

// ---------------------------------------------------------------------------
// createError factory
// ---------------------------------------------------------------------------

describe('createError', () => {
  it('should create a RegistryError for OBJUI-001', () => {
    const err = createError('OBJUI-001', { type: 'fancy-button' });
    expect(err).toBeInstanceOf(RegistryError);
    expect(err.message).toBe('Unknown component type: "fancy-button"');
    expect(err.code).toBe('OBJUI-001');
  });

  it('should create a SchemaError for OBJUI-002', () => {
    const err = createError('OBJUI-002', { reason: 'missing type' });
    expect(err).toBeInstanceOf(SchemaError);
    expect(err.message).toContain('missing type');
  });

  it('should create an ExpressionError for OBJUI-003', () => {
    const err = createError('OBJUI-003', { expression: '${bad}' });
    expect(err).toBeInstanceOf(ExpressionError);
  });

  it('should create a PluginError for OBJUI-004', () => {
    const err = createError('OBJUI-004', { dependency: 'chart-lib' });
    expect(err).toBeInstanceOf(PluginError);
    expect(err.message).toContain('chart-lib');
  });

  it('should create a PluginError for OBJUI-005', () => {
    const err = createError('OBJUI-005', { plugin: 'grid' });
    expect(err).toBeInstanceOf(PluginError);
  });

  it('should create a PluginError for OBJUI-006', () => {
    const err = createError('OBJUI-006', { plugin: 'kanban' });
    expect(err).toBeInstanceOf(PluginError);
  });

  it('should create a RegistryError for OBJUI-007', () => {
    const err = createError('OBJUI-007', { namespace: 'old-ns' });
    expect(err).toBeInstanceOf(RegistryError);
  });

  it('should create a FieldValidationError for OBJUI-009', () => {
    const err = createError('OBJUI-009', { field: 'email' });
    expect(err).toBeInstanceOf(FieldValidationError);
  });

  it('should create a base ObjectUIError for OBJUI-008', () => {
    const err = createError('OBJUI-008', { scope: 'readOnlyScope' });
    expect(err).toBeInstanceOf(ObjectUIError);
    expect(err.message).toContain('readOnlyScope');
  });

  it('should create a base ObjectUIError for OBJUI-010', () => {
    const err = createError('OBJUI-010', { action: 'save' });
    expect(err).toBeInstanceOf(ObjectUIError);
    expect(err.message).toContain('save');
  });

  it('should handle unknown error codes gracefully', () => {
    const err = createError('OBJUI-999');
    expect(err).toBeInstanceOf(ObjectUIError);
    expect(err.message).toContain('Unknown error code');
  });

  it('should pass through details', () => {
    const err = createError('OBJUI-001', { type: 'x' }, { extra: true });
    expect(err.details).toEqual({ extra: true });
  });
});

// ---------------------------------------------------------------------------
// formatErrorMessage
// ---------------------------------------------------------------------------

describe('formatErrorMessage', () => {
  it('should include code and message', () => {
    const err = new ObjectUIError('something broke', 'OBJUI-001');
    const formatted = formatErrorMessage(err, false);

    expect(formatted).toBe('[OBJUI-001] something broke');
  });

  it('should include suggestion and docs in dev mode', () => {
    const err = createError('OBJUI-001', { type: 'magic-box' });
    const formatted = formatErrorMessage(err, true);

    expect(formatted).toContain('[OBJUI-001]');
    expect(formatted).toContain('💡 Suggestion:');
    expect(formatted).toContain('📖 Docs:');
    expect(formatted).toContain('https://objectui.dev/docs/errors/OBJUI-001');
  });

  it('should not include suggestion in production mode', () => {
    const err = createError('OBJUI-002', { reason: 'bad' });
    const formatted = formatErrorMessage(err, false);

    expect(formatted).not.toContain('💡 Suggestion:');
    expect(formatted).not.toContain('📖 Docs:');
  });

  it('should handle errors with unknown codes gracefully', () => {
    const err = new ObjectUIError('custom', 'CUSTOM-001');
    const formatted = formatErrorMessage(err, true);

    // No entry in ERROR_CODES so no suggestion appended
    expect(formatted).toBe('[CUSTOM-001] custom');
  });
});
