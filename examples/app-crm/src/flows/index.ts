// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

// One flow — the screen-flow wizard the smoke test drives. Automation
// breadth (approvals, schedules, connectors, subflows, …) is the
// showcase's job (examples/app-showcase/src/automation/flows/).
import { ConvertLeadScreenFlow } from './convert-lead.flow.js';

export { ConvertLeadScreenFlow } from './convert-lead.flow.js';

export const allFlows = [ConvertLeadScreenFlow];
