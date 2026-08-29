// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { BaseResponseSchema } from './contract.zod';
import { FlowSchema } from '../automation/flow.zod';
import { ExecutionLogSchema, ExecutionStatus, FlowRunSummarySchema } from '../automation/execution.zod';

/**
 * Automation API Protocol
 *
 * Defines REST CRUD endpoint schemas for managing automation flows,
 * triggering executions, and querying execution history.
 *
 * Base path: /api/automation
 *
 * @example Endpoints
 * GET    /api/automation                         — List flows
 * GET    /api/automation/:name                   — Get flow
 * POST   /api/automation                         — Create flow
 * PUT    /api/automation/:name                   — Update flow
 * DELETE /api/automation/:name                   — Delete flow
 * POST   /api/automation/:name/trigger           — Trigger flow execution
 * POST   /api/automation/:name/toggle            — Enable/disable flow
 * GET    /api/automation/:name/runs              — List execution runs
 * GET    /api/automation/:name/runs/:runId       — Get single execution run
 */

// ==========================================
// 1. Path Parameters
// ==========================================

/**
 * Path parameters for flow-level operations.
 */
import { lazySchema } from '../shared/lazy-schema';
export const AutomationFlowPathParamsSchema = lazySchema(() => z.object({
  name: z.string().describe('Flow machine name (snake_case)'),
}));
export type AutomationFlowPathParams = z.input<typeof AutomationFlowPathParamsSchema>;

/**
 * Path parameters for run-level operations.
 */
export const AutomationRunPathParamsSchema = lazySchema(() => AutomationFlowPathParamsSchema.extend({
  runId: z.string().describe('Execution run ID'),
}));
export type AutomationRunPathParams = z.input<typeof AutomationRunPathParamsSchema>;

// ==========================================
// 2. List Flows (GET /api/automation)
// ==========================================

/**
 * Query parameters for listing automation flows.
 *
 * @example GET /api/automation?status=active&limit=20
 */
export const ListFlowsRequestSchema = lazySchema(() => z.object({
  status: z.enum(['draft', 'active', 'obsolete', 'invalid']).optional()
    .describe('Filter by flow status'),
  type: z.enum(['autolaunched', 'record_change', 'schedule', 'screen', 'api']).optional()
    .describe('Filter by flow type'),
  limit: z.number().int().min(1).max(100).default(50)
    .describe('Maximum number of flows to return'),
  cursor: z.string().optional()
    .describe('Cursor for pagination'),
}));
export type ListFlowsRequest = z.input<typeof ListFlowsRequestSchema>;
/** Post-parse shape of {@link ListFlowsRequest} — defaults applied, transforms run (ADR-0122). */
export type ListFlowsRequestParsed = z.infer<typeof ListFlowsRequestSchema>;

/**
 * Summary information for a flow in list results.
 */
export const FlowSummarySchema = lazySchema(() => z.object({
  name: z.string().describe('Flow machine name'),
  label: z.string().describe('Flow display label'),
  type: z.string().describe('Flow type'),
  status: z.string().describe('Flow deployment status'),
  version: z.number().int().describe('Flow version number'),
  enabled: z.boolean().describe('Whether the flow is enabled for execution'),
  nodeCount: z.number().int().optional().describe('Number of nodes in the flow'),
  lastRunAt: z.string().datetime().optional().describe('Last execution timestamp'),
}));
export type FlowSummary = z.input<typeof FlowSummarySchema>;

/**
 * Response for the list flows endpoint.
 */
export const ListFlowsResponseSchema = lazySchema(() => BaseResponseSchema.extend({
  data: z.object({
    flows: z.array(FlowSummarySchema).describe('Flow summaries'),
    total: z.number().int().optional().describe('Total matching flows'),
    nextCursor: z.string().optional().describe('Cursor for the next page'),
    hasMore: z.boolean().describe('Whether more flows are available'),
  }),
}));
export type ListFlowsResponse = z.input<typeof ListFlowsResponseSchema>;
/** Post-parse shape of {@link ListFlowsResponse} — defaults applied, transforms run (ADR-0122). */
export type ListFlowsResponseParsed = z.infer<typeof ListFlowsResponseSchema>;

// ==========================================
// 3. Get Flow (GET /api/automation/:name)
// ==========================================

/**
 * Request parameters for getting a single flow.
 */
export const GetFlowRequestSchema = lazySchema(() => AutomationFlowPathParamsSchema);
export type GetFlowRequest = z.input<typeof GetFlowRequestSchema>;

