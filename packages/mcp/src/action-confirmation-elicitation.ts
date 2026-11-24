// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * # Asking the person in their client (step 1 of the amended confirmation contract)
 *
 * The MCP `run_action` and `resume_run` doors confirm an action whose author
 * declared `ai.requiresConfirmation: true` with the person, never with the
 * caller's own `confirm` (`AI_ACTION_CONFIRMATION_CAPABILITY`,
 * `@objectstack/spec/contracts`). Step 1 of that contract asks the person in
 * place: when the client advertised `elicitation` at `initialize` for the
 * session the call rides on, and the door can carry a request to it while the
 * call is open, the server sends ONE `elicitation/create` request in form mode
 * naming the action, the object and the record. This module is that request.
 *
 * The runtime owns WHEN it is asked (after every admission gate, the subject
 * load and its verdict included, and never for an AI service account); this
 * door owns HOW: {@link actionConfirmationElicitorFor} answers a function the
 * bridge calls with the subject, or `undefined` when this call cannot be
 * elicited, and the runtime then hands the call off (step 2) exactly as
 * before.
 *
 * ## Which doors can elicit
 *
 * Only a server that read the client's `initialize`. The long-lived server
 * behind the stdio transport keeps the client's capabilities for the session
 * and carries a request to the client while a call is open, so it elicits. The
 * Streamable HTTP door (`handleHttpRequest`) builds a fresh server for every
 * POST: the server that answers a `tools/call` never saw the client's
 * `initialize`, so it holds no capabilities and this function answers
 * `undefined` there. Its callers are handed off, as the contract's step 2
 * says a door that cannot elicit does, and are never refused for that alone.
 *
 * ## The answers
 *
 * Only the result's `action` is read; any `content` is not (the contract,
 * step 3.1), so a client's form payload can neither satisfy nor break it.
 *
 * - `accept`, `decline`, `cancel`: the client's own answer.
 * - `timed_out`: no answer within {@link ACTION_CONFIRMATION_ELICITATION_TIMEOUT_MS}.
 *   The SDK drops the pending request at that moment, so an answer that
 *   arrives later is never delivered and runs nothing.
 * - `cancel` also stands for an error answer to the request, a result the
 *   door cannot read, the tool call being cancelled while the question is
 *   open, and a connection that closes before an answer (the contract reads
 *   each the same way as a dismissal).
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ErrorCode, McpError, type ServerNotification, type ServerRequest } from '@modelcontextprotocol/sdk/types.js';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import { AI_ACTION_CONFIRMATION_CAPABILITY } from '@objectstack/spec/contracts';

/**
 * The door's bound on an elicited confirmation: how long the server waits for
 * the person's answer before it reads the question as unanswered (`timed_out`,
 * the contract's step 4, "within the door's bound, which the implementing door
 * names"). Five minutes: long enough for a person to read an action and its
 * record and decide, short enough that an abandoned question does not hold a
 * tool call open for the rest of a session. A door constant, not an
 * authorable key: no metadata author or caller sets it.
 */
export const ACTION_CONFIRMATION_ELICITATION_TIMEOUT_MS = 5 * 60_000;

/** What the person is asked to confirm: the action, the object and the record it runs on. */
export interface McpActionConfirmationSubject {
  /** The declarative action name. */
  actionName: string;
  /** The action's label, when its author gave one. */
  actionLabel?: string;
  /** The object the action operates on; omitted for object-less actions. */
  objectName?: string;
  /** The record the action runs on, when it takes one. */
  recordId?: string;
  /** The record's title, when the subject load read one. Never the id restated. */
  recordTitle?: string;
}

/** The person's answer to an elicited confirmation, as the door read it. */
export type McpActionConfirmationAnswer = 'accept' | 'decline' | 'cancel' | 'timed_out';

/**
 * Ask the person, in their client, to confirm one call. Resolves to the
 * answer; never rejects (a failure to ask is a `cancel`).
 */
export type McpActionConfirmationElicitor = (subject: McpActionConfirmationSubject) => Promise<McpActionConfirmationAnswer>;

/**
 * What the action tools hand the bridge beside the request: the door's own
 * channel for this call, never anything the caller sent. Passed only when the
 * call can be elicited; a bridge reads its absence as "hand off".
 */
export interface McpActionCallDoor {
  /** Ask the person in their client (step 1); see {@link actionConfirmationElicitorFor}. */
  elicitConfirmation: McpActionConfirmationElicitor;
}

/**
 * The result shape this door reads: `action` and nothing else. Loose on
 * purpose, unlike the SDK's own `ElicitResultSchema`, which also parses
 * `content` — a client's form payload is not read (step 3.1), so a payload the
 * SDK would refuse must not turn a person's `accept` into a failure.
 */
const ElicitedActionSchema = z.looseObject({ action: z.enum(['accept', 'decline', 'cancel']) });

/** A confirmation asks for nothing but the answer: an empty form. */
const EMPTY_FORM = { type: 'object', properties: {} } as const;

