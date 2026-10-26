/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// ---------------------------------------------------------------------------
// Error Code Registry
// ---------------------------------------------------------------------------

export interface ErrorCodeEntry {
  code: string;
  message: string;
  suggestion: string;
  docUrl: string;
}

const BASE_DOC_URL = 'https://objectui.dev/docs/errors';

export const ERROR_CODES: Record<string, ErrorCodeEntry> = {
  'OBJUI-001': {
    code: 'OBJUI-001',
    message: 'Unknown component type: "${type}"',
    suggestion:
      'Ensure the component is registered via registry.register() before rendering. Check for typos in the component type name.',
    docUrl: `${BASE_DOC_URL}/OBJUI-001`,
  },
  'OBJUI-002': {
    code: 'OBJUI-002',
    message: 'Schema validation failed: ${reason}',
    suggestion:
      'Verify the schema against the ObjectUI JSON spec. Run the built-in schema validator for details.',
    docUrl: `${BASE_DOC_URL}/OBJUI-002`,
  },
  'OBJUI-003': {
    code: 'OBJUI-003',
    message: 'Expression evaluation failed: ${expression}',
    suggestion:
      'Check the expression syntax and ensure all referenced variables exist in the current data scope.',
    docUrl: `${BASE_DOC_URL}/OBJUI-003`,
  },
  'OBJUI-004': {
    code: 'OBJUI-004',
    message: 'Plugin dependency missing: "${dependency}"',
    suggestion:
      'Install the required dependency and register it before loading this plugin.',
    docUrl: `${BASE_DOC_URL}/OBJUI-004`,
  },
  'OBJUI-005': {
    code: 'OBJUI-005',
    message: 'Plugin already loaded: "${plugin}"',
    suggestion:
      'A plugin with the same name is already registered. Remove the duplicate or use a unique plugin name.',
    docUrl: `${BASE_DOC_URL}/OBJUI-005`,
  },
  'OBJUI-006': {
    code: 'OBJUI-006',
    message: 'Plugin not found: "${plugin}"',
    suggestion:
      'Verify the plugin name and ensure it has been registered before access.',
    docUrl: `${BASE_DOC_URL}/OBJUI-006`,
  },
  'OBJUI-007': {
    code: 'OBJUI-007',
    message: 'Registry namespace deprecated: "${namespace}"',
    suggestion:
      'Migrate to the new namespace format. See the migration guide for details.',
    docUrl: `${BASE_DOC_URL}/OBJUI-007`,
  },
  'OBJUI-008': {
    code: 'OBJUI-008',
    message: 'Read-only scope violation: "${scope}"',
    suggestion:
      'You are trying to mutate a read-only data scope. Use a writable scope or clone the data before modifying.',
    docUrl: `${BASE_DOC_URL}/OBJUI-008`,
  },
  'OBJUI-009': {
    code: 'OBJUI-009',
    message: 'Invalid field configuration: "${field}"',
    suggestion:
      'Check the field schema for required properties (type, name). Ensure the field widget is registered.',
    docUrl: `${BASE_DOC_URL}/OBJUI-009`,
  },
  'OBJUI-010': {
    code: 'OBJUI-010',
    message: 'Action execution failed: "${action}"',
    suggestion:
      'Verify the action handler is registered and that all required parameters are provided.',
    docUrl: `${BASE_DOC_URL}/OBJUI-010`,
  },
} as const;

// ---------------------------------------------------------------------------
// Type Guards
// ---------------------------------------------------------------------------

/**
 * Check whether a string is a known ObjectUI error code.
 */
export function isErrorCode(code: unknown): code is keyof typeof ERROR_CODES {
  return typeof code === 'string' && code in ERROR_CODES;
}

// ---------------------------------------------------------------------------
// Base Error Class
// ---------------------------------------------------------------------------

/**
 * Base error class for all ObjectUI errors.
 */