/**
 * Response for the get flow endpoint.
 */
export const GetFlowResponseSchema = lazySchema(() => BaseResponseSchema.extend({
  data: FlowSchema.describe('Full flow definition'),
}));
export type GetFlowResponse = z.input<typeof GetFlowResponseSchema>;
/** Post-parse shape of {@link GetFlowResponse} — defaults applied, transforms run (ADR-0122). */
export type GetFlowResponseParsed = z.infer<typeof GetFlowResponseSchema>;

// ==========================================
// 4. Create Flow (POST /api/automation)
// ==========================================

/**
 * Request body for creating a new flow.
 *
 * @example POST /api/automation
 * { name: 'approval_flow', label: 'Approval Flow', type: 'autolaunched', ... }
 */
export const CreateFlowRequestSchema = lazySchema(() => FlowSchema);
export type CreateFlowRequest = z.input<typeof CreateFlowRequestSchema>;
/** Post-parse shape of {@link CreateFlowRequest} — defaults applied, transforms run (ADR-0122). */
export type CreateFlowRequestParsed = z.infer<typeof CreateFlowRequestSchema>;

/**
 * Response after creating a flow.
 */
export const CreateFlowResponseSchema = lazySchema(() => BaseResponseSchema.extend({
  data: FlowSchema.describe('The created flow definition'),
}));
export type CreateFlowResponse = z.input<typeof CreateFlowResponseSchema>;
/** Post-parse shape of {@link CreateFlowResponse} — defaults applied, transforms run (ADR-0122). */
export type CreateFlowResponseParsed = z.infer<typeof CreateFlowResponseSchema>;

// ==========================================
// 5. Update Flow (PUT /api/automation/:name)
// ==========================================

/**
 * Request body for updating an existing flow.
 *
 * @example PUT /api/automation/approval_flow
 * { label: 'Updated Label', nodes: [...], edges: [...] }
 */
export const UpdateFlowRequestSchema = lazySchema(() => AutomationFlowPathParamsSchema.extend({
  definition: FlowSchema.partial().describe('Partial flow definition to update'),
}));
export type UpdateFlowRequest = z.input<typeof UpdateFlowRequestSchema>;
/** Post-parse shape of {@link UpdateFlowRequest} — defaults applied, transforms run (ADR-0122). */
export type UpdateFlowRequestParsed = z.infer<typeof UpdateFlowRequestSchema>;

/**
 * Response after updating a flow.
 */
export const UpdateFlowResponseSchema = lazySchema(() => BaseResponseSchema.extend({
  data: FlowSchema.describe('The updated flow definition'),
}));
export type UpdateFlowResponse = z.input<typeof UpdateFlowResponseSchema>;
/** Post-parse shape of {@link UpdateFlowResponse} — defaults applied, transforms run (ADR-0122). */
export type UpdateFlowResponseParsed = z.infer<typeof UpdateFlowResponseSchema>;

// ==========================================
// 6. Delete Flow (DELETE /api/automation/:name)
// ==========================================

/**
 * Request parameters for deleting a flow.
 */
export const DeleteFlowRequestSchema = lazySchema(() => AutomationFlowPathParamsSchema);
export type DeleteFlowRequest = z.input<typeof DeleteFlowRequestSchema>;

/**
 * Response after deleting a flow.
 */
export const DeleteFlowResponseSchema = lazySchema(() => BaseResponseSchema.extend({
  data: z.object({
    name: z.string().describe('Name of the deleted flow'),
    deleted: z.boolean().describe('Whether the flow was deleted'),
  }),
}));
export type DeleteFlowResponse = z.input<typeof DeleteFlowResponseSchema>;
/** Post-parse shape of {@link DeleteFlowResponse} — defaults applied, transforms run (ADR-0122). */
export type DeleteFlowResponseParsed = z.infer<typeof DeleteFlowResponseSchema>;

// ==========================================
// 7. Trigger Flow (POST /api/automation/:name/trigger)
// ==========================================

/**
 * Request body for triggering a flow execution.
 *
 * @example POST /api/automation/approval_flow/trigger
 * { record: { id: 'rec-1' }, object: 'account', event: 'on_create' }
 */
