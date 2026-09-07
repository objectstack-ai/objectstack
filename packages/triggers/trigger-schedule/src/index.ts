// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

export { ScheduleTriggerPlugin } from './plugin.js';
export { ScheduleTrigger, normalizeSchedule } from './schedule-trigger.js';
// `computeTickWindow`, `scheduleDispatchKey` and `TickWindow` are deliberately
// NOT re-exported here: measured 0 consumers outside this package, they appear
// in no exported signature, and the in-package users import them from
// './schedule-trigger.js' directly. An export whose only consumers live inside
// its own package belongs in a non-barrel module. A public key-computing
// surface for operator tooling would be a card with a consumer, not a rider.
export type {
    FlowTrigger,
    FlowTriggerBinding,
    JobServiceSurface,
    TriggerLogger,
    ReplayGuard,
    ReplayGuardDecision,
    ScheduleDispatchLedger,
    ScheduleDispatchClaim,
    ScheduleDispatchOutcome,
} from './schedule-trigger.js';

export { TimeRelativeTriggerPlugin } from './time-relative-plugin.js';
export {
    TimeRelativeTrigger,
    computeDateWindows,
    computeWindowClaimScopes,
    buildWindowWhere,
} from './time-relative-trigger.js';
export type {
    TimeRelativeDataEngine,
    DateWindow,
    WindowClaimScope,
    FlowDispatchClaimSurface,
} from './time-relative-trigger.js';
