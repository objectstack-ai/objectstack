// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Connector } from '@objectstack/spec/integration';

/**
 * Slack connector — a *concrete* connector (ADR-0018 §Addendum) and the second
 * reference implementation after `@objectstack/connector-rest`. It produces a
 * {@link Connector} definition plus handlers for a small set of Slack Web API
 * actions, which the baseline `connector_action` node dispatches to.
 *
 * Scope (ADR-0022 "raw API call" path): this is the *integration mechanism*
 * for talking to Slack's API — "post this exact text to this channel". It is
 * deliberately **not** the human-notification layer: there is no preference
 * matrix, inbox, outbox, or thread/session semantics here. Those belong to a
 * `MessagingChannel` (ADR-0012/0013), which may itself delegate its transport
 * to this connector.
 *
 * Open-source scope: **static** auth only — a Slack **bot token** (`xoxb-…`),
 * supplied by the caller and sent as a bearer credential. OAuth2 install/refresh,
 * credential vaulting, and multi-tenant connection lifecycle are the enterprise
 * tier (see `../cloud/docs/design/connector-tiering.md`) and are out of scope.
 *
 * Slack quirk: the Web API returns HTTP `200` even on logical failure, with the
 * real outcome in the JSON body's `ok` field (and `error` on failure). Handlers
 * therefore surface `ok` from the payload, not from the HTTP status, and never
 * throw on a logical failure — the flow author branches on `${node.ok}`.
 */

export interface SlackConnectorOptions {
    /** Connector machine name (snake_case). Defaults to `slack`. */
    name?: string;
    /** Human-readable label. Defaults to `Slack`. */
    label?: string;
    /** Slack bot token (`xoxb-…`), sent as `Authorization: Bearer <token>`. */
    token: string;
    /** Web API base URL. Defaults to `https://slack.com/api`. */
    baseUrl?: string;
    /** Headers merged into every request (request-level headers win). */
    defaultHeaders?: Record<string, string>;
    /** Injected for tests; defaults to the global `fetch`. */
    fetchImpl?: typeof fetch;
}

/** Input accepted by `chat.postMessage`. */
export interface SlackPostMessageInput {
    /** Channel id (`C…`), user id (`U…`), or channel name (`#general`). */
    channel: string;
    /** Message text (fallback when `blocks` are present). */
    text?: string;
    /** Thread root `ts` to reply into an existing thread. */
    thread_ts?: string;
    /** Block Kit blocks. */
    blocks?: unknown[];
    [key: string]: unknown;
}

/** Generic Slack Web API result envelope. */
export interface SlackResult {
    /** Slack's logical success flag (from the JSON body, not the HTTP status). */
    ok: boolean;
    /** HTTP status (almost always 200 for the Slack Web API). */
    status: number;
    /** Full parsed Slack payload. */
    body: Record<string, unknown>;
    /** Slack error code when `ok` is false (e.g. `channel_not_found`). */
    error?: string;
}

/** A connector definition paired with its action handlers, ready for registerConnector(). */
export interface SlackConnectorBundle {
    def: Connector;
    handlers: Record<
        string,
        (input: Record<string, unknown>, ctx: unknown) => Promise<Record<string, unknown>>
    >;
}

export function createSlackConnector(opts: SlackConnectorOptions): SlackConnectorBundle {
    const name = opts.name ?? 'slack';
    const baseUrl = (opts.baseUrl ?? 'https://slack.com/api').replace(/\/+$/, '');
    const doFetch = opts.fetchImpl ?? fetch;

    const def: Connector = {
        name,
        label: opts.label ?? 'Slack',
        type: 'api',
        description: 'Slack Web API connector (static bot-token auth). Post and update messages, or call any Web API method.',
        icon: 'slack',
        authentication: { type: 'bearer', token: opts.token },
        // Defaulted by ConnectorSchema; set explicitly so the literal satisfies
        // the (post-parse) Connector output type.
        status: 'active',
        enabled: true,
        connectionTimeoutMs: 30000,
        requestTimeoutMs: 30000,
        actions: [
            {
                key: 'chat.postMessage',
                label: 'Post Message',
                description: 'Post a message to a channel, DM, or thread (Slack chat.postMessage).',
                inputSchema: {
                    type: 'object',
                    required: ['channel'],
                    properties: {
                        channel: { type: 'string', description: 'Channel id, user id, or #name' },
                        text: { type: 'string', description: 'Message text' },
                        thread_ts: { type: 'string', description: 'Thread root ts to reply into' },
                        blocks: { type: 'array', description: 'Block Kit blocks' },
                    },
                },
                outputSchema: slackOutputSchema(),
            },
            {
                key: 'chat.update',
                label: 'Update Message',
                description: 'Edit an existing message (Slack chat.update).',
                inputSchema: {
                    type: 'object',
                    required: ['channel', 'ts'],
                    properties: {
                        channel: { type: 'string', description: 'Channel id' },
                        ts: { type: 'string', description: 'Timestamp of the message to update' },
                        text: { type: 'string', description: 'New message text' },
                        blocks: { type: 'array', description: 'New Block Kit blocks' },
                    },
                },
                outputSchema: slackOutputSchema(),
            },
            {
                key: 'call',
                label: 'Call Web API Method',
                description: 'Escape hatch — call any Slack Web API method with arbitrary params.',
                inputSchema: {
                    type: 'object',
                    required: ['method'],
                    properties: {
                        method: { type: 'string', description: 'Web API method, e.g. conversations.list' },
                        params: { type: 'object', description: 'Method parameters (JSON body)' },
                    },
                },
                outputSchema: slackOutputSchema(),
            },
        ],
    };

    /** POST a JSON body to a Slack Web API method and normalise the result. */
    async function callSlack(method: string, params: Record<string, unknown>): Promise<SlackResult> {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json; charset=utf-8',
            ...opts.defaultHeaders,
            Authorization: `Bearer ${opts.token}`,
        };

        const response = await doFetch(`${baseUrl}/${method}`, {
            method: 'POST',
            headers,
            body: JSON.stringify(params),
        });

        // The Slack Web API always answers with JSON; `ok` is the real outcome.
        const body = (await response.json()) as Record<string, unknown>;
        const ok = body.ok === true;
        return {
            ok,
            status: response.status,
            body,
            error: ok ? undefined : (body.error as string | undefined),
        };
    }

    async function postMessage(input: Record<string, unknown>): Promise<Record<string, unknown>> {
        return toRecord(await callSlack('chat.postMessage', input));
    }

    async function update(input: Record<string, unknown>): Promise<Record<string, unknown>> {
        return toRecord(await callSlack('chat.update', input));
    }

    async function call(input: Record<string, unknown>): Promise<Record<string, unknown>> {
        const method = String(input.method ?? '');
        if (!method) throw new Error("slack 'call' action: 'method' is required");
        const params = (input.params as Record<string, unknown>) ?? {};
        return toRecord(await callSlack(method, params));
    }

    return {
        def,
        handlers: {
            'chat.postMessage': postMessage,
            'chat.update': update,
            call,
        },
    };
}

function toRecord(r: SlackResult): Record<string, unknown> {
    return { ok: r.ok, status: r.status, body: r.body, error: r.error };
}

function slackOutputSchema(): Record<string, unknown> {
    return {
        type: 'object',
        properties: {
            ok: { type: 'boolean', description: "Slack's logical success flag" },
            status: { type: 'number', description: 'HTTP status' },
            body: { type: 'object', description: 'Full Slack response payload' },
            error: { type: 'string', description: 'Slack error code when ok is false' },
        },
    };
}