export const TriggerFlowRequestSchema = lazySchema(() => AutomationFlowPathParamsSchema.extend({
  record: z.record(z.string(), z.unknown()).optional()
    .describe('Record that triggered the automation'),
  object: z.string().optional()
    .describe('Object name the record belongs to'),
  event: z.string().optional()
    .describe('Trigger event type'),
  userId: z.string().optional()
    .describe('User who triggered the automation'),
  params: z.record(z.string(), z.unknown()).optional()
    .describe('Additional contextual data'),
}));
export type TriggerFlowRequest = z.input<typeof TriggerFlowRequestSchema>;

/**
 * One input field rendered by a paused `screen` node, as the trigger route
 * serves it — the wire spelling of `ScreenFieldSpec`
 * (`contracts/automation-service.ts`), which is THE name for this shape: a
 * second exported name here would be the permanent synonym ADR-0122 D3
 * forbids and a new dual-source export, so this stays module-local (the
 * `cubeMetaMemberShape` treatment, `analytics.zod.ts`).
 * `automation-api.zod.test.ts` binds the two at compile time.
 */
const screenFieldSpecShape = () => z.object({
  name: z.string(),
  label: z.string().optional(),
  type: z.string().optional()
    .describe('Widget hint (text/select/boolean/number/date/...); the client maps it to a field widget'),
  required: z.boolean().optional(),
  options: z.array(z.object({
    value: z.unknown(),
    label: z.string(),
  })).optional().describe('Closed-enum options for select-style fields'),
  defaultValue: z.unknown().optional(),
  placeholder: z.string().optional(),
  visibleWhen: z.string().optional().describe(
    'Conditional-visibility predicate, evaluated by the CLIENT against the '
    + 'screen\'s live collected values - bare CEL over the screen\'s own field '
    + 'names. Omit = always visible. A hidden field is not collected, so its '
    + '`required` never fires.',
  ),
});

/**
 * The screen a paused `screen` node wants the client to render — the wire
 * spelling of `ScreenSpec` (`contracts/automation-service.ts`), module-local
 * for the reason on {@link screenFieldSpecShape}.
 */
const screenSpecShape = () => z.object({
  nodeId: z.string()
    .describe('The screen node\'s id (correlates the resume back to this pause point)'),
  title: z.string().optional(),
  description: z.string().optional(),
  fields: z.array(screenFieldSpecShape()),
  kind: z.enum(['fields', 'object-form']).optional().describe(
    'Rendering kind. `fields` (default) renders the flat field list; '
    + '`object-form` renders an object\'s full create/edit form.',
  ),
  objectName: z.string().optional().describe('Object whose form to render (object-form screens)'),
  mode: z.enum(['create', 'edit']).optional()
    .describe('Form mode for an object-form screen - defaults to `create`'),
  recordId: z.string().optional().describe('Record id to edit (object-form screens in `edit` mode)'),
  defaults: z.record(z.string(), z.unknown()).optional()
    .describe('Prefilled field values for the object form (already interpolated)'),
  idVariable: z.string().optional().describe(
    'Flow variable that receives the saved record\'s id when the client '
    + 'resumes the run, so a later step can reference it',
  ),
});

/**
 * Response after triggering a flow execution.
 *
 * `data` IS the producer's declared return: `POST /automation/:name/trigger`
 * (and the legacy `POST /automation/trigger/:name`) end
 * `deps.success(result)` where `result` is `IAutomationService.execute`'s
 * `AutomationResult` (`contracts/automation-service.ts`), relayed verbatim —
 * member for member. #13078 restored the parity: this schema used to declare
 * only `success` / `output?` / `error?` / `durationMs?`, a strict subset of
 * what the route relays. The missing members were not decoration:
 * `status: 'paused'` + `runId` + `screen` is the whole third state of the
 * #9378 / #9510 trigger contract — the payload a caller resumes a screen
 * flow with — and the SDK's own docblock on `automation.trigger` tells
 * callers to read exactly those.
 *
 * The reasoning is #6442's (recorded on `AnalyticsMetadataResponseSchema`,
 * `analytics.zod.ts`): when the TS contract and the runtime already agree,
 * the schema is the lone outlier and the SCHEMA moves. Zero runtime change:
 * only the declaration moves.
 *
 * Drift guard: `automation-api.zod.test.ts` binds
 * `TriggerFlowResponse['data']` to `AutomationResult` at compile time —
 * narrow either side alone and it goes red. Keep new `AutomationResult`
 * members mirrored here (and vice versa).
 */
