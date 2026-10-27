import { describe, it, expect } from 'vitest';
import {
  AutomationFlowPathParamsSchema,
  AutomationRunPathParamsSchema,
  GetFlowRequestSchema,
  GetFlowResponseSchema,
  CreateFlowRequestSchema,
  CreateFlowResponseSchema,
  UpdateFlowRequestSchema,
  UpdateFlowResponseSchema,
  DeleteFlowRequestSchema,
  DeleteFlowResponseSchema,
  TriggerFlowRequestSchema,
  TriggerFlowResponseSchema,
  ToggleFlowRequestSchema,
  ToggleFlowResponseSchema,
  ListRunsRequestSchema,
  ListRunsResponseSchema,
  GetRunRequestSchema,
  GetRunResponseSchema,
  AutomationApiErrorCode,
  AutomationApiContracts,
  ResumeFailureDetailsSchema,
  FlowFailureDetailsSchema,
  FlowInnerRefusalSchema,
} from './automation-api.zod';
import { BaseResponseSchema } from './contract.zod';
import * as AutomationApiModule from './automation-api.zod';
import type { TriggerFlowResponse, ResumeFailureDetails, FlowFailureDetails } from './automation-api.zod';
import { ExecutionStatus } from '../automation/execution.zod';
import type { AutomationResult } from '../contracts/automation-service';

/** Type-level identity: true iff A and B are the same type. */
type Eq< A, B > = (< T >() => T extends A ? 1 : 2) extends (< T >() => T extends B ? 1 : 2) ? true : false;
/** Compile error when the argument is not `true`. */
type Assert< T extends true > = T;

/**
 * #13078 — the declared `data` of `TriggerFlowResponse` IS the
 * `AutomationResult` contract interface, not merely shaped like it.
 *
 * Both trigger routes relay `IAutomationService.execute`'s declared return
 * through `deps.success(result)` verbatim, and the contract was already
 * correct while `TriggerFlowResponseSchema` declared a strict subset — the
 * #9378/#9510 paused third state (`status`/`runId`/`screen`), `code`, the
 * friendly terminal messages and `summary` were all missing. Same
 * two-files-one-shape drift #6442 fixed for `AnalyticsMetadataResponseSchema`
 * (the reasoning is recorded there); binding the two here is what stops it
 * recurring: narrow either one alone and this goes red.
 *
 * Exported deliberately — an unread alias inside a test body is TS6196, and a
 * `@ts-expect-error`-style pin no program compiles is no pin at all.
 */
export type TriggerFlowDataMatchesContract = Assert< Eq< TriggerFlowResponse['data'], AutomationResult > >;

/**
 * #24996 (ruling B′ on #24914) — the inner refusal is declared ONCE: the
 * member every door's `400 FLOW_FAILED` details carry is the very type
 * `AutomationResult` carries, so a producer relaying one into the other
 * cannot drift. Narrow either side alone and this alias reds by name.
 * Exported for the same reason as the pin above (TS6196 otherwise).
 */
export type FlowFailureInnerRefusalIsTheContracts = Assert< Eq<
  FlowFailureDetails['innerRefusal'],
  AutomationResult['innerRefusal']
> >;

/**
 * #15221 — the resume door's `400 FLOW_FAILED` details forward the ENGINE's
 * verdict, so the `status` the details schema declares must be exactly the
 * terminal-failure subset of the contract's own union: rename or remove
 * `'stranded'` / `'failed'` on `AutomationResult.status` and `Extract` yields
 * fewer members, which reds this alias by name. Deliberately a SUBSET pin,
 * not an identity: `'completed'` / `'paused'` / `'refused'` are `success: true`
 * verdicts and can never reach a 400.
 *
 * Exported for the same reason as the pin above (TS6196 otherwise).
 */
export type ResumeFailureStatusIsTheContractsTerminalFailureSubset = Assert< Eq<
  NonNullable<ResumeFailureDetails['status']>,
  Extract<NonNullable<AutomationResult['status']>, 'failed' | 'stranded'>
> >;

// ==========================================
// Path Parameters
// ==========================================

describe('AutomationFlowPathParamsSchema', () => {
  it('should accept a valid flow name', () => {
    const result = AutomationFlowPathParamsSchema.parse({ name: 'approval_flow' });
    expect(result.name).toBe('approval_flow');
  });
});

describe('AutomationRunPathParamsSchema', () => {
  it('should accept valid flow name + run ID', () => {
    const result = AutomationRunPathParamsSchema.parse({ name: 'approval_flow', runId: 'exec_001' });
    expect(result.name).toBe('approval_flow');
    expect(result.runId).toBe('exec_001');
  });
});

