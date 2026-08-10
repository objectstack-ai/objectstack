// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'workflow-service-slot-retired',
  surface:
    "CoreServiceName 'workflow' / IWorkflowService / WorkflowProtocol / "
    + 'discovery routes.workflow / RestApiRouteCategory workflow',
  replacement:
    'the live mechanisms the slot only ever pointed at: `state_machine` validation rules '
    + 'for record state machines, approval flow nodes on the approvals runtime (ADR-0019) '
    + 'for approvals, lifecycle hooks + `record_change` flows (service-automation) for '
    + 'record-triggered automation',
  reason:
    'The workflow slot was declared end to end and implemented nowhere: no code in either '
    + 'repository ever registered or resolved it (ADR-0115 Evidence 5 — the only touches '
    + 'were plugin-dev\'s retired stub probe and the generic discovery walk), no '
    + 'implementation of any WorkflowProtocol method ever existed, and no host ever '
    + 'mounted `/api/v1/workflow` (the pre-#3586 DEFAULT_DISPATCHER_ROUTES listed it among '
    + 'routes that never existed). Every part of it was ADR-0078\'s silently-inert '
    + 'declaration: a CoreServiceName nothing filled, a contract nothing implemented, a '
    + 'protocol nothing served, a discovery route field no builder could truthfully '
    + 'populate. These are TS/API surfaces and a discovery RESPONSE field — never stored '
    + 'in stack metadata, so there is no source for the chain to rewrite; consumers of the '
    + 'deleted types move their imports themselves. ADR-0049 / ADR-0078, #4451.',
  acceptanceCriteria:
    'No import of IWorkflowService, WorkflowProtocol or the Get/WorkflowState/Config/'
    + 'Transition types resolves; no code calls getService(\'workflow\') or reads '
    + 'discovery `routes.workflow` / `services.workflow`; record state machines, '
    + 'approvals and record-triggered automation go through the replacement mechanisms. '
    + 'Discovery output on a default boot is unchanged (the slot was always reported '
    + 'unavailable; now it is simply absent).',
};