export const TriggerFlowResponseSchema = lazySchema(() => BaseResponseSchema.extend({
  data: z.object({
    success: z.boolean().describe('Whether the automation completed successfully'),
    output: z.unknown().optional().describe('Output data from the automation'),
    error: z.string().optional().describe('Error message if execution failed'),
    durationMs: z.number().optional().describe('Execution duration in milliseconds'),
    code: z.enum([
      'PERMISSION_DENIED',
      'INVALID_SIGNAL',
      'RUN_NOT_FOUND',
      'STORE_UNAVAILABLE',
      'RESUME_IN_PROGRESS',
      'INVALID_SCREEN_INPUT',
      'FLOW_DISABLED',
      'FLOW_NO_START_NODE',
      'FLOW_INPUT_SCHEMA_INVALID',
    ]).optional().describe(
      'Machine-readable failure classification, set alongside `error` when the '
      + 'caller must distinguish WHY it failed. A closed union - the members and '
      + 'their transport mappings are documented on the contract '
      + '(`AutomationResult.code`, contracts/automation-service.ts).',
    ),
    status: z.enum(['completed', 'paused', 'failed']).optional().describe(
      'Lifecycle status. `paused` means the run suspended at a node and can be '
      + 'continued with the resume route. Absent or `completed`/`failed` means '
      + 'the run reached a terminal state.',
    ),
    runId: z.string().optional()
      .describe('Run id - set when `status` is `paused`, so callers can resume it'),
    screen: screenSpecShape().optional().describe(
      'The screen to render - set when the run paused at a `screen` node '
      + 'awaiting user input. The client collects values for `screen.fields` '
      + 'and resumes the run with them.',
    ),
    successMessage: z.string().optional().describe(
      'Friendly terminal message copied from the flow definition on terminal '
      + 'success, so a screen-flow runner can show a meaningful toast',
    ),
    errorMessage: z.string().optional().describe(
      'Friendly terminal message copied from the flow definition on failure',
    ),
    summary: FlowRunSummarySchema.optional().describe(
      'What the run did - records selected / acted on, gate skips, per-node '
      + 'status. Set on a TERMINAL result (a paused run has not finished doing '
      + 'it yet).',
    ),
  }),
}));
export type TriggerFlowResponse = z.input<typeof TriggerFlowResponseSchema>;
/** Post-parse shape of {@link TriggerFlowResponse} — defaults applied, transforms run (ADR-0122). */
export type TriggerFlowResponseParsed = z.infer<typeof TriggerFlowResponseSchema>;

// ==========================================
// 8. Toggle Flow (POST /api/automation/:name/toggle)
// ==========================================

/**
 * Request body for enabling/disabling a flow.
 *
 * @example POST /api/automation/approval_flow/toggle
 * { enabled: true }
 */
export const ToggleFlowRequestSchema = lazySchema(() => AutomationFlowPathParamsSchema.extend({
  enabled: z.boolean().describe('Whether to enable (true) or disable (false) the flow'),
}));
export type ToggleFlowRequest = z.input<typeof ToggleFlowRequestSchema>;

/**
 * Response after toggling a flow.
 */
export const ToggleFlowResponseSchema = lazySchema(() => BaseResponseSchema.extend({
  data: z.object({
    name: z.string().describe('Flow name'),
    enabled: z.boolean().describe('New enabled state'),
  }),
}));
export type ToggleFlowResponse = z.input<typeof ToggleFlowResponseSchema>;
/** Post-parse shape of {@link ToggleFlowResponse} — defaults applied, transforms run (ADR-0122). */
export type ToggleFlowResponseParsed = z.infer<typeof ToggleFlowResponseSchema>;

// ==========================================
// 9. List Runs (GET /api/automation/:name/runs)
// ==========================================

/**
 * Query parameters for listing execution runs.
 *
 * @example GET /api/automation/approval_flow/runs?status=completed&limit=10
 */
export const ListRunsRequestSchema = lazySchema(() => AutomationFlowPathParamsSchema.extend({
  // [#7359] The canonical `ExecutionStatus`, not a copy of its members. The
  // runtime boundary that now enforces this filter reads its accepted set from
  // the same enum, so the set the wire DECLARES and the set the boundary
  // ACCEPTS cannot drift — a member added to `ExecutionStatus` cannot end up
  // advertised here and refused with a 400 there. (The members were previously
  // re-listed inline; the two lists were identical, so this is not a wire
  // change.)
  status: ExecutionStatus.optional()
    .describe('Filter by execution status'),
  limit: z.number().int().min(1).max(100).default(20)
    .describe('Maximum number of runs to return'),
  cursor: z.string().optional()
    .describe('Cursor for pagination'),
}));
export type ListRunsRequest = z.input<typeof ListRunsRequestSchema>;
/** Post-parse shape of {@link ListRunsRequest} — defaults applied, transforms run (ADR-0122). */
export type ListRunsRequestParsed = z.infer<typeof ListRunsRequestSchema>;

