// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The connector connection door, as the console reads and drives it — Setup →
 * Integrations → Connector Connections (ADR-0143 D5, item 7 of
 * objectstack#26702). An organization administrator connects an `oauth2`
 * `authorization_code` connector instance once; the platform refreshes the
 * grant per dispatch, and this page shows where each connection stands.
 *
 * Four routes, all asking the organization-scoped `manage_connector_connections`:
 *
 *   GET    /api/v1/automation/connectors/:name/connection   the status
 *   POST   /api/v1/automation/connectors/:name/connection   begin a connect
 *   DELETE /api/v1/automation/connectors/:name/connection   disconnect
 *   GET    /api/v1/automation/connectors/oauth/callback     the vendor's redirect
 *
 * The console never calls the callback: the vendor sends the administrator's
 * browser there. Which instances need a connection is read from their
 * declaration (`GET /meta/connector`: `auth.type: 'oauth2'` with
 * `grant: 'authorization_code'`), and each instance's registry state from
 * `GET /automation/connectors`.
 *
 * ⛔ No token crosses this module: every answer is a `ConnectorConnectionState`,
 * which carries a status, its reason, scopes and dates. The begin leg's
 * `authorizationUrl` carries the `state` and PKCE challenge the server minted;
 * it is handed to the sign-in window and nothing else — never rendered,
 * logged or rebuilt here.
 */

import type { ConnectorConnectionState } from '@objectstack/spec/contracts';
import type { ConnectorDescriptor } from '@objectstack/spec/integration';
import { actionErrorDetail } from '@object-ui/core';
import { apiBase } from '../../utils/apiBase.js';
import { componentRefToUrlSegments } from '../../services/componentRegistry.js';
import { readMetadataItems } from './packagedFlows.js';

/**
 * The console component a Setup entry names. The entry is the automation
 * service's to contribute, gated on `manage_connector_connections`.
 */
export const CONNECTOR_CONNECTIONS_REF = 'automation:connector-connections';

/** Where the page opens inside the Setup app. */
export function connectorConnectionsPagePath(): string {
  return `/apps/setup/component/${componentRefToUrlSegments(CONNECTOR_CONNECTIONS_REF).join('/')}`;
}

/** A declared instance an administrator connects. */
export interface ConnectableInstance {
  name: string;
  label: string;
}

/** A refusal, in the server's own words: rendered, never parsed. */
export interface DoorRefusal {
  status: number;
  message: string;
}

export type ConnectionRead =
  | { ok: true; state: ConnectorConnectionState }
  | ({ ok: false } & DoorRefusal);

export type ConnectionBegin =
  | { ok: true; authorizationUrl: string; expiresAt: string }
  | ({ ok: false } & DoorRefusal);

/** One row of the page: the instance, its registry state, and this organization's connection. */
export interface ConnectionRow {
  instance: ConnectableInstance;
  descriptor?: Pick<ConnectorDescriptor, 'state' | 'degradedReason'>;
  connection: ConnectionRead;
}

export type ConnectionListing =
  | { kind: 'listed'; rows: ConnectionRow[] }
  | { kind: 'failed'; message: string };

const JSON_HEADERS = { Accept: 'application/json' } as const;
const STATUSES = new Set(['not_connected', 'connected', 'reconnect_required']);

function dataOf(payload: unknown): Record<string, unknown> | undefined {
  const data = (payload as { data?: unknown } | null | undefined)?.data;
  return data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : undefined;
}

function refused(payload: unknown): boolean {
  return (payload as { success?: unknown } | null | undefined)?.success === false;
}

function isOk(status: number, payload: unknown): boolean {
  return status >= 200 && status < 300 && !refused(payload);
}

/**
 * The declared instances an administrator connects, out of a `/meta/connector`
 * list: provider-bound, `oauth2`, `grant: 'authorization_code'`. The other
 * grants mint their own tokens and need no one to connect them.
 */
export function readConnectableInstances(payload: unknown): ConnectableInstance[] {
  const out: ConnectableInstance[] = [];
  for (const item of readMetadataItems(payload)) {
    const i = item as { name?: unknown; label?: unknown; provider?: unknown; auth?: { type?: unknown; grant?: unknown } } | null;
    if (typeof i?.name !== 'string' || i.name.length === 0 || typeof i.provider !== 'string') continue;
    if (i.auth?.type !== 'oauth2' || i.auth.grant !== 'authorization_code') continue;
    out.push({ name: i.name, label: typeof i.label === 'string' && i.label.length > 0 ? i.label : i.name });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** A status read's (or a disconnect's) conclusion from its status and body. */
export function readConnectionState(status: number, payload: unknown): ConnectionRead {
  if (isOk(status, payload)) {
    const state = dataOf(payload) as ConnectorConnectionState | undefined;
    if (typeof state?.connector === 'string' && STATUSES.has(state.status as string)) return { ok: true, state };
    return { ok: false, status, message: 'The connection door answered without a connection status.' };
  }
  return { ok: false, status, message: actionErrorDetail(payload, `HTTP ${status}`) };
}

/**
 * The begin leg's conclusion. Only an `http(s)` authorization URL is accepted:
 * it is the one value that navigates a window.
 */
export function readConnectionBegin(status: number, payload: unknown): ConnectionBegin {
  if (!isOk(status, payload)) return { ok: false, status, message: actionErrorDetail(payload, `HTTP ${status}`) };
  const data = dataOf(payload);
  const url = data?.authorizationUrl;
  let protocol: string | undefined;
  try {
    protocol = typeof url === 'string' ? new URL(url).protocol : undefined;
  } catch {
    protocol = undefined;
  }
  if (protocol !== 'https:' && protocol !== 'http:') {
    return { ok: false, status, message: 'The connection door answered without an authorization URL to open.' };
  }
  return { ok: true, authorizationUrl: url as string, expiresAt: typeof data?.expiresAt === 'string' ? data.expiresAt : '' };
}

function connectionUrl(name: string): string {
  return `${apiBase()}/automation/connectors/${encodeURIComponent(name)}/connection`;
}

async function bodyOf(res: Response): Promise<unknown> {
  return res.json().catch(() => null);
}

async function call(url: string, init: RequestInit): Promise<{ status: number; body: unknown }> {
  try {
    const res = await fetch(url, { credentials: 'include', headers: JSON_HEADERS, cache: 'no-store', ...init });
    return { status: res.status, body: await bodyOf(res) };
  } catch (err) {
    if ((err as { name?: unknown })?.name === 'AbortError') throw err;
    return { status: 0, body: { success: false, error: { message: (err as Error)?.message ?? String(err) } } };
  }
}

/** `GET …/:name/connection`. */
export async function fetchConnection(name: string, signal?: AbortSignal): Promise<ConnectionRead> {
  const { status, body } = await call(connectionUrl(name), { signal });
  return readConnectionState(status, body);
}

/** `POST …/:name/connection` — no body. */
export async function beginConnection(name: string): Promise<ConnectionBegin> {
  const { status, body } = await call(connectionUrl(name), { method: 'POST' });
  return readConnectionBegin(status, body);
}

/** `DELETE …/:name/connection`. */
export async function revokeConnection(name: string): Promise<ConnectionRead> {
  const { status, body } = await call(connectionUrl(name), { method: 'DELETE' });
  return readConnectionState(status, body);
}

/**
 * Every connectable instance with its registry state and this organization's
 * connection. The declaration read failing is a failure; the descriptor list
 * failing only leaves the registry state out.
 */
export async function fetchConnectionListing(signal?: AbortSignal): Promise<ConnectionListing> {
  const meta = await call(`${apiBase()}/meta/connector`, { signal });
  if (meta.status < 200 || meta.status >= 300 || refused(meta.body)) {
    return { kind: 'failed', message: actionErrorDetail(meta.body, `HTTP ${meta.status}`) };
  }
  const instances = readConnectableInstances(meta.body);
  if (instances.length === 0) return { kind: 'listed', rows: [] };
  const registry = await call(`${apiBase()}/automation/connectors`, { signal });
  const listed = isOk(registry.status, registry.body) ? dataOf(registry.body)?.connectors : undefined;
  const descriptors = new Map<string, ConnectorDescriptor>(
    (Array.isArray(listed) ? (listed as ConnectorDescriptor[]) : []).map((d) => [d.name, d]),
  );
  const rows = await Promise.all(
    instances.map(async (instance): Promise<ConnectionRow> => {
      const d = descriptors.get(instance.name);
      return {
        instance,
        ...(d ? { descriptor: { state: d.state, ...(d.degradedReason ? { degradedReason: d.degradedReason } : {}) } } : {}),
        connection: await fetchConnection(instance.name, signal),
      };
    }),
  );
  return { kind: 'listed', rows };
}
