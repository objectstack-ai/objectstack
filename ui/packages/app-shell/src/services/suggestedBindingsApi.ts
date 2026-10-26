// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Suggested audience bindings (ADR-0090 D5/D9) — client for the framework's
 * `/api/v1/security/suggested-bindings` surface.
 *
 * A package permission set declaring `isDefault: true` is an install-time
 * SUGGESTION to give the set to the built-in `everyone` position (default
 * grants for authenticated users). The server never auto-binds: a caller
 * holding `manage_metadata` (under a wall, the platform operator) accepts or
 * dismisses each suggestion ONCE for the whole deployment, and an accept takes
 * effect — the server re-derives `everyone`'s definition with the set
 * (objectstack#22801 → A, built by objectstack#22854). A caller without that
 * authority gets `403 PERMISSION_DENIED` on all three routes, the list
 * included. These calls are ordinary same-origin admin API calls (not object
 * CRUD), so they follow the marketplaceApi raw-fetch pattern: Bearer token +
 * `credentials: 'include'`.
 */

import { TokenStorage } from '@object-ui/auth';

const SERVER_URL = (import.meta.env.VITE_SERVER_URL || '').replace(/\/$/, '');
const API_BASE = `${SERVER_URL}/api/v1/security/suggested-bindings`;

export interface SuggestedBinding {
  id: string;
  package_id: string;
  permission_set_name: string;
  anchor: 'everyone' | 'guest';
  status: 'pending' | 'confirmed' | 'dismissed';
  /**
   * `true` when a `manage_metadata` holder's accept or dismiss resolved the
   * row (`sys_audience_binding_suggestion.deployment_decision`). It is what
   * the server itself branches on: a `confirmed` row WITH it is an
   * acceptance, which a dismiss revokes; a `confirmed` row WITHOUT it is one
   * the deployment's baseline already names, which the server observed and
   * refuses to dismiss (`409`).
   */
  deployment_decision?: boolean;
  resolved_by?: string | null;
  resolved_at?: string | null;
  created_at?: string;
}

/** What an accept answers: the row as written, and whether it took effect. */
export interface SuggestedBindingAcceptance {
  suggestion: SuggestedBinding;
  /**
   * `true` when the `everyone` definition names the set now and did not
   * before this request. `false` on a `200` means the acceptance was RECORDED
   * but the definition did not change on this request — the set was already
   * named, or the derivation withheld it and the server logged why — so the
   * caller must not report it as granted.
   */
  bindingCreated: boolean;
}

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json', ...extra };
  const token = TokenStorage.get();
  return token ? { ...headers, Authorization: `Bearer ${token}` } : headers;
}

async function parseOrThrow(res: Response): Promise<any> {
  let payload: any = null;
  try { payload = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    const code = payload?.error?.code ?? `HTTP_${res.status}`;
    const message = payload?.error?.message ?? payload?.error ?? res.statusText;
    const err = new Error(typeof message === 'string' ? message : String(code));
    (err as any).code = code;
    (err as any).status = res.status;
    throw err;
  }
  return payload?.data ?? payload;
}

/**
 * List suggestions. The server reconciles first (declared `isDefault` sets →
 * pending rows), so calling this right after an install already sees the
 * new package's suggestions. Requires `manage_metadata`; any other caller
 * gets a 403 the UI treats as "surface hidden".
 */
export async function listSuggestedBindings(filter: {
  status?: 'pending' | 'confirmed' | 'dismissed';
  packageId?: string;
} = {}): Promise<SuggestedBinding[]> {
  const params = new URLSearchParams();
  if (filter.status) params.set('status', filter.status);
  if (filter.packageId) params.set('packageId', filter.packageId);
  const qs = params.toString();
  const res = await fetch(`${API_BASE}${qs ? `?${qs}` : ''}`, {
    credentials: 'include',
    headers: authHeaders(),
  });
  const data = await parseOrThrow(res);
  return Array.isArray(data?.suggestions) ? data.suggestions : [];
}

/**
 * Accept a pending suggestion for the deployment — the server re-derives the
 * `everyone` definition with the set, under the ADR-0090 gates (a
 * high-privilege set is refused with a 403 whose message explains the
 * offending bits; a `guest` row is refused with a 409; surface either
 * verbatim). `bindingCreated` is returned, never dropped: it is the only
 * signal that tells an acceptance in force from one merely recorded.
 */
export async function confirmSuggestedBinding(id: string): Promise<SuggestedBindingAcceptance> {
  const res = await fetch(`${API_BASE}/${encodeURIComponent(id)}/confirm`, {
    method: 'POST',
    credentials: 'include',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
  });
  const data = await parseOrThrow(res);
  return { suggestion: data?.suggestion as SuggestedBinding, bindingCreated: data?.bindingCreated === true };
}

/**
 * Dismiss a pending suggestion, or REVOKE an accepted one — the same call: on
 * a row a `manage_metadata` holder accepted, the server re-derives `everyone`
 * without the set. A row the baseline names is refused with a 409.
 */
export async function dismissSuggestedBinding(id: string): Promise<SuggestedBinding> {
  const res = await fetch(`${API_BASE}/${encodeURIComponent(id)}/dismiss`, {
    method: 'POST',
    credentials: 'include',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
  });
  const data = await parseOrThrow(res);
  return data?.suggestion as SuggestedBinding;
}