/**
 * Response for the list runs endpoint.
 */
export const ListRunsResponseSchema = lazySchema(() => BaseResponseSchema.extend({
  data: z.object({
    runs: z.array(ExecutionLogSchema).describe('Execution run logs'),
    total: z.number().int().optional().describe('Total matching runs'),
    nextCursor: z.string().optional().describe('Cursor for the next page'),
    hasMore: z.boolean().describe('Whether more runs are available'),
  }),
}));
export type ListRunsResponse = z.input<typeof ListRunsResponseSchema>;
/** Post-parse shape of {@link ListRunsResponse} — defaults applied, transforms run (ADR-0122). */
export type ListRunsResponseParsed = z.infer<typeof ListRunsResponseSchema>;

// ==========================================
// 10. Get Run (GET /api/automation/:name/runs/:runId)
// ==========================================

/**
 * Request parameters for getting a single execution run.
 */
export const GetRunRequestSchema = lazySchema(() => AutomationRunPathParamsSchema);
export type GetRunRequest = z.input<typeof GetRunRequestSchema>;

/**
 * Response for the get run endpoint.
 */
export const GetRunResponseSchema = lazySchema(() => BaseResponseSchema.extend({
  data: ExecutionLogSchema.describe('Full execution log with step details'),
}));
export type GetRunResponse = z.input<typeof GetRunResponseSchema>;
/** Post-parse shape of {@link GetRunResponse} — defaults applied, transforms run (ADR-0122). */
export type GetRunResponseParsed = z.infer<typeof GetRunResponseSchema>;

// ==========================================
// 11. Automation API Error Codes
// ==========================================

/**
 * Error codes specific to Automation operations.
 */
export const AutomationApiErrorCode = z.enum([
  'flow_not_found',
  'flow_already_exists',
  'flow_validation_failed',
  'flow_disabled',
  'execution_not_found',
  'execution_failed',
  'execution_timeout',
  'node_executor_not_found',
  'concurrent_execution_limit',
]);
export type AutomationApiErrorCode = z.input<typeof AutomationApiErrorCode>;

// ==========================================
// 12. Automation API Contract Registry
// ==========================================

/**
 * Standard Automation API contracts map.
 * Used for generating SDKs, documentation, and route registration.
 */
export const AutomationApiContracts = {
  listFlows: {
    method: 'GET' as const,
    path: '/api/automation',
    input: ListFlowsRequestSchema,
    output: ListFlowsResponseSchema,
  },
  getFlow: {
    method: 'GET' as const,
    path: '/api/automation/:name',
    input: GetFlowRequestSchema,
    output: GetFlowResponseSchema,
  },
  createFlow: {
    method: 'POST' as const,
    path: '/api/automation',
    input: CreateFlowRequestSchema,
    output: CreateFlowResponseSchema,
  },
  updateFlow: {
    method: 'PUT' as const,
    path: '/api/automation/:name',
    input: UpdateFlowRequestSchema,
    output: UpdateFlowResponseSchema,
  },
  deleteFlow: {
    method: 'DELETE' as const,
    path: '/api/automation/:name',
    input: DeleteFlowRequestSchema,
    output: DeleteFlowResponseSchema,
  },
  triggerFlow: {
    method: 'POST' as const,
    path: '/api/automation/:name/trigger',
    input: TriggerFlowRequestSchema,
    output: TriggerFlowResponseSchema,
  },
  toggleFlow: {
    method: 'POST' as const,
    path: '/api/automation/:name/toggle',
    input: ToggleFlowRequestSchema,
    output: ToggleFlowResponseSchema,
  },
  listRuns: {
    method: 'GET' as const,
    path: '/api/automation/:name/runs',
    input: ListRunsRequestSchema,
    output: ListRunsResponseSchema,
  },
  getRun: {
    method: 'GET' as const,
    path: '/api/automation/:name/runs/:runId',
    input: GetRunRequestSchema,
    output: GetRunResponseSchema,
  },
};
