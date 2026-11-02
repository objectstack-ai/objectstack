// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { formatZodIssue } from '@objectstack/spec/shared';
import { z } from 'zod';

/**
 * The one place the platform builds an MCP {@link McpServer}: both transports
 * (the long-lived stdio server and the per-request Streamable HTTP server) go
 * through here, so a malformed request gets the same answer on either.
 *
 * What it adds over `new McpServer(...)`: a request whose `params` fail the
 * method's request schema is answered as JSON-RPC `-32602 Invalid params` with
 * a sentence naming the param (`params.name is required`), instead of
 * `-32603 Internal error` carrying the serialised Zod issue list.
 *
 * Why the SDK answers -32603 (measured on `@modelcontextprotocol/sdk` 1.32.1,
 * and unchanged in 1.32.2): `Protocol.setRequestHandler` installs a closure
 * that parses the request with the method's schema and rethrows the ZodError
 * as-is. A ZodError has no numeric `code`, so the protocol's error branch
 * falls back to `InternalError` with the error's message — the JSON dump. The
 * client is told the server failed when its own input was wrong, and an agent
 * that treats Internal error as retryable retries a request that can never
 * succeed.
 */
export function createPlatformMcpServer(
  ...args: ConstructorParameters<typeof McpServer>
): McpServer {
  const server = new McpServer(...args);
  answerMalformedParamsAsInvalidParams(server);
  return server;
}

type RequestDispatcher = (request: unknown, extra: unknown) => Promise<unknown>;

/**
 * Wraps every request dispatcher the low-level `Server` holds — those the SDK
 * installed in its constructor (`initialize`, `ping`, …) and every one
 * registered later (`tools/call`, `prompts/get`, `resources/read`, …).
 *
 * The SDK keeps them in the protocol's `_requestHandlers` map, which it does
 * not expose; there is no public hook between the request-schema parse and
 * the error answer. The map is read once here, and its absence is loud: a
 * later SDK that renames it fails server construction with this function's
 * name, never silently goes back to -32603.
 *
 * Only a parse failure is mapped. The installed dispatcher parses
 * SYNCHRONOUSLY and only then calls the async handler, so a ZodError thrown
 * synchronously is the request-schema parse and nothing else; a ZodError from
 * inside a handler arrives as a rejected promise and keeps its own answer.
 */
function answerMalformedParamsAsInvalidParams(server: McpServer): void {
  const handlers = (server.server as unknown as { _requestHandlers?: unknown })._requestHandlers;
  if (!(handlers instanceof Map)) {
    throw new Error(
      'answerMalformedParamsAsInvalidParams: the MCP SDK no longer keeps its request handlers where this '
        + 'server reads them, so malformed params would answer -32603 Internal error instead of -32602 '
        + 'Invalid params. Re-read the SDK Protocol request path and move this seam.',
    );
  }
  const map = handlers as Map<string, RequestDispatcher>;

  const guard = (dispatch: RequestDispatcher): RequestDispatcher => (request, extra) => {
    try {
      return dispatch(request, extra);
    } catch (error) {
      if (isZodError(error)) {
        throw new McpError(ErrorCode.InvalidParams, invalidParamsSentence(error.issues, request));
      }
      throw error;
    }
  };

  for (const [method, dispatch] of map) map.set(method, guard(dispatch));
  const set = map.set.bind(map);
  map.set = (method, dispatch) => set(method, guard(dispatch));
}

interface ZodIssueLike {
  code: string;
  path: PropertyKey[];
  message: string;
  expected?: unknown;
  values?: unknown[];
  keys?: string[];
}

/**
 * The SDK parses with zod's core (`$ZodError`, not classic `ZodError`), so the
 * check is zod's own structural `instanceof` on the core class, which holds
 * across both builds.
 */
function isZodError(error: unknown): error is { issues: ZodIssueLike[] } {
  return error instanceof z.core.$ZodError;
}

/**
 * One plain-English sentence per issue, joined with `; ` (`McpError` itself
 * prefixes `MCP error -32602:`): `params.name is
 * required`, `params.name must be a string`. The path is the request's own
 * (`params.…`), so it names exactly what the caller sent. An issue outside the
 * two shapes above falls back to the platform's shared Zod issue formatter.
 */
export function invalidParamsSentence(issues: readonly ZodIssueLike[], request: unknown): string {
  const sentences = issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.map(String).join('.') : 'params';
    if (issue.code === 'invalid_type') {
      if (valueAt(request, issue.path) === undefined) return `${path} is required`;
      if (typeof issue.expected === 'string') return `${path} must be ${article(issue.expected)}`;
    }
    if (issue.code === 'invalid_value' && Array.isArray(issue.values) && issue.values.length > 0) {
      return `${path} must be one of ${issue.values.map((v) => JSON.stringify(v)).join(', ')}`;
    }
    if (issue.code === 'unrecognized_keys' && Array.isArray(issue.keys)) {
      return `${path} has unrecognized key(s): ${issue.keys.join(', ')}`;
    }
    return formatZodIssue(issue as Parameters<typeof formatZodIssue>[0]);
  });
  return sentences.join('; ');
}

function valueAt(root: unknown, path: readonly PropertyKey[]): unknown {
  let node: unknown = root;
  for (const key of path) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<PropertyKey, unknown>)[key];
  }
  return node;
}

function article(type: string): string {
  return /^[aeiou]/.test(type) ? `an ${type}` : `a ${type}`;
}
