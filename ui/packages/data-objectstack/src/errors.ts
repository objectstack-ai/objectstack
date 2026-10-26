/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Base error class for all ObjectStack adapter errors
 */
export class ObjectStackError extends Error {
  /**
   * Create a new ObjectStackError
   * 
   * @param message - Human-readable error message
   * @param code - Unique error code for programmatic handling
   * @param statusCode - Optional HTTP status code
   * @param details - Optional additional error details for debugging
   */
  constructor(
    message: string,
    public code: string,
    public statusCode?: number,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ObjectStackError';
    
    // Maintains proper stack trace for where error was thrown (only in V8)
    if ((Error as any).captureStackTrace) {
      (Error as any).captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Convert error to JSON for logging/debugging
   */
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      statusCode: this.statusCode,
      details: this.details,
      stack: this.stack,
    };
  }
}

/**
 * Error thrown when requested metadata/schema is not found
 */
export class MetadataNotFoundError extends ObjectStackError {
  constructor(
    objectName: string,
    details?: Record<string, unknown>
  ) {
    super(
      `Metadata not found for object: ${objectName}`,
      'METADATA_NOT_FOUND',
      404,
      { objectName, ...details }
    );
    this.name = 'MetadataNotFoundError';
  }
}

/**
 * Error thrown when a bulk operation fails
 */
export class BulkOperationError extends ObjectStackError {
  /**
   * Create a new BulkOperationError
   * 
   * @param operation - The bulk operation that failed (create, update, delete)
   * @param successCount - Number of successful operations
   * @param failureCount - Number of failed operations
   * @param errors - Array of individual errors
   * @param details - Additional error details
   */
  constructor(
    operation: 'create' | 'update' | 'delete',
    public successCount: number,
    public failureCount: number,
    public errors: Array<{ index: number; error: unknown }>,
    details?: Record<string, unknown>
  ) {
    super(
      `Bulk ${operation} operation failed: ${successCount} succeeded, ${failureCount} failed`,
      'BULK_OPERATION_ERROR',
      500,
      {
        operation,
        successCount,
        failureCount,
        errors,
        ...details,
      }
    );
    this.name = 'BulkOperationError';
  }

  /**
   * Get a summary of the bulk operation failure
   */
  getSummary() {
    const total = this.successCount + this.failureCount;
    const failureRate = total > 0 ? this.failureCount / total : 0;
    
    return {
      operation: this.details?.operation as string,
      total: total,
      successful: this.successCount,
      failed: this.failureCount,
      failureRate: failureRate,
      errors: this.errors,
    };
  }
}

/**
 * Error thrown when connection to ObjectStack server fails
 */
export class ConnectionError extends ObjectStackError {
  constructor(
    message: string,
    public url?: string,
    details?: Record<string, unknown>,
    statusCode?: number
  ) {
    super(
      `Connection error: ${message}`,
      'CONNECTION_ERROR',
      statusCode || 503,
      { url, ...details }
    );
    this.name = 'ConnectionError';
  }
}

/**
 * Error thrown when authentication fails
 */
export class AuthenticationError extends ObjectStackError {
  constructor(
    message: string = 'Authentication failed',
    details?: Record<string, unknown>,
    statusCode?: number
  ) {
    super(
      message,
      'AUTHENTICATION_ERROR',
      statusCode || 401,
      details
    );
    this.name = 'AuthenticationError';
  }
}

/**
 * Error thrown when the ObjectStack data API rejects a write as invalid.
 *
 * NOT the spec's `ValidationError` (`@objectstack/spec/kernel`), whose name this
 * class wore until objectui#3160 (objectstack#4115 ledger batch 6). That one is
 * a plain DATA SHAPE — `{ field, message, code? }`, one entry in a plugin
 * manifest's validation report — and `@object-ui/types` re-exports it under that
 * name. This is a runtime `Error` subclass carrying an HTTP status plus a list
 * of such entries, so the two are not even the same KIND of thing.
 *
 * The name follows the convention registered on objectstack#4115 for this
 * family — `<what was validated>Validation<Error|Result>`. `@object-ui/core`
 * took `SchemaNodeValidationError` for its SDUI-tree walk; this one belongs to
 * the data API.
 */
export class DataApiValidationError extends ObjectStackError {
  /**
   * Create a new DataApiValidationError
   *
   * @param message - Human-readable error message
   * @param field - The field that failed validation (optional)
   * @param validationErrors - Array of validation error details
   * @param details - Additional error details
   */
  constructor(
    message: string,
    public field?: string,
    public validationErrors?: Array<{ field: string; message: string }>,
    details?: Record<string, unknown>
  ) {
    super(
      message,
      'VALIDATION_ERROR',
      400,
      {
        field,
        validationErrors,
        ...details,
      }
    );
    // The RUNTIME name stays `'ValidationError'` on purpose — it is the wire
    // discriminator this adapter shares with `@objectstack/client` and with
    // consumers that sniff `err.name` rather than `instanceof`
    // (`normaliseClientError` here, `@object-ui/react`'s `error-message`).
    // Renaming the TypeScript symbol is a source-level rename; renaming this
    // string would be a behaviour change nobody asked for.
    this.name = 'ValidationError';
  }

  /**
   * Get all validation errors as a formatted list
   */
  getValidationErrors() {
    return this.validationErrors || [];
  }
}

/**
 * Helper function to create an error from an HTTP response
 * 
 * @param response - Response object or error from fetch/axios
 * @param context - Additional context for debugging
 * @returns Appropriate error instance
 */
export function createErrorFromResponse(response: Record<string, unknown>, context?: string): ObjectStackError {
  const status = (response?.status as number) || (response?.statusCode as number) || 500;
  const message = (response?.message as string) || (response?.statusText as string) || 'Unknown error';
  const details = {
    context,
    response: {
      status,
      data: response?.data,
      headers: response?.headers,
    },
  };

  switch (status) {
    case 401:
      return new AuthenticationError(message, details, 401);
    
    case 403:
      return new AuthenticationError(message, details, 403);
    
    case 404:
      // Check if it's a metadata request based on context
      if (context?.includes('metadata') || context?.includes('schema') || context?.includes('getObjectSchema')) {
        const objectName = extractObjectName(context);
        return new MetadataNotFoundError(objectName, details);
      }
      return new ObjectStackError(message, 'NOT_FOUND', 404, details);
    
    case 400:
      return new DataApiValidationError(message, undefined, (response?.data as Record<string, unknown>)?.errors as Array<{ field: string; message: string }>, details);
    
    case 503:
      return new ConnectionError(message, (response?.config as Record<string, unknown>)?.url as string, details, 503);
    
    case 504:
      return new ConnectionError(message, (response?.config as Record<string, unknown>)?.url as string, details, 504);
    
    default:
      return new ObjectStackError(message, 'UNKNOWN_ERROR', status, details);
  }
}

/**
 * Helper to extract object name from context string
 */
function extractObjectName(context?: string): string {
  if (!context) return 'unknown';
  
  // Try to extract object name from patterns like "getObjectSchema(users)"
  const match = context.match(/\(([^)]+)\)/);
  return match ? match[1] : 'unknown';
}

/**
 * Type guard to check if an error is an ObjectStackError
 */
export function isObjectStackError(error: unknown): error is ObjectStackError {
  return error instanceof ObjectStackError;
}

/**
 * Type guard to check if an error is a specific ObjectStack error type
 */
export function isErrorType<T extends ObjectStackError>(
  error: unknown,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  errorClass: new (...args: any[]) => T
): error is T {
  return error instanceof errorClass;
}
