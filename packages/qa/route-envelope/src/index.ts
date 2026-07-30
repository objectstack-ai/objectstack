// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// @objectstack/route-envelope-conformance — public API.
//
// One shared guard for the response envelope every REST route is declared to
// emit (`BaseResponseSchema`, `packages/spec/src/api/contract.zod.ts`). Lifted
// out of the three hand-rolled copies #3675 / #3689 left behind in
// `service-storage` and `service-i18n` (#3843 option 3).
//
// Pure and dependency-free by design: source text in, findings out. Callers
// supply the source and assert `toEqual([])`, the same contract the ADR-0060
// helpers in `@objectstack/verify` use.

export { checkRouteEnvelope } from './check-route-envelope.js';
export type {
  CheckRouteEnvelopeOptions,
  EnvelopeFinding,
  EnvelopeRule,
} from './check-route-envelope.js';

// Exported for the rare caller that needs the same comment/literal stripping
// before running a scan of its own.
export { stripNonCode } from './strip-non-code.js';
