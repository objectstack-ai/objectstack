/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * ADR-0069 — client side of the authentication-policy session gate.
 *
 * The ObjectStack backend returns `403 { error: { code: 'MFA_REQUIRED' |
 * 'PASSWORD_EXPIRED' | 'PASSWORD_RESET_REQUIRED', message } }` from protected
 * endpoints when a logged-in user must remediate. `PASSWORD_RESET_REQUIRED` is
 * an administrator-forced password change, distinct on the wire from natural
 * expiry (objectstack#23287 ruling C′). The authenticated fetch wrapper detects this on EVERY
 * API response and emits it here; `AuthProvider` subscribes and raises a
 * full-screen remediation overlay. Decoupling via a tiny module-level emitter
 * keeps the plain fetch wrapper free of React.
 */

/** A triggered auth-policy gate the user must clear before continuing. */
export interface AuthGateInfo {
  /** Stable machine code: one of the codes `detectAuthGate` recognises. */
  code: 'MFA_REQUIRED' | 'PASSWORD_EXPIRED' | 'PASSWORD_RESET_REQUIRED' | string;
  /** Human-facing message from the server (may be empty). */
  message: string;
}

/**
 * The auth-policy codes the backend raises as a remediation gate. Hand-written:
 * the spec vocabulary (`AuthGateCodeSchema`) is not in the `@objectstack/spec`
 * this package builds against yet; derive from it once it is.
 */
const AUTH_GATE_CODES: ReadonlySet<unknown> = new Set([
  'MFA_REQUIRED',
  'PASSWORD_EXPIRED',
  'PASSWORD_RESET_REQUIRED',
]);

type Listener = (gate: AuthGateInfo) => void;
const listeners = new Set<Listener>();

export const authGateEvents = {
  /** Broadcast a gate to all subscribers (the active AuthProvider). */
  emit(gate: AuthGateInfo): void {
    for (const l of Array.from(listeners)) {
      try { l(gate); } catch { /* a listener throwing must not break others */ }
    }
  },
  /** Subscribe; returns an unsubscribe fn. */
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
};

/**
 * Returns the gate when `status`/`body` is a recognised auth-policy block,
 * else null. Tolerant of non-gate 403s (permission denials etc.).
 */
export function detectAuthGate(status: number, body: unknown): AuthGateInfo | null {
  if (status !== 403 || !body || typeof body !== 'object') return null;
  const err = (body as Record<string, unknown>).error;
  if (!err || typeof err !== 'object') return null;
  const code = (err as Record<string, unknown>).code;
  if (typeof code === 'string' && AUTH_GATE_CODES.has(code)) {
    const message = (err as Record<string, unknown>).message;
    return { code, message: typeof message === 'string' ? message : '' };
  }
  return null;
}
