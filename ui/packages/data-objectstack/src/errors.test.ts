/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import {
  ObjectStackError,
  MetadataNotFoundError,
  BulkOperationError,
  ConnectionError,
  AuthenticationError,
  DataApiValidationError,
  createErrorFromResponse,
  isObjectStackError,
  isErrorType,
} from './errors';

describe('Error Classes', () => {
  describe('ObjectStackError', () => {
    it('should create base error with all properties', () => {
      const error = new ObjectStackError(
        'Test error',
        'TEST_ERROR',
        500,
        { extra: 'info' }
      );

      expect(error.message).toBe('Test error');
      expect(error.code).toBe('TEST_ERROR');
      expect(error.statusCode).toBe(500);
      expect(error.details).toEqual({ extra: 'info' });
      expect(error.name).toBe('ObjectStackError');
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(ObjectStackError);
    });

    it('should work without optional parameters', () => {
      const error = new ObjectStackError('Test error', 'TEST_ERROR');

      expect(error.message).toBe('Test error');
      expect(error.code).toBe('TEST_ERROR');
      expect(error.statusCode).toBeUndefined();
      expect(error.details).toBeUndefined();
    });

    it('should convert to JSON correctly', () => {
      const error = new ObjectStackError(
        'Test error',
        'TEST_ERROR',
        500,
        { extra: 'info' }
      );

      const json = error.toJSON();
      expect(json).toHaveProperty('name', 'ObjectStackError');
      expect(json).toHaveProperty('message', 'Test error');
      expect(json).toHaveProperty('code', 'TEST_ERROR');
      expect(json).toHaveProperty('statusCode', 500);
      expect(json).toHaveProperty('details', { extra: 'info' });
      expect(json).toHaveProperty('stack');
    });

    it('should maintain proper stack trace', () => {
      const error = new ObjectStackError('Test error', 'TEST_ERROR');
      expect(error.stack).toBeDefined();
      expect(error.stack).toContain('ObjectStackError');
    });
  });

  describe('MetadataNotFoundError', () => {
    it('should create metadata not found error', () => {
      const error = new MetadataNotFoundError('users');

      expect(error.message).toBe('Metadata not found for object: users');
      expect(error.code).toBe('METADATA_NOT_FOUND');
      expect(error.statusCode).toBe(404);
      expect(error.name).toBe('MetadataNotFoundError');
      expect(error.details).toHaveProperty('objectName', 'users');
      expect(error).toBeInstanceOf(ObjectStackError);
      expect(error).toBeInstanceOf(MetadataNotFoundError);
    });

    it('should include additional details', () => {
      const error = new MetadataNotFoundError('users', { reason: 'Schema not loaded' });

      expect(error.details).toEqual({
        objectName: 'users',
        reason: 'Schema not loaded',
      });
    });
  });

  describe('BulkOperationError', () => {
    it('should create bulk operation error', () => {
      const errors = [
        { index: 0, error: 'Invalid data' },
        { index: 2, error: 'Duplicate key' },
      ];
      
      const error = new BulkOperationError('create', 8, 2, errors);

      expect(error.message).toBe('Bulk create operation failed: 8 succeeded, 2 failed');
      expect(error.code).toBe('BULK_OPERATION_ERROR');
      expect(error.statusCode).toBe(500);
      expect(error.name).toBe('BulkOperationError');
      expect(error.successCount).toBe(8);
      expect(error.failureCount).toBe(2);
      expect(error.errors).toEqual(errors);
      expect(error).toBeInstanceOf(ObjectStackError);
      expect(error).toBeInstanceOf(BulkOperationError);
    });

    it('should provide operation summary', () => {
      const errors = [{ index: 0, error: 'Error' }];
      const error = new BulkOperationError('update', 9, 1, errors);

      const summary = error.getSummary();
      expect(summary).toEqual({
        operation: 'update',
        total: 10,
        successful: 9,
        failed: 1,
        failureRate: 0.1,
        errors: errors,
      });
    });

    it('should handle different operation types', () => {
      const createError = new BulkOperationError('create', 5, 0, []);
      const updateError = new BulkOperationError('update', 3, 2, []);
      const deleteError = new BulkOperationError('delete', 10, 1, []);

      expect(createError.message).toContain('create');
      expect(updateError.message).toContain('update');
      expect(deleteError.message).toContain('delete');
    });
  });

  describe('ConnectionError', () => {
    it('should create connection error', () => {
      const error = new ConnectionError(
        'Network timeout',
        'https://api.example.com'
      );

      expect(error.message).toBe('Connection error: Network timeout');
      expect(error.code).toBe('CONNECTION_ERROR');
      expect(error.statusCode).toBe(503);
      expect(error.name).toBe('ConnectionError');
      expect(error.url).toBe('https://api.example.com');
      expect(error).toBeInstanceOf(ObjectStackError);
      expect(error).toBeInstanceOf(ConnectionError);
    });

    it('should work without URL', () => {
      const error = new ConnectionError('Network timeout');

      expect(error.url).toBeUndefined();
      expect(error.message).toBe('Connection error: Network timeout');
    });
  });

  describe('AuthenticationError', () => {
    it('should create authentication error', () => {
      const error = new AuthenticationError();

      expect(error.message).toBe('Authentication failed');
      expect(error.code).toBe('AUTHENTICATION_ERROR');
      expect(error.statusCode).toBe(401);
      expect(error.name).toBe('AuthenticationError');
      expect(error).toBeInstanceOf(ObjectStackError);
      expect(error).toBeInstanceOf(AuthenticationError);
    });

    it('should accept custom message', () => {
      const error = new AuthenticationError('Invalid API token');

      expect(error.message).toBe('Invalid API token');
    });

    it('should include additional details', () => {
      const error = new AuthenticationError('Invalid token', { token: 'abc123' });

      expect(error.details).toEqual({ token: 'abc123' });
    });
  });

  describe('DataApiValidationError', () => {
    it('should create validation error', () => {
      const error = new DataApiValidationError('Invalid input');

      expect(error.message).toBe('Invalid input');
      expect(error.code).toBe('VALIDATION_ERROR');
      expect(error.statusCode).toBe(400);
      expect(error.name).toBe('ValidationError');
      expect(error).toBeInstanceOf(ObjectStackError);
      expect(error).toBeInstanceOf(DataApiValidationError);
    });

    it('should include field information', () => {
      const error = new DataApiValidationError('Email is invalid', 'email');

      expect(error.field).toBe('email');
      expect(error.details).toHaveProperty('field', 'email');
    });

    it('should include validation errors array', () => {
      const validationErrors = [
        { field: 'email', message: 'Invalid email format' },
        { field: 'age', message: 'Must be a positive number' },
      ];
      
      const error = new DataApiValidationError(
        'Validation failed',
        undefined,
        validationErrors
      );

      expect(error.validationErrors).toEqual(validationErrors);
      expect(error.getValidationErrors()).toEqual(validationErrors);
    });

    it('should return empty array when no validation errors', () => {
      const error = new DataApiValidationError('Validation failed');

      expect(error.getValidationErrors()).toEqual([]);
    });
  });
});

