// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { normalizeObjectSchema, safeParseAsync } from '@modelcontextprotocol/sdk/server/zod-compat.js';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { StandardErrorCode } from '@objectstack/spec/api';
import { formatZodIssue } from '@objectstack/spec/shared';
import { z } from 'zod';

import { echoedKey, withControlCharactersEscaped } from './argument-echo.js';
import { codedErrorResult } from './mcp-http-tools.js';

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
 *
 * [#37411] And a `tools/call` whose ARGUMENTS fail the tool's published JSON
 * Schema is answered with the platform's coded refusal
 * ({@link answerToolArgumentRefusalsWithCode}), not the SDK's bare
 * `MCP error -32602: Input validation error` text.
 */
export function createPlatformMcpServer(
  ...args: ConstructorParameters<typeof McpServer>
): McpServer {
  const server = new McpServer(...args);
  answerMalformedParamsAsInvalidParams(server);
  answerToolArgumentRefusalsWithCode(server);
  return server;
}

type RegisteredToolLike = { inputSchema?: unknown };
type ToolInputValidator = (tool: RegisteredToolLike, args: unknown, toolName: string) => Promise<unknown>;

/** Problems named per refusal; the rest are counted. */
const MAX_REFUSAL_ISSUES = 10;

/** Characters of one refusal's message before it is cut. */
const MAX_REFUSAL_MESSAGE_LENGTH = 2000;

/**
 * [#37411] A `tools/call` whose arguments fail the tool's published JSON
 * Schema is the caller's mistake, refused before the tool runs. The SDK
 * refuses it by itself (`McpServer.validateToolInput`, measured on
 * `@modelcontextprotocol/sdk` 1.32.1): it throws `McpError(InvalidParams)`
 * and its `tools/call` handler turns the message into a tool error, so the
 * client read `MCP error -32602: Input validation error: …` with no `code`
 * and no `status`, and every unknown key echoed as it was sent (a raw newline
 * or NUL included, however many there were). Every other refusal a tool
 * answers carries the platform's coded shape ({@link codedErrorResult}), so
 * an AI client could branch on all of them but this one.
 *
 * Now the same failure answers the coded shape on both doors, because both
 * build their server here: `VALIDATION_ERROR`, status 400 (the status a REST
 * door answers a body that fails its schema with), and a message that names
 * each problem bounded and sanitised (`argument-echo.ts`): at most
 * {@link MAX_REFUSAL_ISSUES} problems, caller-written keys and paths escaped
 * and cut, and the whole message cut at {@link MAX_REFUSAL_MESSAGE_LENGTH}.
 * It is still a tool error (`isError: true`, one text content), never a
 * JSON-RPC error, as every refusal on this surface is.
 *
 * How: the SDK's own validator runs first and decides. Only when it refuses
 * with `InvalidParams` are the arguments parsed again, the way it parses them,
 * to read the issues its message flattened; a refusal the schema parse does
 * not reproduce (the SDK's argument-size cap) keeps the SDK's answer. A
 * successful call is parsed once, as before. The refusal leaves as a plain
 * `Error` whose message IS the coded result's text: the SDK hands a thrown
 * message to its tool-error builder verbatim, which yields exactly the result
 * {@link codedErrorResult} builds.
 *
 * `validateToolInput` is private to the SDK and read once here; its absence
 * is loud, as the request-handler seam's is: a later SDK that renames it
 * fails server construction naming this function, never silently goes back
 * to the uncoded answer.
 */
function answerToolArgumentRefusalsWithCode(server: McpServer): void {
  const target = server as unknown as { validateToolInput?: ToolInputValidator };
  const validate = target.validateToolInput;
  if (typeof validate !== 'function') {
    throw new Error(
      'answerToolArgumentRefusalsWithCode: the MCP SDK no longer validates tool arguments where this server '
        + 'reads it, so a tool argument that fails its schema would be refused without the platform\'s code. '
        + 'Re-read the SDK tools/call path and move this seam.',
    );
  }
  target.validateToolInput = async (tool, args, toolName) => {
    try {
      return await validate.call(server, tool, args, toolName);
    } catch (error) {
      if (!(error instanceof McpError) || error.code !== ErrorCode.InvalidParams) throw error;
      const issues = await schemaIssuesOf(tool, args);
      if (issues === undefined) throw error;
      throw new Error(toolArgumentRefusalText(toolName, issues));
    }
  };
}

/** The issues the tool's input schema finds in `args`, parsed as the SDK parses them; `undefined` when it finds none. */
async function schemaIssuesOf(tool: RegisteredToolLike, args: unknown): Promise<ZodIssueLike[] | undefined> {
  if (tool?.inputSchema === undefined) return undefined;
  const schema = (normalizeObjectSchema(tool.inputSchema as never) ?? tool.inputSchema) as Parameters<typeof safeParseAsync>[0];
  const parsed = await safeParseAsync(schema, args ?? {});
  if (parsed.success) return undefined;
  const issues = (parsed.error as { issues?: unknown } | undefined)?.issues;
  return Array.isArray(issues) && issues.length > 0 ? (issues as ZodIssueLike[]) : undefined;
}

/** The text of the coded refusal for `issues` on `toolName`. */
export function toolArgumentRefusalText(toolName: string, issues: readonly ZodIssueLike[]): string {
  const shown = issues.slice(0, MAX_REFUSAL_ISSUES).map(issueSentence);
  const notShown = issues.length - shown.length;
  let message = `Invalid arguments for tool ${toolName}: ${shown.join('\n')}`;
  if (notShown > 0) message += `\n${notShown} more problem(s) not shown.`;
  // Cut between whole characters, never inside a surrogate pair.
  const characters = Array.from(message);
  if (characters.length > MAX_REFUSAL_MESSAGE_LENGTH) message = `${characters.slice(0, MAX_REFUSAL_MESSAGE_LENGTH).join('')}…`;
  const result = codedErrorResult({ code: StandardErrorCode.enum.VALIDATION_ERROR, status: 400, message });
  return result.content[0].text;
}

/**
 * One problem as the refusal names it, in the SDK's own layout (`message at
 * path`). An unknown key the message quotes raw (a schema this package did
 * not close, answered with zod's or the spec's own sentence) is replaced by
 * its {@link echoedKey} form; the platform's own tools already render theirs
 * that way. Path segments are the caller's keys too, so they are echoed the
 * same way, and any control character left in the message is escaped.
 */
function issueSentence(issue: ZodIssueLike): string {
  let text = issue.message;
  if (issue.code === 'unrecognized_keys' && Array.isArray(issue.keys)) {
    for (const key of issue.keys) {
      const echoed = echoedKey(key);
      if (key !== '' && echoed !== key) text = text.split(key).join(echoed);
    }
  }
  text = withControlCharactersEscaped(text);
  const path = issue.path.map((segment) => echoedKey(String(segment))).join('.');
  return path ? `${text} at ${path}` : text;
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
