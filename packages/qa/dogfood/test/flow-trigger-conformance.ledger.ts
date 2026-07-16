// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0060 D5 extension — Flow Trigger-Type Conformance ledger (the fourth
// instance of the reusable pattern). A `Flow.type` declares HOW a flow is
// triggered; if a declared trigger type has no runtime that fires/runs it, the
// flow is authorable but inert — the flow-shaped #1887, and flows are heavily
// AI-authored. One row per `Flow.type` enum value, each pinned to its runtime
// trigger/executor and a proof; the ratchet fails the build if a new flow type
// is added with no runtime.

import type { ConformanceRow } from '@objectstack/verify';

export const FLOW_TRIGGER_SURFACE: ConformanceRow[] = [
  {
    id: 'flow-record-change',
    summary: 'record_change — fires a flow on a record insert/update/delete',
    surface: 'flow.zod.ts:type=record_change',
    state: 'enforced',
    enforcement: '@objectstack/trigger-record-change subscribes to engine record events and starts the flow',
    covers: ['record_change'],
    proof: 'packages/triggers/trigger-record-change/src/record-change-trigger.test.ts',
  },
  {
    id: 'flow-api',
    summary: 'api — flow invoked via an HTTP/API endpoint',
    surface: 'flow.zod.ts:type=api',
    state: 'enforced',
    enforcement: '@objectstack/trigger-api exposes the flow as an invokable endpoint',
    covers: ['api'],
    proof: 'packages/triggers/trigger-api/src/api-trigger.test.ts',
  },
  {
    id: 'flow-schedule',
    summary: 'schedule — flow run on a cron/interval schedule',
    surface: 'flow.zod.ts:type=schedule',
    state: 'enforced',
    enforcement: '@objectstack/trigger-schedule registers cron/interval timers that start the flow',
    covers: ['schedule'],
    proof: 'packages/triggers/trigger-schedule/src/schedule-trigger.test.ts',
  },
  {
    id: 'flow-autolaunched',
    summary: 'autolaunched — subflow / programmatically-started flow (no event trigger)',
    surface: 'flow.zod.ts:type=autolaunched',
    state: 'enforced',
    enforcement: 'service-automation engine — started by a subflow node or a programmatic startFlow call',
    covers: ['autolaunched'],
    proof: 'packages/services/service-automation/src/builtin/subflow-node.test.ts',
  },
  {
    id: 'flow-screen',
    summary: 'screen — interactive (human-in-the-loop) flow; runs server-side, suspends at screen nodes for UI input',
    surface: 'flow.zod.ts:type=screen',
    state: 'enforced',
    enforcement: 'service-automation builtin screen executor + suspended-run store (server runs; resumes on UI input)',
    covers: ['screen'],
    proof: 'packages/services/service-automation/src/builtin/screen-nodes.test.ts',
  },
];
