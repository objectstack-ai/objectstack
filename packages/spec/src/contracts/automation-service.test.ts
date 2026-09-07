import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';
import type { IAutomationService, AutomationResult } from './automation-service';
import type { FlowParsed } from '../automation/flow.zod';
import { FlowSchema } from '../automation/flow.zod';
import type { ExecutionLog } from '../automation/execution.zod';
import type { ConnectorDescriptor } from '../integration/connector-descriptor';

/**
 * [#16495] Type-level identities for the two operator verbs (the #14384 pin's
 * form): a change to either signature — a dropped optional parameter, a
 * widened or narrowed result — turns an exported alias red under
 * `check:test-typecheck`, which compiles this file. Exported deliberately: an
 * unread alias inside a test body is TS6196, and a pin no program compiles is
 * no pin at all.
 */
type Eq<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
type CancelRun = NonNullable<IAutomationService['cancelRun']>;
type RestoreConsumedSuspension = NonNullable<IAutomationService['restoreConsumedSuspension']>;
/** `cancelRun(runId, reason?)` — the engine's shape, not the ruling's `cancelRun(runId)`. */
export type CancelRunTakesRunIdAndReason = Assert<Eq<Parameters<CancelRun>, [runId: string, reason?: string]>>;
export type CancelRunAnswersBoolean = Assert<Eq<ReturnType<CancelRun>, Promise<boolean>>>;
/** `restoreConsumedSuspension(runId, options?)` — who asked and why travel through the contract. */
export type RestoreTakesRunIdAndOptions = Assert<
  Eq<Parameters<RestoreConsumedSuspension>, [runId: string, options?: { requestedBy?: string; reason?: string }]>
>;
/** The narrower structural result (route (i)): restored, the id echoed, the refusal code, the one-sentence reason. */
export type RestoreAnswersTheNarrowResult = Assert<
  Eq<Awaited<ReturnType<RestoreConsumedSuspension>>, { restored: boolean; runId: string; refusal?: string; reason: string }>
>;