// ==========================================
// List Flows — RETIRED (#19543, door ④)
// ==========================================

describe('the GET /api/v1/automation flow-list door is retired', () => {
  // Flows are metadata (ADR-0106); the list is `GET /api/v1/meta/flow`. The
  // three schemas left with the route and are registered as whole-def removals
  // (`RETIRED_DEFS_BY_MAJOR[18]`), so an export that came back would be a
  // declaration nothing serves — exactly what the retirement removed.
  it.each(['ListFlowsRequestSchema', 'ListFlowsResponseSchema', 'FlowSummarySchema'])(
    '%s is no longer exported',
    (name) => {
      expect(Object.keys(AutomationApiModule)).not.toContain(name);
    },
  );

  it('the module still exports its surviving request schemas (the absence above is not a dead import)', () => {
    expect(Object.keys(AutomationApiModule)).toEqual(
      expect.arrayContaining(['GetFlowRequestSchema', 'CreateFlowRequestSchema', 'ListRunsRequestSchema']),
    );
  });
});

// ==========================================
// Get Flow
// ==========================================

describe('GetFlowRequestSchema', () => {
  it('should accept a flow name', () => {
    const result = GetFlowRequestSchema.parse({ name: 'my_flow' });
    expect(result.name).toBe('my_flow');
  });
});

describe('GetFlowResponseSchema', () => {
  it('should accept a response wrapping a FlowSchema', () => {
    const result = GetFlowResponseSchema.parse({
      success: true,
      data: {
        name: 'approval_flow',
        label: 'Approval Flow',
        type: 'autolaunched',
        nodes: [
          { id: 'start', type: 'start', label: 'Start' },
          { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [{ id: 'e1', source: 'start', target: 'end' }],
      },
    });
    expect(result.data.name).toBe('approval_flow');
    expect(result.data.nodes).toHaveLength(2);
  });
});

// ==========================================
// Create Flow
// ==========================================

describe('CreateFlowRequestSchema', () => {
  it('should accept a valid flow definition', () => {
    const result = CreateFlowRequestSchema.parse({
      name: 'new_flow',
      label: 'New Flow',
      type: 'api',
      nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'end', type: 'end', label: 'End' },
      ],
      edges: [{ id: 'e1', source: 'start', target: 'end' }],
    });
    expect(result.name).toBe('new_flow');
    expect(result.status).toBe('draft'); // default
  });

  it('should reject invalid flow name', () => {
    expect(() => CreateFlowRequestSchema.parse({
      name: 'InvalidName',
      label: 'Bad',
      type: 'api',
      nodes: [],
      edges: [],
    })).toThrow();
  });
});

