// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Run a piece of a request's work after the request has answered.
 *
 * ## Why
 *
 * A reset request answers the same way for any address, answers at once and
 * does not wait on the send. So on the public door the reset mail — its
 * template, its `sys_identity_email` row, its transport — is built and sent
 * after the response, never inside it
 * (`auth-manager-auth-instance.ts`, `sendResetPassword`), and what the send
 * does is the server's to log, never the caller's to see — which it already
 * never was: better-auth answers `{ status: true }` whatever the send does.
 *
 * ## How
 *
 * The task is scheduled with `setImmediate` and never awaited: the request's
 * own promise chain settles without it, and the task starts once the current
 * turn of the event loop — the rest of the request's answer — has run. This is
 * the shape the platform already uses for work a refusal must not wait on
 * (`createRefusedAttachTombstoner` in `@objectstack/service-storage`). The task
 * runs in the async context it was scheduled from, so it reads the same request
 * state as it would have inline.
 *
 * Nothing is retried and nothing is queued durably: a process that stops before
 * the task runs loses it, as a process that stopped mid-request lost an inline
 * send. A task that throws or rejects is handed to `onFailure`, and an
 * `onFailure` that throws is swallowed — a log line can never become an
 * unhandled rejection.
 */
export function runAfterResponse(task: () => Promise<unknown>, onFailure: (error: unknown) => void): void {
  setImmediate(() => {
    Promise.resolve()
      .then(task)
      .catch((error: unknown) => {
        try {
          onFailure(error);
        } catch {
          // The failure report is best-effort by construction.
        }
      });
  });
}

/**
 * Wrap a better-auth mail callback — called as `(data, request)` — so that a
 * call carrying its `Request` (every HTTP request: the public door) resolves at
 * once and the send runs after the response ({@link runAfterResponse}), its
 * failure going to `onFailure`. A call without one (a server-side `auth.api.*`
 * call, such as the identity import's) is handed straight to `send` — the same
 * promise — and awaited by its caller exactly as before.
 */
export function sendAfterResponseOnPublicDoor<D>(
  send: (data: D, request?: unknown) => Promise<unknown>,
  onFailure: (error: unknown) => void,
): (data: D, request?: unknown) => Promise<void> {
  return (data, request) => {
    if (request === undefined || request === null) return send(data, request) as Promise<void>;
    runAfterResponse(() => send(data, request), onFailure);
    return Promise.resolve();
  };
}

/**
 * The host logger's shape (`AuthManagerOptions.logger`): `warn` is the channel
 * every host logger guarantees, `error` the one it may carry.
 */
type FailureLogger = {
  error?: (message: string, meta?: unknown) => void;
  warn: (message: string, meta?: unknown) => void;
};

/**
 * The server-side record of a send that ran after the response and failed:
 * `error` when the host logger carries it, else its guaranteed `warn`, else —
 * no host logger at all — the console: the level better-auth's own
 * background-task log used for the same failure while the send ran inside the
 * request. `what` names the send, its medium included (`password-reset
 * email`, `phone password-reset text`). Called through the property, never an
 * extracted reference (a class-based logger needs its receiver).
 */
export function logAfterResponseSendFailure(logger: unknown, what: string, error: unknown): void {
  const message = `[AuthManager] ${what} was not delivered: ${
    error instanceof Error ? error.message : String(error)
  }`;
  const sink = logger as FailureLogger | undefined;
  if (sink?.error) sink.error(message);
  else if (sink?.warn) sink.warn(message);
  else console.error(message);
}
