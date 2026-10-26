/**
 * Observability primitives — Sentry integration.
 *
 * All exports are no-op safe when the runtime served no DSN. See sentry.ts —
 * the sink and its knobs arrive on `/api/v1/runtime/config`, not from
 * build-time env vars (objectstack#12681).
 *
 * @module
 */

export { initSentry, captureError, setSentryUser, getSentry } from './sentry.js';
export {
  beginRequest,
  endRequest,
  getPendingRequests,
  isIdle,
  subscribeSettle,
  whenIdle,
  withSettleSignal,
  installSettleSignalGlobal,
  type ObjectUiGlobal,
} from './settleSignal.js';