describe('CreateFlowResponseSchema', () => {
  it('should accept a response wrapping a FlowSchema', () => {
    const result = CreateFlowResponseSchema.parse({
      success: true,
      data: {
        name: 'new_flow',
        label: 'New Flow',
        type: 'api',
        nodes: [
          { id: 'start', type: 'start', label: 'Start' },
          { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [{ id: 'e1', source: 'start', target: 'end' }],
      },
    });
    expect(result.success).toBe(true);
    expect(result.data.name).toBe('new_flow');
  });
});

// ==========================================
// Update Flow
// ==========================================

describe('UpdateFlowRequestSchema', () => {
  // [#12206, inherited item ②] The old `.partial()` declared a partial-update
  // capability nothing implements: the engine's `registerFlow` runs
  // `FlowSchema.parse` on the definition, so a bare `{ label }` has always
  // been a 400 against a real server. The request schema now requires the
  // complete definition the engine actually requires.
  it('should reject a partial definition — the engine requires a complete flow', () => {
    expect(() => UpdateFlowRequestSchema.parse({
      name: 'my_flow',
      definition: { label: 'Updated Label' },
    })).toThrow();
  });

  it('should accept a complete flow definition', () => {
    const result = UpdateFlowRequestSchema.parse({
      name: 'my_flow',
      definition: {
        name: 'my_flow',
        label: 'Updated Label',
        type: 'autolaunched',
        nodes: [
          { id: 'start', type: 'start', label: 'Start' },
          { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [{ id: 'e1', source: 'start', target: 'end' }],
      },
    });
    expect(result.name).toBe('my_flow');
    expect(result.definition.label).toBe('Updated Label');
  });
});

describe('UpdateFlowResponseSchema', () => {
  it('should accept a valid response', () => {
    const result = UpdateFlowResponseSchema.parse({
      success: true,
      data: {
        name: 'my_flow',
        label: 'Updated Label',
        type: 'autolaunched',
        nodes: [
          { id: 'start', type: 'start', label: 'Start' },
          { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [{ id: 'e1', source: 'start', target: 'end' }],
      },
    });
    expect(result.data.label).toBe('Updated Label');
  });
});

// ==========================================
// Delete Flow
// ==========================================

describe('DeleteFlowRequestSchema', () => {
  it('should accept a flow name', () => {
    const result = DeleteFlowRequestSchema.parse({ name: 'old_flow' });
    expect(result.name).toBe('old_flow');
  });
});

describe('DeleteFlowResponseSchema', () => {
  it('should accept a valid response', () => {
    const result = DeleteFlowResponseSchema.parse({
      success: true,
      data: { name: 'old_flow', deleted: true },
    });
    expect(result.data.deleted).toBe(true);
  });
});

// ==========================================
// Trigger Flow
// ==========================================

describe('TriggerFlowRequestSchema', () => {
  it('should accept minimal trigger request', () => {
    const result = TriggerFlowRequestSchema.parse({ name: 'my_flow' });
    expect(result.name).toBe('my_flow');
    expect(result.record).toBeUndefined();
  });

  it('should accept full trigger request', () => {
    const result = TriggerFlowRequestSchema.parse({
      name: 'approval_flow',
      record: { id: 'rec-1', amount: 50000 },
      object: 'opportunity',
      event: 'on_create',
      userId: 'user_123',
      params: { priority: 'high' },
    });
    expect(result.name).toBe('approval_flow');
    expect(result.object).toBe('opportunity');
    expect(result.event).toBe('on_create');
  });
});

describe('TriggerFlowResponseSchema', () => {
  it('should accept a successful trigger response', () => {
    const result = TriggerFlowResponseSchema.parse({
      success: true,
      data: {
        success: true,
        output: { status: 'approved' },
        durationMs: 42,
      },
    });
    expect(result.data.success).toBe(true);
    expect(result.data.durationMs).toBe(42);
  });

  it('should accept a failed trigger response', () => {
    const result = TriggerFlowResponseSchema.parse({
      success: true,
      data: {
        success: false,
        error: 'Flow step 3 failed: timeout',
        durationMs: 5000,
      },
    });
    expect(result.data.success).toBe(false);
    expect(result.data.error).toContain('timeout');
  });

  // #13078 — the AutomationResult members the schema used to be missing. The
  // PRESERVATION half matters as much as the parse: this schema strips
  // undeclared keys (BaseResponseSchema.extend + plain z.object), so before
  // the widening the paused-run triple below "passed" while the parse silently
  // dropped `status`, the `runId` a caller resumes with and the whole screen.
  it('should preserve the paused-run triple — status, runId and the screen (a pause is the third state, not a failure)', () => {
    const result = TriggerFlowResponseSchema.parse({
      success: true,
      data: {
        success: true,
        status: 'paused',
        runId: 'run_screen_001',
        screen: {
          nodeId: 'collect_details',
          title: 'Opportunity details',
          fields: [
            { name: 'amount', label: 'Amount', type: 'number', required: true },
            {
              name: 'stage',
              label: 'Stage',
              type: 'select',
              options: [
                { value: 'prospecting', label: 'Prospecting' },
                { value: 'closed_won', label: 'Closed won' },
              ],
            },
            { name: 'close_reason', type: 'text', visibleWhen: 'stage == "closed_won"' },
          ],
        },
      },
    });
    expect(result.data.status).toBe('paused');
    expect(result.data.runId).toBe('run_screen_001');
    expect(result.data.screen?.nodeId).toBe('collect_details');
    expect(result.data.screen?.fields).toHaveLength(3);
    expect(result.data.screen?.fields[1].options?.[1].value).toBe('closed_won');
    expect(result.data.screen?.fields[2].visibleWhen).toContain('closed_won');
  });

  it('should preserve an object-form screen pause — the second screen kind', () => {
    const result = TriggerFlowResponseSchema.parse({
      success: true,
      data: {
        success: true,
        status: 'paused',
        runId: 'run_convert_002',
        screen: {
          nodeId: 'create_customer',
          kind: 'object-form',
          objectName: 'account',
          mode: 'create',
          fields: [],
          defaults: { name: 'Acme Corp' },
          idVariable: 'customerId',
        },
      },
    });
    expect(result.data.screen?.kind).toBe('object-form');
    expect(result.data.screen?.objectName).toBe('account');
    expect(result.data.screen?.defaults?.name).toBe('Acme Corp');
    expect(result.data.screen?.idVariable).toBe('customerId');
  });

  // #26657 — the screen's place among the run's screens, which the engine reads
  // off the flow graph so a runner can say Next or Submit and count steps.
  it('should preserve the screen progress the engine read off the graph', () => {
    const paused = (progress: unknown) => TriggerFlowResponseSchema.safeParse({
      success: true,
      data: { success: true, status: 'paused', runId: 'run_wizard', screen: { nodeId: 's1', fields: [], progress } },
    });
    const exact = paused({ nextScreen: 'certain', step: 1, stepCount: 3 });
    expect(exact.success && exact.data.data.screen?.progress).toEqual({ nextScreen: 'certain', step: 1, stepCount: 3 });
    // A branch leaves the counts out; the answer alone is complete.
    const branched = paused({ nextScreen: 'possible' });
    expect(branched.success && branched.data.data.screen?.progress).toEqual({ nextScreen: 'possible' });
  });

  it('should reject a progress answer outside its closed vocabulary or a step below 1', () => {
    const paused = (progress: unknown) => TriggerFlowResponseSchema.safeParse({
      success: true,
      data: { success: true, status: 'paused', runId: 'run_wizard', screen: { nodeId: 's1', fields: [], progress } },
    });
    expect(paused({ nextScreen: 'maybe' }).success).toBe(false);
    expect(paused({}).success).toBe(false);
    expect(paused({ nextScreen: 'none', step: 0, stepCount: 1 }).success).toBe(false);
    expect(paused({ nextScreen: 'none', step: 1.5 }).success).toBe(false);
  });

  it('should preserve terminal message and summary on a finished run', () => {
    const result = TriggerFlowResponseSchema.parse({
      success: true,
      data: {
        success: true,
        status: 'completed',
        durationMs: 87,
        successMessage: 'Opportunity created.',
        summary: {
          selected: 1,
          acted: 1,
          skipped: 0,
          nodes: [],
          gates: [],
        },
      },
    });
    expect(result.data.successMessage).toBe('Opportunity created.');
    expect(result.data.summary?.acted).toBe(1);
  });

  // `AutomationResult.flowLabel` — the flow's authored label, which a runner
  // shows (and translates) in its header and completion toast. The compile-
  // time `TriggerFlowDataMatchesContract` guard above holds the member's
  // presence; this holds its SURVIVAL: the schema strips undeclared keys, so
  // a mirror missing the member would parse clean and drop the label.
  it('should preserve the authored flowLabel on a paused and on a finished run', () => {
    const paused = TriggerFlowResponseSchema.parse({
      success: true,
      data: {
        success: true,
        status: 'paused',
        runId: 'run_screen_003',
        screen: { nodeId: 'ask', fields: [] },
        flowLabel: 'Order Intake Wizard',
      },
    });
    const finished = TriggerFlowResponseSchema.parse({
      success: true,
      data: { success: true, successMessage: 'Done.', flowLabel: 'Order Intake Wizard' },
    });
    expect(paused.data.flowLabel).toBe('Order Intake Wizard');
    expect(finished.data.flowLabel).toBe('Order Intake Wizard');
  });

  it('should preserve the failure classification code alongside error', () => {
    const result = TriggerFlowResponseSchema.parse({
      success: true,
      data: {
        success: false,
        error: 'Flow is disabled',
        code: 'FLOW_DISABLED',
      },
    });
    expect(result.data.code).toBe('FLOW_DISABLED');
  });

  it('should reject a status or code outside the closed vocabulary, and a screen without its nodeId', () => {
    expect(() =>
      TriggerFlowResponseSchema.parse({
        success: true,
        data: { success: true, status: 'running' },
      })
    ).toThrow();

    expect(() =>
      TriggerFlowResponseSchema.parse({
        success: true,
        data: { success: false, code: 'SOMETHING_ELSE' },
      })
    ).toThrow();

    expect(() =>
      TriggerFlowResponseSchema.parse({
        success: true,
        data: {
          success: true,
          status: 'paused',
          runId: 'run_1',
          screen: { title: 'No node id', fields: [] },
        },
      })
    ).toThrow();
  });
});

// ==========================================
// Resume failure details (#15221)
// ==========================================

describe('ResumeFailureDetailsSchema', () => {
  // The stranded arm: the whole point of the schema — a client reads
  // `repairable` off a typed structure and never regexes the message.
  it('accepts the stranded verdict — runId, status and repairable', () => {
    const result = ResumeFailureDetailsSchema.parse({
      runId: 'run_1',
      status: 'stranded',
      repairable: true,
    });
    expect(result).toEqual({ runId: 'run_1', status: 'stranded', repairable: true });
  });

  // The plain terminal arm as the engine emits it today (a subflow child that
  // failed terminally stamps NO status): `status` is optional, `repairable`
  // is not — present-and-false is the contract, not absence.
  it('accepts a verdict with no status — repairable stays required', () => {
    const result = ResumeFailureDetailsSchema.parse({ runId: 'run_1', repairable: false });
    expect(result).toEqual({ runId: 'run_1', repairable: false });
    expect(ResumeFailureDetailsSchema.safeParse({ runId: 'run_1' }).success).toBe(false);
    expect(ResumeFailureDetailsSchema.safeParse({ runId: 'run_1', repairable: 'yes' }).success).toBe(false);
  });

  it('accepts the plain `failed` verdict', () => {
    const result = ResumeFailureDetailsSchema.parse({ runId: 'run_1', status: 'failed', repairable: false });
    expect(result.status).toBe('failed');
  });

  // The two terminal-failure members and nothing else: a `success: true`
  // verdict (`paused` / `completed` / `refused`) never reaches a 400, so the
  // schema refuses it rather than describing an arm that does not exist.
  it('refuses a status that is not a terminal failure', () => {
    for (const status of ['paused', 'completed', 'refused', 'bogus']) {
      expect(ResumeFailureDetailsSchema.safeParse({ runId: 'run_1', status, repairable: false }).success, status).toBe(false);
    }
    expect(ResumeFailureDetailsSchema.shape.status.unwrap().options).toEqual(['failed', 'stranded']);
  });

  it('requires the runId', () => {
    expect(ResumeFailureDetailsSchema.safeParse({ repairable: true, status: 'stranded' }).success).toBe(false);
  });

  // On the wire the structure rides INSIDE the same `error.details` object as
  // the run's two artefacts; a client hands the whole `details` to this
  // schema and gets the verdict back — the artefacts are neither required
  // nor refused.
  it('parses the whole `details` object the resume door emits — the artefacts ride beside it', () => {
    const result = ResumeFailureDetailsSchema.parse({
      runId: 'run_1',
      status: 'stranded',
      repairable: true,
      errorMessage: 'Please contact support',
      summary: { nodes: [] },
    });
    expect(result).toEqual({ runId: 'run_1', status: 'stranded', repairable: true });
  });
});

// ==========================================
// Flow failure details + inner refusal (#24996, ruling B′ on #24914)
// ==========================================

describe('FlowFailureDetailsSchema — one inner-refusal shape across the four FLOW_FAILED doors', () => {
  const INNER = {
    code: 'UNIQUE_VIOLATION',
    message: "Duplicate record refused on 'crm_account': a record with this name already exists.",
  } as const;
  const USER_MESSAGE = 'An account with this name already exists.';
  const SUMMARY = {
    selected: 0, acted: 0, skipped: 0, unmeasured: 0,
    nodes: [{ nodeId: 'create_account', nodeType: 'create_record', status: 'failure', runs: 1, failures: 1, skipped: 0 }],
    gates: [],
  };
  // The four doors, each with its OWN message wording (unchanged by the
  // ruling) and, on the resume door alone, the engine's verdict beside the
  // shared keys.
  const DOORS = [
    { door: 'trigger', message: "Node 'create_account' failed: create_record(crm_account) failed", extra: {} },
    {
      door: 'resume',
      message: "Node 'create_account' failed: create_record(crm_account) failed",
      extra: { runId: 'run_1', status: 'failed', repairable: false },
    },
    { door: '/actions', message: "Flow 'convert_lead' failed: Node 'create_account' failed", extra: {} },
    { door: 'endpoint', message: "Node 'create_account' failed: create_record(crm_account) failed", extra: {} },
  ] as const;

  const envelope = (message: string, details: Record<string, unknown>, userMessage?: string) => ({
    success: false,
    error: {
      code: 'FLOW_FAILED',
      message,
      ...(userMessage !== undefined ? { userMessage } : {}),
      details,
    },
  });

  it.each(DOORS)('$door: an envelope carrying details.innerRefusal and a top-level userMessage validates', ({ door, message, extra }) => {
    const body = envelope(message, { errorMessage: 'Could not convert the lead.', summary: SUMMARY, innerRefusal: INNER, ...extra }, USER_MESSAGE);

    const parsedEnvelope = BaseResponseSchema.parse(body);
    expect(parsedEnvelope.error?.code).toBe('FLOW_FAILED');
    // `message` is the door's own wording, untouched; `userMessage` rides
    // beside it at the top level, never replacing it.
    expect(parsedEnvelope.error?.message).toBe(message);
    expect(parsedEnvelope.error?.userMessage).toBe(USER_MESSAGE);

    const details = FlowFailureDetailsSchema.parse(parsedEnvelope.error?.details);
    expect(details.innerRefusal).toEqual(INNER);
    expect(details.errorMessage).toBe('Could not convert the lead.');
    expect(details.summary?.nodes[0]?.nodeId).toBe('create_account');

    if (door === 'resume') {
      // The verdict rides in the SAME details object and parses with its own
      // schema; neither schema refuses the other's members.
      expect(ResumeFailureDetailsSchema.parse(parsedEnvelope.error?.details))
        .toEqual({ runId: 'run_1', status: 'failed', repairable: false });
    }
  });

  it.each(DOORS)('$door: an envelope WITHOUT innerRefusal or userMessage still validates (optional, additive)', ({ door, message, extra }) => {
    for (const details of [{ ...extra }, { errorMessage: 'Could not convert the lead.', summary: SUMMARY, ...extra }]) {
      const parsedEnvelope = BaseResponseSchema.parse(envelope(message, details));
      expect(parsedEnvelope.error?.userMessage).toBeUndefined();
      const parsed = FlowFailureDetailsSchema.parse(parsedEnvelope.error?.details);
      expect(parsed.innerRefusal).toBeUndefined();
      if (door === 'resume') {
        expect(ResumeFailureDetailsSchema.safeParse(parsedEnvelope.error?.details).success).toBe(true);
      }
    }
  });

  it('declares exactly the three ruled keys — the #9585 ceiling as ruling B′ relaxed it', () => {
    expect(Object.keys(FlowFailureDetailsSchema.shape).sort()).toEqual(['errorMessage', 'innerRefusal', 'summary']);
  });

  it('the inner code takes the closed WIRE vocabulary — an unregistered spelling is refused', () => {
    expect(FlowInnerRefusalSchema.safeParse(INNER).success).toBe(true);
    const refused = FlowInnerRefusalSchema.safeParse({ code: 'ER_DUP_ENTRY', message: INNER.message });
    expect(refused.success).toBe(false);
    expect(refused.error?.issues[0]?.path).toEqual(['code']);
    expect(FlowFailureDetailsSchema.safeParse({ innerRefusal: { code: 'ER_DUP_ENTRY', message: 'x' } }).success).toBe(false);
  });

  it('the inner refusal is `{ code, message }` — both members required', () => {
    expect(FlowInnerRefusalSchema.safeParse({ code: 'UNIQUE_VIOLATION' }).success).toBe(false);
    expect(FlowInnerRefusalSchema.safeParse({ message: INNER.message }).success).toBe(false);
  });

  it('AutomationResult mirrors both members on the trigger response data (the #13078 parity)', () => {
    const result = TriggerFlowResponseSchema.parse({
      success: true,
      data: { success: false, status: 'failed', error: "Node 'create_account' failed", userMessage: USER_MESSAGE, innerRefusal: INNER },
    });
    expect(result.data.userMessage).toBe(USER_MESSAGE);
    expect(result.data.innerRefusal).toEqual(INNER);
    expect(TriggerFlowResponseSchema.safeParse({
      success: true,
      data: { success: false, innerRefusal: { code: 'ER_DUP_ENTRY', message: 'x' } },
    }).success).toBe(false);
  });
});

// ==========================================
// Toggle Flow
// ==========================================

describe('ToggleFlowRequestSchema', () => {
  it('should accept enable request', () => {
    const result = ToggleFlowRequestSchema.parse({
      name: 'my_flow',
      enabled: true,
    });
    expect(result.enabled).toBe(true);
  });

  it('should accept disable request', () => {
    const result = ToggleFlowRequestSchema.parse({
      name: 'my_flow',
      enabled: false,
    });
    expect(result.enabled).toBe(false);
  });

  it('should reject missing enabled field', () => {
    expect(() => ToggleFlowRequestSchema.parse({ name: 'my_flow' })).toThrow();
  });
});

describe('ToggleFlowResponseSchema', () => {
  it('should accept a valid response', () => {
    const result = ToggleFlowResponseSchema.parse({
      success: true,
      data: { name: 'my_flow', enabled: true },
    });
    expect(result.data.enabled).toBe(true);
  });
});

// ==========================================
// List Runs
// ==========================================

describe('ListRunsRequestSchema', () => {
  it('should accept minimal request', () => {
    const result = ListRunsRequestSchema.parse({ name: 'my_flow' });
    expect(result.limit).toBe(20);
    expect(result.status).toBeUndefined();
  });

  it('should accept full request', () => {
    // `cursor` left this fixture when it was retired (#19543) — it is a
    // `retiredKey()` tombstone now and any value raises. Its own cases are the
    // block at the end of this describe.
    const result = ListRunsRequestSchema.parse({
      name: 'my_flow',
      status: 'completed',
      limit: 5,
    });
    expect(result.status).toBe('completed');
    expect(result.limit).toBe(5);
  });

  it('should reject invalid status', () => {
    expect(() => ListRunsRequestSchema.parse({
      name: 'my_flow',
      status: 'success',
    })).toThrow();
  });

  it('declares exactly the canonical ExecutionStatus set', () => {
    // The wire's filter and the runtime boundary that now enforces it must
    // accept ONE set. The boundary reads `ExecutionStatus.options`; this pins
    // that the schema does too, so a member added to the enum cannot end up
    // advertised by one and refused with a 400 by the other. The members used
    // to be re-listed inline here — identical, but only by hand.
    for (const member of ExecutionStatus.options) {
      expect(
        () => ListRunsRequestSchema.parse({ name: 'my_flow', status: member }),
        `?status=${member} is a declared ExecutionStatus but the request schema refuses it`,
      ).not.toThrow();
    }
  });

  // ── #19543 ───────────────────────────────────────────────────────────────
  // `cursor` retires; `limit` explicitly does NOT. Both halves are pinned,
  // because the card that retired `cursor` arrived claiming `limit` was
  // equally inert and the measurement said otherwise.
  describe('`cursor` is retired, and the tombstone is what makes that audible', () => {
    it('raises the PRESCRIPTION, not a generic unrecognized-key issue', () => {
      // The negative half. A bare deletion would have been silent on this
      // non-strict object — Zod strips an unknown key and parses clean — so
      // the assertion that matters is the TEXT a caller is handed, which is
      // the only upgrade channel a generated client ever reads. The `s` flag
      // is house style: the message spans lines.
      expect(() => ListRunsRequestSchema.parse({ name: 'my_flow', cursor: 'page2' }))
        .toThrow(/`cursor`.*removed.*Delete the key.*`limit`.*STAYS/s);
    });

    it('refuses EVERY spelling, including the empty string the boundary used to pass through', () => {
      // `?cursor=` reached the service verbatim before this retirement (the
      // runtime pinned it as a preservation row), so the empty string is the
      // one value a caller is most likely to still be sending.
      for (const value of ['page2', '', 'n_007']) {
        expect(
          () => ListRunsRequestSchema.parse({ name: 'my_flow', cursor: value }),
          `cursor=${JSON.stringify(value)} parsed instead of raising the tombstone`,
        ).toThrow(/removed/);
      }
    });

    it('leaves no `cursor` behind on a request that omits it', () => {
      // The positive half for the non-strict strip path: the tombstone must
      // not materialize a key of its own onto a clean parse.
      const result = ListRunsRequestSchema.parse({ name: 'my_flow' });
      expect(result).not.toHaveProperty('cursor');
    });

    it('⛔ does NOT retire `limit`, and keeps its `.default(20)`', () => {
      // The over-block guard. #17667 retired `limit` AND `cursor` together on
      // the sibling `/packages` door because neither was read there; the
      // ruling for THIS door (decision batch #204 item 2, letter C) says that
      // does not transfer, because here `limit` is read end to end — the
      // runtime boundary takes its 1..100 bounds off this very declaration
      // and the engine spends it as the run store's history window. A sweep
      // that "finishes the job" by deleting it fails here.
      const bare = ListRunsRequestSchema.parse({ name: 'my_flow' });
      expect(bare.limit).toBe(20);
      expect(() => ListRunsRequestSchema.parse({ name: 'my_flow', limit: 50 })).not.toThrow();
      expect(ListRunsRequestSchema.parse({ name: 'my_flow', limit: 50 }).limit).toBe(50);
      // The declared range the boundary reads back off this schema.
      expect(() => ListRunsRequestSchema.parse({ name: 'my_flow', limit: 0 })).toThrow();
      expect(() => ListRunsRequestSchema.parse({ name: 'my_flow', limit: 101 })).toThrow();
    });
  });
});

describe('ListRunsResponseSchema', () => {
  it('should accept a response with execution logs', () => {
    const result = ListRunsResponseSchema.parse({
      success: true,
      data: {
        runs: [{
          id: 'exec_001',
          flowName: 'my_flow',
          status: 'completed',
          trigger: { type: 'api' },
          steps: [],
          startedAt: '2026-02-01T10:00:00Z',
        }],
        hasMore: false,
      },
    });
    expect(result.data.runs).toHaveLength(1);
    expect(result.data.runs[0].status).toBe('completed');
  });
});

// ==========================================
// Get Run
// ==========================================

describe('GetRunRequestSchema', () => {
  it('should accept valid path params', () => {
    const result = GetRunRequestSchema.parse({ name: 'my_flow', runId: 'exec_001' });
    expect(result.name).toBe('my_flow');
    expect(result.runId).toBe('exec_001');
  });
});

describe('GetRunResponseSchema', () => {
  it('should accept a response with execution log and steps', () => {
    const result = GetRunResponseSchema.parse({
      success: true,
      data: {
        id: 'exec_001',
        flowName: 'my_flow',
        status: 'completed',
        trigger: { type: 'api', userId: 'user_123' },
        steps: [{
          nodeId: 'start',
          nodeType: 'start',
          status: 'success',
          startedAt: '2026-02-01T10:00:00Z',
          durationMs: 1,
        }],
        startedAt: '2026-02-01T10:00:00Z',
        completedAt: '2026-02-01T10:00:01Z',
        durationMs: 1000,
      },
    });
    expect(result.data.steps).toHaveLength(1);
    expect(result.data.durationMs).toBe(1000);
  });
});

// ==========================================
// Error Codes
// ==========================================

describe('AutomationApiErrorCode', () => {
  it('should accept all valid error codes', () => {
    const valid = [
      'flow_not_found', 'flow_already_exists', 'flow_validation_failed',
      'flow_disabled', 'execution_not_found', 'execution_failed',
      'execution_timeout', 'node_executor_not_found', 'concurrent_execution_limit',
    ];
    valid.forEach((v) => {
      expect(() => AutomationApiErrorCode.parse(v)).not.toThrow();
    });
  });

  it('should reject invalid error codes', () => {
    expect(() => AutomationApiErrorCode.parse('invalid_code')).toThrow();
  });
});

// ==========================================
// Contract Registry
// ==========================================

describe('AutomationApiContracts', () => {
  it('should define all 8 contract endpoints', () => {
    // 9 -> 8: `listFlows` (`GET /api/v1/automation`) retired with its route
    // (#19543) — flows are listed through `GET /api/v1/meta/flow`.
    expect(Object.keys(AutomationApiContracts)).toHaveLength(8);
  });

  it('declares no flow-list entry and no GET at the bare /api/v1/automation path', () => {
    expect(Object.keys(AutomationApiContracts)).not.toContain('listFlows');
    const routes = Object.values(AutomationApiContracts).map((c) => `${c.method} ${c.path}`);
    expect(routes).not.toContain('GET /api/v1/automation');
    // …while the create door at the same path survives, so the absence is the
    // one verb and not the whole path.
    expect(routes).toContain('POST /api/v1/automation');
  });

  it('should define correct HTTP methods', () => {
    expect(AutomationApiContracts.getFlow.method).toBe('GET');
    expect(AutomationApiContracts.createFlow.method).toBe('POST');
    expect(AutomationApiContracts.updateFlow.method).toBe('PUT');
    expect(AutomationApiContracts.deleteFlow.method).toBe('DELETE');
    expect(AutomationApiContracts.triggerFlow.method).toBe('POST');
    expect(AutomationApiContracts.toggleFlow.method).toBe('POST');
    expect(AutomationApiContracts.listRuns.method).toBe('GET');
    expect(AutomationApiContracts.getRun.method).toBe('GET');
  });

  it('should define correct paths', () => {
    expect(AutomationApiContracts.getFlow.path).toBe('/api/v1/automation/:name');
    expect(AutomationApiContracts.createFlow.path).toBe('/api/v1/automation');
    expect(AutomationApiContracts.updateFlow.path).toBe('/api/v1/automation/:name');
    expect(AutomationApiContracts.deleteFlow.path).toBe('/api/v1/automation/:name');
    expect(AutomationApiContracts.triggerFlow.path).toBe('/api/v1/automation/:name/trigger');
    expect(AutomationApiContracts.toggleFlow.path).toBe('/api/v1/automation/:name/toggle');
    expect(AutomationApiContracts.listRuns.path).toBe('/api/v1/automation/:name/runs');
    expect(AutomationApiContracts.getRun.path).toBe('/api/v1/automation/:name/runs/:runId');
  });

  it('should have input and output schemas for all endpoints', () => {
    for (const [key, contract] of Object.entries(AutomationApiContracts)) {
      expect(contract.input, `${key} should have input schema`).toBeDefined();
      expect(contract.output, `${key} should have output schema`).toBeDefined();
    }
  });
});
