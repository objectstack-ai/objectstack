// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Managing API keys is a signed-in-session act, on every data door.
 *
 * An API key acts as its owner for data, automation and MCP. Managing the
 * owner's credentials is not part of that: `POST /api/v1/keys` takes a mint
 * only from a principal a signed-in session admitted, and this module is the
 * same answer for the generic data doors that reach the `sys_api_key` rows
 * themselves (`PATCH /api/v1/data/sys_api_key/:id` and every sibling route
 * that writes through the per-object gate). A write to `sys_api_key` from a
 * principal an API key admitted is refused `403 PERMISSION_DENIED`, and
 * nothing is written; reads are unchanged.
 *
 * ## Why at the transport and not in an ObjectQL hook
 *
 * Which credential admitted the caller is decided once, by the shared resolver
 * (`resolveAuthzContext`'s `credential`), and handed to the door that called
 * it (`resolveRequestExecutionContext`'s `onAdmission`). The
 * `ExecutionContext` envelope does not carry it, so an ObjectQL hook cannot
 * ask it. Each door asks this function at its per-object gate, the one every
 * data route on that door passes: the runtime dispatcher's
 * `refuseUnexposedDataAction`, `RestServer.enforceApiAccess` (and per op on
 * its cross-object batch), and the stdio MCP transport's write arms
 * (`@objectstack/mcp` `stdio-data-bridge.ts`), whose principal an API key
 * admits by construction (ADR-0101).
 *
 * ## The rule
 *
 *  - Positive on the credential: refused only when the door was told an API
 *    key admitted the caller. A session caller, and a caller whose door was
 *    told nothing (an embedder handing the dispatcher its own context), keep
 *    today's answer.
 *  - Every operation that is not a read is refused, so a write verb added to
 *    a door later is covered from the day it lands.
 *  - A system-context write never reaches a door's gate as a caller, and the
 *    gates skip the system context before asking: the mint, the
 *    `last_used_at` stamp and the forced reset's revoke are untouched.
 */

import { SystemObjectName } from '@objectstack/spec/system';

/**
 * The data-door operations that only read. Every other operation on
 * `sys_api_key` (`create`, `update`, `delete`, `bulk`, `import`, and any verb a
 * door adds later) is a write for this rule.
 */
export const API_KEY_MANAGEMENT_READ_OPERATIONS: ReadonlySet<string> = new Set([
  'get',
  'list',
  'query',
  'find',
  'aggregate',
  'history',
  'export',
]);

/** The located refusal: names the road (sign in, the API Keys page) and nothing about the key presented. */
export const API_KEY_MANAGEMENT_SESSION_REQUIRED_MESSAGE =
  'PERMISSION_DENIED: Changing an API key requires a signed-in session. Sign in and manage the key from the '
  + 'API Keys page; a request authenticated with an API key cannot revoke, restore or change API keys.';

/** What a door hands the rule: the object addressed, the door's operation name, and the admitting credential. */
export interface ApiKeyManagementCredentialInput {
  object: unknown;
  operation: string;
  /** The credential the door's `onAdmission` was told, or `undefined` when it was told none. */
  credential: 'api_key' | 'session' | undefined;
}

/**
 * The refusal for a `sys_api_key` write from a principal an API key admitted,
 * or `undefined` when the rule does not apply. Thrown by the door, it renders
 * on the envelope the data doors already map (`code`, `status`, `object`),
 * the one the `sys_api_key` restore guard's refusal uses.
 */
export function apiKeyManagementCredentialRefusal(
  input: ApiKeyManagementCredentialInput,
): (Error & { code: 'PERMISSION_DENIED'; status: 403; statusCode: 403; object: string }) | undefined {
  if (input.credential !== 'api_key') return undefined;
  if (input.object !== SystemObjectName.API_KEY) return undefined;
  if (API_KEY_MANAGEMENT_READ_OPERATIONS.has(input.operation)) return undefined;
  return Object.assign(new Error(API_KEY_MANAGEMENT_SESSION_REQUIRED_MESSAGE), {
    code: 'PERMISSION_DENIED' as const,
    status: 403 as const,
    statusCode: 403 as const,
    object: SystemObjectName.API_KEY as string,
  });
}