/** The longest free text (a label, a record title) the question carries, in characters. */
export const ACTION_CONFIRMATION_QUESTION_TEXT_MAX = 80;
/** The longest machine name or record id the question carries, in characters. */
export const ACTION_CONFIRMATION_QUESTION_ID_MAX = 200;

/**
 * Characters that never reach the person's prompt as themselves: C0 and C1
 * controls (line breaks and tabs included), the Unicode line and paragraph
 * separators, and the invisible format characters that reorder or hide text
 * (bidirectional controls, zero-width characters, the byte-order mark).
 */
const UNSHOWN = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/gu;
/** Markup and quoting characters a client might render or a reader might take as structure. */
const MARKUP = /[<>`*_[\]{}|#"\\]/gu;

/** At most `max` characters (code points), with a visible mark when it was cut. */
function bounded(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join('')}…`;
}

/**
 * Free text written by an author or stored on a record (an action label, a
 * record title), made safe for one labelled line of the question: every
 * unshown character becomes a space, markup characters and double quotes are
 * dropped, a single quote becomes a typographic apostrophe, runs of spaces collapse, and the result is bounded. `undefined`
 * when nothing readable is left.
 */
export function confirmationQuestionText(text: string | undefined): string | undefined {
  if (typeof text !== 'string') return undefined;
  const plain = text.replace(UNSHOWN, ' ').replace(MARKUP, '').replace(/'/gu, '\u2019').replace(/\s+/gu, ' ').trim();
  return plain === '' ? undefined : bounded(plain, ACTION_CONFIRMATION_QUESTION_TEXT_MAX);
}

/**
 * A machine name or record id for its own labelled line: kept character for
 * character so it still names exactly one record, except that an unshown
 * character is shown as U+FFFD, and bounded.
 */
function confirmationQuestionId(id: string): string {
  return bounded(id.replace(UNSHOWN, '\ufffd'), ACTION_CONFIRMATION_QUESTION_ID_MAX);
}

/**
 * The question the person reads: the action, the object and the record it
 * runs on (its id, and its title when the subject load read one), and what
 * each answer does.
 *
 * One fact per labelled line, in a fixed order, the record id BEFORE the
 * title: every value is reduced to a single line first (no value can start a
 * line of its own), so the id line is always the one this door wrote, and a
 * title cannot pose as another record's id or as the end of the question.
 */
export function actionConfirmationQuestion(subject: McpActionConfirmationSubject): string {
  const name = confirmationQuestionId(subject.actionName);
  const label = confirmationQuestionText(subject.actionLabel);
  const title = subject.recordId !== undefined ? confirmationQuestionText(subject.recordTitle) : undefined;
  const lines = [
    'Your AI assistant asks to run an action whose author requires your confirmation. Nothing has run yet.',
    `Action: ${label && label !== name ? `${label} (${name})` : name}`,
    ...(subject.objectName ? [`Object: ${confirmationQuestionId(subject.objectName)}`] : []),
    ...(subject.recordId !== undefined ? [`Record id: ${confirmationQuestionId(subject.recordId)}`] : []),
    ...(title !== undefined ? [`Record title: ${title}`] : []),
    'Accept runs it once, as you. Decline refuses it.',
  ];
  return lines.join('\n');
}

/**
 * The elicitor for the tool call `extra` belongs to, or `undefined` when this
 * call cannot be elicited: the client did not advertise form-mode
 * `elicitation` at `initialize` on this server (an empty `elicitation: {}`
 * reads as form mode, MCP 2025-11-25, normalised by the SDK), which is always
 * the case on the per-request Streamable HTTP server.
 *
 * The request rides the tool call (`extra.sendRequest` relates it to the open
 * call), is bounded by `timeoutMs`, and is abandoned when the tool call is
 * cancelled (`extra.signal`).
 */
export function actionConfirmationElicitorFor(
  server: McpServer,
  extra: RequestHandlerExtra<ServerRequest, ServerNotification> | undefined,
  timeoutMs: number = ACTION_CONFIRMATION_ELICITATION_TIMEOUT_MS,
): McpActionConfirmationElicitor | undefined {
  const capability = server.server.getClientCapabilities()?.[AI_ACTION_CONFIRMATION_CAPABILITY];
  if (!capability?.form || typeof extra?.sendRequest !== 'function') return undefined;
  return async (subject) => {
    try {
      const result = await extra.sendRequest(
        {
          method: 'elicitation/create',
          params: { mode: 'form', message: actionConfirmationQuestion(subject), requestedSchema: EMPTY_FORM },
        },
        ElicitedActionSchema,
        { timeout: timeoutMs, signal: extra.signal },
      );
      return result.action;
    } catch (error) {
      // Asked first: the SDK rejects an ABORTED request with a
      // `RequestTimeout` error too, and the call's signal aborts both when
      // the client cancels the tool call and when the connection closes.
      if (extra.signal?.aborted) return 'cancel';
      return error instanceof McpError && error.code === ErrorCode.RequestTimeout ? 'timed_out' : 'cancel';
    }
  };
}