describe('Error Helpers', () => {
  describe('createErrorFromResponse', () => {
    it('should create AuthenticationError for 401 status', () => {
      const response = {
        status: 401,
        message: 'Unauthorized',
        data: null,
      };

      const error = createErrorFromResponse(response, 'API request');

      expect(error).toBeInstanceOf(AuthenticationError);
      expect(error.message).toBe('Unauthorized');
      expect(error.statusCode).toBe(401);
    });

    it('should create AuthenticationError for 403 status', () => {
      const response = {
        status: 403,
        message: 'Forbidden',
      };

      const error = createErrorFromResponse(response);

      expect(error).toBeInstanceOf(AuthenticationError);
      expect(error.statusCode).toBe(403);
    });

    it('should create MetadataNotFoundError for 404 with metadata context', () => {
      const response = {
        status: 404,
        message: 'Not found',
      };

      const error = createErrorFromResponse(response, 'getObjectSchema(users)');

      expect(error).toBeInstanceOf(MetadataNotFoundError);
      expect(error.statusCode).toBe(404);
      expect((error as MetadataNotFoundError).details?.objectName).toBe('users');
    });

    it('should create generic error for 404 without metadata context', () => {
      const response = {
        status: 404,
        message: 'Not found',
      };

      const error = createErrorFromResponse(response, 'data request');

      expect(error).toBeInstanceOf(ObjectStackError);
      expect(error).not.toBeInstanceOf(MetadataNotFoundError);
      expect(error.code).toBe('NOT_FOUND');
    });

    it('should create DataApiValidationError for 400 status', () => {
      const response = {
        status: 400,
        message: 'Bad request',
        data: {
          errors: [
            { field: 'email', message: 'Invalid email' },
          ],
        },
      };

      const error = createErrorFromResponse(response);

      expect(error).toBeInstanceOf(DataApiValidationError);
      expect(error.statusCode).toBe(400);
      expect((error as DataApiValidationError).validationErrors).toEqual([
        { field: 'email', message: 'Invalid email' },
      ]);
    });

    it('should create ConnectionError for 503 status', () => {
      const response = {
        status: 503,
        message: 'Service unavailable',
        config: { url: 'https://api.example.com' },
      };

      const error = createErrorFromResponse(response);

      expect(error).toBeInstanceOf(ConnectionError);
      expect(error.statusCode).toBe(503);
      expect((error as ConnectionError).url).toBe('https://api.example.com');
    });

    it('should create ConnectionError for 504 status', () => {
      const response = {
        status: 504,
        message: 'Gateway timeout',
      };

      const error = createErrorFromResponse(response);

      expect(error).toBeInstanceOf(ConnectionError);
      expect(error.statusCode).toBe(504);
    });

    it('should create generic error for unknown status', () => {
      const response = {
        status: 418,
        message: "I'm a teapot",
      };

      const error = createErrorFromResponse(response);

      expect(error).toBeInstanceOf(ObjectStackError);
      expect(error.code).toBe('UNKNOWN_ERROR');
      expect(error.statusCode).toBe(418);
    });

    it('should handle response without status code', () => {
      const response = {
        message: 'Unknown error',
      };

      const error = createErrorFromResponse(response);

      expect(error).toBeInstanceOf(ObjectStackError);
      expect(error.statusCode).toBe(500);
    });

    it('should include context in error details', () => {
      const response = {
        status: 500,
        message: 'Server error',
      };

      const error = createErrorFromResponse(response, 'user creation');

      expect(error.details).toHaveProperty('context', 'user creation');
    });
  });

  describe('isObjectStackError', () => {
    it('should return true for ObjectStackError instances', () => {
      const error = new ObjectStackError('Test', 'TEST');
      expect(isObjectStackError(error)).toBe(true);
    });

    it('should return true for derived error classes', () => {
      const metadataError = new MetadataNotFoundError('users');
      const bulkError = new BulkOperationError('create', 0, 1, []);
      const connError = new ConnectionError('timeout');
      const authError = new AuthenticationError();
      const validError = new DataApiValidationError('invalid');

      expect(isObjectStackError(metadataError)).toBe(true);
      expect(isObjectStackError(bulkError)).toBe(true);
      expect(isObjectStackError(connError)).toBe(true);
      expect(isObjectStackError(authError)).toBe(true);
      expect(isObjectStackError(validError)).toBe(true);
    });

    it('should return false for regular Error', () => {
      const error = new Error('Regular error');
      expect(isObjectStackError(error)).toBe(false);
    });

    it('should return false for non-error values', () => {
      expect(isObjectStackError(null)).toBe(false);
      expect(isObjectStackError(undefined)).toBe(false);
      expect(isObjectStackError('error')).toBe(false);
      expect(isObjectStackError({})).toBe(false);
    });
  });

  describe('isErrorType', () => {
    it('should return true for matching error type', () => {
      const error = new MetadataNotFoundError('users');
      expect(isErrorType(error, MetadataNotFoundError)).toBe(true);
    });

    it('should return false for non-matching error type', () => {
      const error = new MetadataNotFoundError('users');
      expect(isErrorType(error, DataApiValidationError)).toBe(false);
    });

    it('should return true for base class check', () => {
      const error = new MetadataNotFoundError('users');
      expect(isErrorType(error, ObjectStackError)).toBe(true);
    });

    it('should return false for non-error values', () => {
      expect(isErrorType(null, ObjectStackError)).toBe(false);
      expect(isErrorType(undefined, ObjectStackError)).toBe(false);
      expect(isErrorType({}, ObjectStackError)).toBe(false);
    });
  });
});
