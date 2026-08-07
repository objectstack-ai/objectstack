// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

/**
 * System Identifier Schema
 * 
 * Universal naming convention for all machine identifiers (API Names) in ObjectStack.
 * Enforces lowercase with underscores or dots to ensure:
 * - Cross-platform compatibility (case-insensitive filesystems)
 * - URL-friendliness (no encoding needed)
 * - Database consistency (no collation issues)
 * - Security (no case-sensitivity bugs in permission checks)
 * 
 * **Applies to all metadata that acts as a machine identifier:**
 * - Object names (tables/collections)
 * - Field names
 * - Role names
 * - Permission set names
 * - Action/trigger names
 * - Event keys
 * - App IDs
 * - Menu/page IDs
 * - Select option values
 * - Workflow names
 * - Webhook names
 * 
 * **Naming Convention Summary:**
 * | Type | Pattern | Example |
 * |------|---------|---------|
 * | Machine ID | snake_case | `crm_account`, `btn_submit`, `role_admin` |
 * | Event keys | dot.notation | `user.login`, `order.created` |
 * | Labels | Any case | `Client Account`, `Submit Form` |
 * 
 * @example Valid identifiers
 * - 'account'
 * - 'crm_account'
 * - 'user_profile'
 * - 'order.created' (for events)
 * - 'api_v2_endpoint'
 * 
 * @example Invalid identifiers (will be rejected)
 * - 'Account' (uppercase)
 * - 'CrmAccount' (camelCase)
 * - 'crm-account' (kebab-case - use underscore instead)
 * - 'user profile' (spaces)
 */
import { lazySchema } from './lazy-schema';
export const SystemIdentifierSchema = lazySchema(() => z
  .string()
  .min(2, { message: 'System identifier must be at least 2 characters' })
  .regex(/^[a-z][a-z0-9_.]*$/, {
    message:
      'System identifier must be lowercase, starting with a letter, and may contain letters, numbers, underscores, or dots (e.g., "user_profile" or "order.created")',
  })
  .describe('System identifier (lowercase with underscores or dots)'));

/**
 * Strict Snake Case Identifier
 * 
 * More restrictive than SystemIdentifierSchema - only allows underscores (no dots).
 * Use this for identifiers that should NOT contain dots (e.g., database table/column names).
 * 
 * @example Valid
 * - 'account'
 * - 'crm_account'
 * - 'user_profile'
 * 
 * @example Invalid
 * - 'user.profile' (dots not allowed)
 * - 'UserProfile' (uppercase)
 */
export const SnakeCaseIdentifierSchema = lazySchema(() => z
  .string()
  .min(2, { message: 'Identifier must be at least 2 characters' })
  .regex(/^[a-z][a-z0-9_]*$/, {
    message:
      'Identifier must be lowercase snake_case, starting with a letter, and may contain only letters, numbers, and underscores (e.g., "user_profile")',
  })
  .describe('Snake case identifier (lowercase with underscores only)'));

/**
 * Event Name Identifier
 * 
 * Specialized identifier for event names that encourages dot notation.
 * Used in event-driven systems, message queues, and webhooks.
 * 
 * Pattern: `namespace.action` or `entity.event_type`
 * 
 * @example Valid
 * - 'user.created'
 * - 'order.paid'
 * - 'user.login_success'
 * - 'alarm.high_cpu'
 * 
 * @example Invalid
 * - 'UserCreated' (camelCase)
 * - 'user_created' (should use dots for namespacing)
 */
export const EventNameSchema = lazySchema(() => z
  .string()
  .min(3, { message: 'Event name must be at least 3 characters' })
  .regex(/^[a-z][a-z0-9_.]*$/, {
    message:
      'Event name must be lowercase with dots for namespacing (e.g., "user.created", "order.paid")',
  })
  .describe('Event name (lowercase with dot notation for namespacing)'));

/**
 * Type Exports
 */
export type SystemIdentifier = z.input<typeof SystemIdentifierSchema>;
export type SnakeCaseIdentifier = z.input<typeof SnakeCaseIdentifierSchema>;
export type EventName = z.input<typeof EventNameSchema>;