describe('Automation Service Contract', () => {
  it('should allow a minimal IAutomationService implementation with required methods', () => {
    const service: IAutomationService = {
      execute: async (_flowName, _context?) => ({ success: true }),
      listFlows: async () => [],
    };

    expect(typeof service.execute).toBe('function');
    expect(typeof service.listFlows).toBe('function');
  });

  it('should allow a full implementation with optional methods', () => {
    const service: IAutomationService = {
      execute: async () => ({ success: true }),
      listFlows: async () => [],
      // [#12206] `registerFlow` answers the canonicalized parsed flow it
      // stored — the same object `getFlow` serves; parsing IS the minimal
      // conforming implementation.
      registerFlow: (_name, definition) => FlowSchema.parse(definition),
      unregisterFlow: (_name) => {},
      getFlow: async (_name) => null,
      toggleFlow: async (_name, _enabled) => {},
      listRuns: async (_flowName, _options?) => [],
      getRun: async (_runId) => null,
    };

    expect(service.registerFlow).toBeDefined();
    expect(service.unregisterFlow).toBeDefined();
    expect(service.getFlow).toBeDefined();
    expect(service.toggleFlow).toBeDefined();
    expect(service.listRuns).toBeDefined();
    expect(service.getRun).toBeDefined();
  });

  it('should execute a flow successfully', async () => {
    const service: IAutomationService = {
      execute: async (flowName, context?): Promise<AutomationResult> => {
        return {
          success: true,
          output: { flowName, recordId: (context?.record as any)?.id },
          durationMs: 42,
        };
      },
      listFlows: async () => ['send_welcome_email', 'update_status'],
    };

    const result = await service.execute('send_welcome_email', {
      record: { id: 'rec-1', name: 'Alice' },
      object: 'contact',
      event: 'on_create',
    });

    expect(result.success).toBe(true);
    expect(result.output).toEqual({ flowName: 'send_welcome_email', recordId: 'rec-1' });
    expect(result.durationMs).toBe(42);
  });

  it('should handle execution failures', async () => {
    const service: IAutomationService = {
      execute: async () => ({
        success: false,
        error: 'Flow step 3 failed: timeout',
      }),
      listFlows: async () => [],
    };

    const result = await service.execute('broken_flow');
    expect(result.success).toBe(false);
    expect(result.error).toContain('timeout');
  });

  it('should list registered flows', async () => {
    const service: IAutomationService = {
      execute: async () => ({ success: true }),
      listFlows: async () => ['onboarding_flow', 'approval_flow', 'cleanup_flow'],
    };

    const flows = await service.listFlows();
    expect(flows).toHaveLength(3);
    expect(flows).toContain('approval_flow');
  });

  it('should return typed FlowParsed from getFlow', async () => {
    const mockFlow: FlowParsed = {
      name: 'approval_flow',
      label: 'Approval Flow',
      type: 'autolaunched',
      status: 'draft',
      version: 1,
      enabled: true,
      nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'end', type: 'end', label: 'End' },
      ],
      edges: [{ id: 'e1', source: 'start', target: 'end' }],
    };

    const service: IAutomationService = {
      execute: async () => ({ success: true }),
      listFlows: async () => ['approval_flow'],
      getFlow: async (name) => name === 'approval_flow' ? mockFlow : null,
    };

    const flow = await service.getFlow!('approval_flow');
    expect(flow).not.toBeNull();
    expect(flow!.name).toBe('approval_flow');
    expect(flow!.nodes).toHaveLength(2);

    const missing = await service.getFlow!('nonexistent');
    expect(missing).toBeNull();
  });

  it('should return typed ExecutionLog from listRuns and getRun', async () => {
    const mockRun: ExecutionLog = {
      id: 'exec_001',
      flowName: 'approval_flow',
      status: 'completed',
      trigger: { type: 'api' },
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
    };

    const service: IAutomationService = {
      execute: async () => ({ success: true }),
      listFlows: async () => ['approval_flow'],
      listRuns: async (_flowName, _options?) => [mockRun],
      getRun: async (runId) => runId === 'exec_001' ? mockRun : null,
    };

    const runs = await service.listRuns!('approval_flow');
    expect(runs).toHaveLength(1);
    expect(runs[0].id).toBe('exec_001');
    expect(runs[0].status).toBe('completed');
    expect(runs[0].steps).toHaveLength(1);

    const run = await service.getRun!('exec_001');
    expect(run).not.toBeNull();
    expect(run!.flowName).toBe('approval_flow');
    expect(run!.durationMs).toBe(1000);

    const missingRun = await service.getRun!('nonexistent');
    expect(missingRun).toBeNull();
  });

  it('should support toggleFlow to enable/disable flows', async () => {
    let flowEnabled = true;

    const service: IAutomationService = {
      execute: async () => ({ success: true }),
      listFlows: async () => ['test_flow'],
      toggleFlow: async (_name, enabled) => { flowEnabled = enabled; },
    };

    await service.toggleFlow!('test_flow', false);
    expect(flowEnabled).toBe(false);

    await service.toggleFlow!('test_flow', true);
    expect(flowEnabled).toBe(true);
  });

  // [#11504] The #10025 ruling's contract half: a definition-level
  // input-schema refusal is a NEVER-DISPATCHED exit with its own
  // `AutomationResult.code` member. The compile of the literal below IS the
  // assertion — the #9384 reverse verification run forward: before the union
  // widened, this exact string was a type error.
  it('should accept FLOW_INPUT_SCHEMA_INVALID as a never-dispatched trigger refusal', async () => {
    const service: IAutomationService = {
      execute: async (): Promise<AutomationResult> => ({
        success: false,
        code: 'FLOW_INPUT_SCHEMA_INVALID',
        error: "Node 'sync' config violates its declared inputSchema",
      }),
      listFlows: async () => ['guarded_flow'],
    };

    const result = await service.execute('guarded_flow');
    expect(result.success).toBe(false);
    expect(result.code).toBe('FLOW_INPUT_SCHEMA_INVALID');
    // Never dispatched ⇒ no lifecycle verdict, matching FLOW_DISABLED /
    // FLOW_NO_START_NODE (#9378): `status` absent is exactly what separates a
    // refused dispatch from a run that dispatched and failed.
    expect(result.status).toBeUndefined();
  });

  // [#4127] `getConnectorDescriptors` is the sibling of `getActionDescriptors`
  // — the other half of the flow designer's `connector_action` pickers — and
  // was the last of the four dispatcher routes calling a method the contract
  // did not declare. Typing the return value here is the assertion: the
  // descriptor must carry `origin` and `state`, so a shape that omits them no
  // longer compiles anywhere the contract is honoured.
  it('should return typed ConnectorDescriptor[] from getConnectorDescriptors', () => {
    const service: IAutomationService = {
      execute: async () => ({ success: true }),
      listFlows: async () => [],
      getConnectorDescriptors: (): ConnectorDescriptor[] => [
        {
          name: 'billing',
          label: 'Billing',
          type: 'api',
          origin: 'declarative',
          state: 'ready',
          actions: [{ key: 'request', label: 'Request', inputSchema: { type: 'object' } }],
        },
        {
          name: 'gh_mcp',
          label: 'GitHub MCP',
          type: 'api',
          origin: 'declarative',
          state: 'degraded',
          degradedReason: 'MCP server unreachable at boot',
          actions: [],
        },
      ],
    };

    const descriptors = service.getConnectorDescriptors!();
    expect(descriptors.map((d) => d.name)).toEqual(['billing', 'gh_mcp']);
    expect(descriptors[0].actions[0].key).toBe('request');
    // A degraded instance is listed rather than hidden (#3017), exposes no
    // actions, and says why.
    expect(descriptors[1].state).toBe('degraded');
    expect(descriptors[1].actions).toEqual([]);
    expect(descriptors[1].degradedReason).toBe('MCP server unreachable at boot');
  });

  // The registry is a flow-engine capability, not a property of every
  // automation slot: a script-runner implementation legitimately omits it, and
  // `GET /automation/connectors` answers an empty registry rather than 404.
  it('should allow an implementation that omits getConnectorDescriptors', () => {
    const service: IAutomationService = {
      execute: async () => ({ success: true }),
      listFlows: async () => [],
    };

    expect(service.getConnectorDescriptors).toBeUndefined();
  });

  // [#16495] The two operator run-lifecycle verbs — the contract half of
  // #13953's ruling A (maintainer 2026-09-05, decision batch #42). The same
  // shape of pin #14384 added for `'stranded'`: the members are declared,
  // OPTIONAL, typed as the engine implements them (not as the ruling's
  // `verb(runId)` shorthand), and their docblocks carry the ruling's
  // persistent-face statement. The type-level identities are the exported
  // aliases above the suite; the compile of the literals below is the rest.
  describe('[#16495] cancelRun / restoreConsumedSuspension — the operator verbs, declared', () => {
    it('are optional: the minimal implementation still conforms and has no operator door', () => {
      const service: IAutomationService = {
        execute: async () => ({ success: true }),
        listFlows: async () => [],
      };

      expect(service.cancelRun).toBeUndefined();
      expect(service.restoreConsumedSuspension).toBeUndefined();
    });

    it('carry the engine signatures through the contract — who asked, and why, reach the implementation', async () => {
      const seen: Array<Record<string, unknown>> = [];
      const service: IAutomationService = {
        execute: async () => ({ success: true }),
        listFlows: async () => [],
        cancelRun: async (runId: string, reason?: string): Promise<boolean> => {
          seen.push({ verb: 'cancelRun', runId, reason });
          return runId === 'run_paused';
        },
        restoreConsumedSuspension: async (runId, options) => {
          seen.push({ verb: 'restoreConsumedSuspension', runId, ...options });
          return runId === 'run_stranded'
            ? { restored: true, runId, reason: `Run '${runId}' is suspended again at node 'approve'` }
            : { restored: false, runId, refusal: 'RUN_NOT_FOUND', reason: `No run '${runId}' is known` };
        },
      };

      expect(await service.cancelRun!('run_paused', 'submitter withdrew the request')).toBe(true);
      // No suspended run under the id ⇒ `false`: idempotent success, not a throw.
      expect(await service.cancelRun!('run_gone')).toBe(false);

      const restored = await service.restoreConsumedSuspension!('run_stranded', {
        requestedBy: 'ops@example.com',
        reason: 'notify node fixed; the approval will be re-issued',
      });
      expect(restored.restored).toBe(true);
      expect(restored.runId).toBe('run_stranded');
      // `refusal` is absent exactly when `restored` is `true`.
      expect(restored.refusal).toBeUndefined();
      expect(restored.reason).toContain('run_stranded');

      const refused = await service.restoreConsumedSuspension!('run_gone');
      expect(refused.restored).toBe(false);
      expect(refused.refusal).toBe('RUN_NOT_FOUND');
      // `reason` is present both ways — the operator is told what was observed.
      expect(refused.reason).toBe("No run 'run_gone' is known");

      // The optional parameters ARE the reason the signatures follow the
      // engine: a door calling through the contract can say who asked and why.
      expect(seen).toEqual([
        { verb: 'cancelRun', runId: 'run_paused', reason: 'submitter withdrew the request' },
        { verb: 'cancelRun', runId: 'run_gone', reason: undefined },
        {
          verb: 'restoreConsumedSuspension',
          runId: 'run_stranded',
          requestedBy: 'ops@example.com',
          reason: 'notify node fixed; the approval will be re-issued',
        },
        { verb: 'restoreConsumedSuspension', runId: 'run_gone' },
      ]);
    });

    it('refuse a restore result that omits the always-present `reason` (compile-time, under check:test-typecheck)', () => {
      const service: IAutomationService = {
        execute: async () => ({ success: true }),
        listFlows: async () => [],
        // @ts-expect-error — `reason` is required both ways: an operator whose repair was refused must be told what was observed.
        restoreConsumedSuspension: async (runId) => ({ restored: false, runId, refusal: 'RUN_NOT_FOUND' }),
      };

      expect(service.restoreConsumedSuspension).toBeDefined();
    });

    it('the docblocks carry the persistent-face statement, the ruled permission posture, and the no-door-when-absent rule', () => {
      const source = readFileSync(fileURLToPath(new URL('./automation-service.ts', import.meta.url)), 'utf8');
      const docAbove = (declaration: string): string => {
        const at = source.indexOf(declaration);
        expect(at).toBeGreaterThan(-1);
        // The doc block immediately above the declaration — from its last `/**`.
        return source.slice(source.lastIndexOf('/**', at), at);
      };
      const cancel = docAbove('cancelRun?(runId: string, reason?: string): Promise<boolean>;');
      const restore = docAbove('restoreConsumedSuspension?(');

      for (const doc of [cancel, restore]) {
        // The ruling's persistent-face sentence, in its own words.
        expect(doc).toContain('listing and acting go through `sys_automation_run`');
        expect(doc).toMatch(/never engine memory/);
        // The ruled permission posture, so the door does not invent one.
        expect(doc).toContain('`platform_admin`');
        expect(doc).toMatch(/no new permission type, no[\s*]+per-run ownership/);
        // Optional ⇒ absent means no door, and the door refuses fail-closed.
        expect(doc).toMatch(/NO[\s*]+operator door/);
        expect(doc).toMatch(/refuse[\s*]+fail-closed/);
      }
      // Cancel: `false` is idempotent success — and an unreadable store lands there too.
      expect(cancel).toMatch(/idempotent/);
      expect(cancel).toMatch(/could[\s*]+not[\s*]+READ/);
      // Restore: the trace records who asked and why (the reason the signature
      // follows the engine), and the two things an operator must know.
      expect(restore).toContain('not recorded');
      expect(restore).toMatch(/NOT[\s*]+replayed/);
      expect(restore).toMatch(/NOT[\s*]+undone/);
      // Restore: the narrower-result decision is stated where it is read.
      expect(restore).toContain('SuspensionRestoreResult');
      expect(restore).toMatch(/route \(i\)/);
    });
  });
});
