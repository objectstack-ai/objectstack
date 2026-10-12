// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// @objectstack/verify — public API.
//
// Boot any ObjectStack app in-process and verify it through the real HTTP
// stack. Four proof families, all app-agnostic (derived from your metadata):
//   - data fidelity   : runCrudVerification     — author → write → read → assert
//   - authorization   : runRlsProofs            — "you can't write what you can't read"
//   - value shape     : runReferenceShapeProofs — "a reference refuses a value that is not a record id"
//   - delete behaviour: runDeleteBehaviorProofs — "a declared deleteBehavior is what a delete does"

export { bootStack, bootStackOnce } from './harness.js';
export type { VerifyStack, BootOptions } from './harness.js';

// The in-process handle on the booted stack (hotcrm#1579 step 5a): every
// `VerifyStack` carries it; these are its types and its one predicate.
export { isVerifyRefusal } from './handle.js';
export type {
  VerifyHandle,
  VerifyRefusal,
  AsUser,
  AsSystem,
  FlowRun,
  FlowRunRef,
  EngineRow,
  ObservedWrite,
  ObservedWriteOutcome,
  WriteObservation,
} from './handle.js';

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

// ADR-0104 D1 — the reference-value shape family: every client-writable
// reference field refuses a value its declared stored shape refuses, asked of
// the engine through the REST door and the system door.
export {
  deriveReferenceShapeCases,
  referenceShapeProbeValue,
  runReferenceShapeProofs,
  formatReferenceShapeReport,
  REFERENCE_SHAPE_PROBE_ID,
} from './reference-shape.js';
export type {
  ReferenceShapeCase,
  ReferenceShapeDoor,
  ReferenceShapeOperation,
  ReferenceShapeProbeKind,
  ReferenceShapeProbeResult,
  ReferenceShapeFieldStatus,
  ReferenceShapeFieldResult,
  ReferenceShapeReport,
  ReferenceShapeProofOptions,
} from './reference-shape.js';

// The delete-behaviour family: every `deleteBehavior` a reference field
// declares is what a by-id delete of the referenced record does, asked of the
// engine through the REST door and the system door.
export {
  deriveDeleteBehaviorCases,
  runDeleteBehaviorProofs,
  formatDeleteBehaviorReport,
} from './delete-behavior.js';
export type {
  DeclaredDeleteBehavior,
  DeleteBehaviorCase,
  DeleteBehaviorDoor,
  DeleteBehaviorAnswer,
  DeleteBehaviorProbeResult,
  DeleteBehaviorFieldStatus,
  DeleteBehaviorFieldResult,
  DeleteBehaviorReport,
  DeleteBehaviorProofOptions,
} from './delete-behavior.js';

// ADR-0060 — reusable conformance-ledger helper (static complement to the
// runtime harness): classify every declarable property, fail closed on drift.
export { checkLedger } from './conformance.js';
export type {
  ConformanceRow,
  ConformanceState,
  CheckLedgerOptions,
  ProofAttributionOptions,
} from './conformance.js';

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