export class ObjectUIError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ObjectUIError';

    // Maintains proper stack trace for where error was thrown (only in V8)
    if ((Error as any).captureStackTrace) {
      (Error as any).captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Convert error to JSON for logging / debugging.
   */
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      details: this.details,
      stack: this.stack,
    };
  }
}

/**
 * Type guard to check if an error is an ObjectUIError.
 */
export function isObjectUIError(error: unknown): error is ObjectUIError {
  return error instanceof ObjectUIError;
}

// ---------------------------------------------------------------------------
// Specialized Error Classes
// ---------------------------------------------------------------------------

/** Thrown when a schema is invalid or fails validation. */
export class SchemaError extends ObjectUIError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'OBJUI-002', details);
    this.name = 'SchemaError';
  }
}

/** Thrown when a registry operation fails. */
export class RegistryError extends ObjectUIError {
  constructor(message: string, code: string, details?: Record<string, unknown>) {
    super(message, code, details);
    this.name = 'RegistryError';
  }
}

/** Thrown when expression evaluation fails. */
export class ExpressionError extends ObjectUIError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'OBJUI-003', details);
    this.name = 'ExpressionError';
  }
}

/** Thrown when a plugin operation fails. */
export class PluginError extends ObjectUIError {
  constructor(message: string, code: string, details?: Record<string, unknown>) {
    super(message, code, details);
    this.name = 'PluginError';
  }
}

/** Thrown when validation of user input / field config fails. */
export class FieldValidationError extends ObjectUIError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'OBJUI-009', details);
    this.name = 'FieldValidationError';
  }
}

// ---------------------------------------------------------------------------
// Factory & Formatting Helpers
// ---------------------------------------------------------------------------

/**
 * Interpolate a template string with the given params.
 * Template variables use the `${key}` syntax.
 */
function interpolate(
  template: string,
  params: Record<string, string>,
): string {
  return template.replace(/\$\{(\w+)\}/g, (_match, key: string) => {
    if (!(key in params) && (globalThis as any).process?.env?.NODE_ENV !== 'production') {
      console.warn(`[ObjectUI] Missing interpolation parameter "${key}" in error message template.`);
    }
    return params[key] ?? `\${${key}}`;
  });
}

/**
 * Create an `ObjectUIError` (or subclass) from a known error code.
 *
 * @param code   - A registered error code (e.g. `"OBJUI-001"`).
 * @param params - Values to interpolate into the message template.
 * @param details - Optional extra details attached to the error.
 */
export function createError(
  code: string,
  params: Record<string, string> = {},
  details?: Record<string, unknown>,
): ObjectUIError {
  const entry = ERROR_CODES[code];
  const message = entry
    ? interpolate(entry.message, params)
    : `Unknown error code: ${code}`;

  switch (code) {
    case 'OBJUI-002':
      return new SchemaError(message, details);
    case 'OBJUI-003':
      return new ExpressionError(message, details);
    case 'OBJUI-004':
    case 'OBJUI-005':
    case 'OBJUI-006':
      return new PluginError(message, code, details);
    case 'OBJUI-007':
    case 'OBJUI-001':
      return new RegistryError(message, code, details);
    case 'OBJUI-009':
      return new FieldValidationError(message, details);
    default:
      return new ObjectUIError(message, code, details);
  }
}

/**
 * Format an error message with actionable fix suggestions in development mode.
 *
 * @param error - The `ObjectUIError` to format.
 * @param isDev - When `true`, appends the suggestion and documentation link.
 */
export function formatErrorMessage(
  error: ObjectUIError,
  isDev: boolean = (globalThis as any).process?.env?.NODE_ENV !== 'production',
): string {
  const entry = ERROR_CODES[error.code];

  let formatted = `[${error.code}] ${error.message}`;

  if (isDev && entry) {
    formatted += `\n\n💡 Suggestion: ${entry.suggestion}`;
    formatted += `\n📖 Docs: ${entry.docUrl}`;
  }

  return formatted;
}
