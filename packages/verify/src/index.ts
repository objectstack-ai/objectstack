// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// @objectstack/verify — public API.
//
// Boot any ObjectStack app in-process and verify it through the real HTTP
// stack. Two proof families, both app-agnostic (derived from your metadata):
//   - data fidelity   : runCrudVerification — author → write → read → assert
//   - authorization   : runRlsProofs        — "you can't write what you can't read"

export { bootStack } from './harness.js';
export type { VerifyStack, BootOptions } from './harness.js';

export { deriveCrudCases, fillRelationalRefs } from './derive.js';
export type { CrudCase, DerivedAssert, AssertKind, RelationalRef } from './derive.js';

export { runCrudVerification, formatReport } from './verify.js';
export type { VerifyReport, ObjectVerifyResult } from './verify.js';

export {
  runRlsProofs,
  formatRlsReport,
  provisionRlsProbePersona,
  provisionRlsPositionPersona,
  declaredPositionNames,
  rlsProbePermissionSet,
  rlsProbeSecurity,
  rlsPositionProbeEmail,
  RLS_PROBE_EMAIL,
} from './rls.js';
export type {
  RlsReport,
  RlsResult,
  RlsStatus,
  RlsSummary,
  RlsProbeDescriptor,
  RlsProbePersona,
  RlsPositionPersona,
  RlsPositionPersonaInput,
  RlsPositionRun,
  RlsPositionCoverage,
  RlsProofOptions,
} from './rls.js';

// ADR-0060 — reusable conformance-ledger helper (static complement to the
// runtime harness): classify every declarable property, fail closed on drift.
export { checkLedger } from './conformance.js';
export type { ConformanceRow, ConformanceState, CheckLedgerOptions } from './conformance.js';

// Driver read-coercion conformance: a stored value must read back as its
// declared type on every driver (the case_escalation `1 != true` invariant).
// Driver-agnostic — any driver, including out-of-tree ones, runs the same check.
export { checkReadCoercion } from './read-coercion.js';
export type { CoercibleDriver, ReadCoercionOptions } from './read-coercion.js';

// Date-bucket parity conformance: a granularity a driver ADVERTISES must bucket
// identically whether the engine pushes it down as SQL or falls back to
// `applyInMemoryAggregation`. The seam #3773 crossed silently.
export { checkDateBucketParity } from './date-bucket-parity.js';
export type { BucketableDriver, DateBucketParityOptions } from './date-bucket-parity.js';
