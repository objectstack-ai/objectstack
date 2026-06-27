import { describe, it, expect } from 'vitest';
import {
  ExecutionStatus,
  ExecutionStepLogSchema,
  ExecutionLogSchema,
  ExecutionErrorSeverity,
  ExecutionErrorSchema,
  CheckpointSchema,
  ConcurrencyPolicySchema,
  ScheduleStateSchema,
} from './execution.zod';

// ==========================================
// Execution Status
// ==========================================

describe('ExecutionStatus', () => {
  it('should accept all valid statuses', () => {
    const valid = ['pending', 'running', 'paused', 'completed', 'failed', 'cancelled', 'timed_out', 'retrying'];
    valid.forEach((v) => {
      expect(() => ExecutionStatus.parse(v)).not.toThrow();
    });
  });

  it('should reject invalid statuses', () => {
    expect(() => ExecutionStatus.parse('active')).toThrow();
    expect(() => ExecutionStatus.parse('RUNNING')).toThrow();
    expect(() => ExecutionStatus.parse('')).toThrow();
  });
});

// ==========================================
// Execution Step Log
// ==========================================

describe('ExecutionStepLogSchema', () => {
  it('should accept a valid step log', () => {
    const step = ExecutionStepLogSchema.parse({
      nodeId: 'check_amount',
      nodeType: 'decision',
      status: 'success',
      startedAt: '2026-02-01T10:00:00Z',
      completedAt: '2026-02-01T10:00:01Z',
      durationMs: 5,
    });
    expect(step.nodeId).toBe('check_amount');
    expect(step.status).toBe('success');
    expect(step.durationMs).toBe(5);
  });

  it('should accept a step log with error details', () => {
    const step = ExecutionStepLogSchema.parse({
      nodeId: 'http',
      nodeType: 'http',
      nodeLabel: 'Call External API',
      status: 'failure',
      startedAt: '2026-02-01T10:00:00Z',
      error: {
        code: 'HTTP_TIMEOUT',
        message: 'Request timed out after 30s',
        stack: 'Error: Request timed out\n  at ...',
      },
      retryAttempt: 2,
    });
    expect(step.status).toBe('failure');
    expect(step.error?.code).toBe('HTTP_TIMEOUT');
    expect(step.retryAttempt).toBe(2);
  });

  it('should accept a step log with input/output', () => {
    const step = ExecutionStepLogSchema.parse({
      nodeId: 'transform',
      nodeType: 'assignment',
      status: 'success',
      startedAt: '2026-02-01T10:00:00Z',
      input: { recordId: 'rec_123' },
      output: { name: 'Acme Corp' },
    });
    expect(step.input).toEqual({ recordId: 'rec_123' });
    expect(step.output).toEqual({ name: 'Acme Corp' });
  });

  it('should reject missing required fields', () => {
    expect(() => ExecutionStepLogSchema.parse({
      nodeId: 'start',
      status: 'success',
      startedAt: '2026-02-01T10:00:00Z',
    })).toThrow(); // missing nodeType

    expect(() => ExecutionStepLogSchema.parse({
      nodeId: 'start',
      nodeType: 'start',
      startedAt: '2026-02-01T10:00:00Z',
    })).toThrow(); // missing status
  });
});

// ==========================================
// Execution Log
// ==========================================

describe('ExecutionLogSchema', () => {
  const validStep = {
    nodeId: 'start',
    nodeType: 'start',
    status: 'success' as const,
    startedAt: '2026-02-01T10:00:00Z',
    durationMs: 1,
  };

  it('should accept a full execution log', () => {
    const log = ExecutionLogSchema.parse({
      id: 'exec_001',
      flowName: 'approve_order_flow',
      flowVersion: 1,
      status: 'completed',
      trigger: {
        type: 'record_change',
        recordId: 'rec_123',
        object: 'order',
        userId: 'user_456',
        metadata: { source: 'UI' },
      },
      steps: [validStep],
      variables: { approved: true, amount: 5000 },
      startedAt: '2026-02-01T10:00:00Z',
      completedAt: '2026-02-01T10:00:01Z',
      durationMs: 1050,
      runAs: 'user',
      tenantId: 'tenant_abc',
    });
    expect(log.id).toBe('exec_001');
    expect(log.status).toBe('completed');
    expect(log.steps).toHaveLength(1);
    expect(log.variables?.approved).toBe(true);
    expect(log.runAs).toBe('user');
  });

  it('should accept a minimal execution log', () => {
    const log = ExecutionLogSchema.parse({
      id: 'exec_002',
      flowName: 'simple_flow',
      status: 'pending',
      trigger: { type: 'manual' },
      steps: [],
      startedAt: '2026-02-01T10:00:00Z',
    });
    expect(log.flowVersion).toBeUndefined();
    expect(log.completedAt).toBeUndefined();
    expect(log.runAs).toBeUndefined();
  });

  it('should reject missing required fields', () => {
    expect(() => ExecutionLogSchema.parse({
      flowName: 'test_flow',
      status: 'pending',
      trigger: { type: 'manual' },
      steps: [],
      startedAt: '2026-02-01T10:00:00Z',
    })).toThrow(); // missing id

    expect(() => ExecutionLogSchema.parse({
      id: 'exec_003',
      flowName: 'test_flow',
      status: 'pending',
      steps: [],
      startedAt: '2026-02-01T10:00:00Z',
    })).toThrow(); // missing trigger
  });
});

// ==========================================
// Execution Error
// ==========================================

describe('ExecutionErrorSchema', () => {
  it('should accept a valid error', () => {
    const error = ExecutionErrorSchema.parse({
      id: 'err_001',
      executionId: 'exec_001',
      nodeId: 'http',
      severity: 'error',
      code: 'HTTP_TIMEOUT',
      message: 'Request timed out after 30s',
      stack: 'Error: timeout\n  at ...',
      context: { url: 'https://api.example.com', retries: 3 },
      timestamp: '2026-02-01T10:00:05Z',
      retryable: true,
    });
    expect(error.id).toBe('err_001');
    expect(error.severity).toBe('error');
    expect(error.retryable).toBe(true);
    expect(error.context?.url).toBe('https://api.example.com');
  });

  it('should apply default for retryable', () => {
    const error = ExecutionErrorSchema.parse({
      id: 'err_002',
      executionId: 'exec_001',
      severity: 'critical',
      code: 'FLOW_TERMINATED',
      message: 'Flow terminated unexpectedly',
      timestamp: '2026-02-01T10:00:05Z',
    });
    expect(error.retryable).toBe(false);
  });

  it('should reject missing required fields', () => {
    expect(() => ExecutionErrorSchema.parse({
      id: 'err_003',
      severity: 'error',
      code: 'TEST',
      message: 'Test',
      timestamp: '2026-02-01T10:00:05Z',
    })).toThrow(); // missing executionId

    expect(() => ExecutionErrorSchema.parse({
      id: 'err_004',
      executionId: 'exec_001',
      severity: 'error',
      message: 'Test',
      timestamp: '2026-02-01T10:00:05Z',
    })).toThrow(); // missing code
  });

  it('should accept all valid severity levels', () => {
    const valid = ['warning', 'error', 'critical'];
    valid.forEach((v) => {
      expect(() => ExecutionErrorSeverity.parse(v)).not.toThrow();
    });
  });

  it('should reject invalid severity', () => {
    expect(() => ExecutionErrorSeverity.parse('info')).toThrow();
  });
});

// ==========================================
// Checkpoint
// ==========================================

describe('CheckpointSchema', () => {
  it('should accept a valid checkpoint', () => {
    const cp = CheckpointSchema.parse({
      id: 'cp_001',
      executionId: 'exec_001',
      flowName: 'approval_flow',
      currentNodeId: 'wait_for_approval',
      variables: { orderId: 'ord_123', amount: 5000 },
      completedNodeIds: ['start', 'check_amount'],
      createdAt: '2026-02-01T10:00:00Z',
      expiresAt: '2026-02-08T10:00:00Z',
      reason: 'approval',
    });
    expect(cp.id).toBe('cp_001');
    expect(cp.currentNodeId).toBe('wait_for_approval');
    expect(cp.completedNodeIds).toHaveLength(2);
    expect(cp.reason).toBe('approval');
  });

  it('should accept all valid checkpoint reasons', () => {
    const reasons = ['wait', 'screen_input', 'approval', 'error', 'manual_pause', 'parallel_join', 'boundary_event'];
    reasons.forEach((r) => {
      const cp = CheckpointSchema.parse({
        id: 'cp_test',
        executionId: 'exec_test',
        flowName: 'test_flow',
        currentNodeId: 'node_1',
        variables: {},
        completedNodeIds: [],
        createdAt: '2026-02-01T10:00:00Z',
        reason: r,
      });
      expect(cp.reason).toBe(r);
    });
  });

  it('should reject missing required fields', () => {
    expect(() => CheckpointSchema.parse({
      id: 'cp_002',
      flowName: 'test',
      currentNodeId: 'node_1',
      variables: {},
      completedNodeIds: [],
      createdAt: '2026-02-01T10:00:00Z',
      reason: 'wait',
    })).toThrow(); // missing executionId

    expect(() => CheckpointSchema.parse({
      id: 'cp_003',
      executionId: 'exec_001',
      flowName: 'test',
      currentNodeId: 'node_1',
      variables: {},
      completedNodeIds: [],
      createdAt: '2026-02-01T10:00:00Z',
    })).toThrow(); // missing reason
  });
});

// ==========================================
// Concurrency Policy
// ==========================================

describe('ConcurrencyPolicySchema', () => {
  it('should apply defaults when no fields provided', () => {
    const policy = ConcurrencyPolicySchema.parse({});
    expect(policy.maxConcurrent).toBe(1);
    expect(policy.onConflict).toBe('queue');
    expect(policy.lockScope).toBe('global');
    expect(policy.queueTimeoutMs).toBeUndefined();
  });

  it('should accept all fields explicitly set', () => {
    const policy = ConcurrencyPolicySchema.parse({
      maxConcurrent: 5,
      onConflict: 'reject',
      lockScope: 'per_record',
      queueTimeoutMs: 30000,
    });
    expect(policy.maxConcurrent).toBe(5);
    expect(policy.onConflict).toBe('reject');
    expect(policy.lockScope).toBe('per_record');
    expect(policy.queueTimeoutMs).toBe(30000);
  });

  it('should accept all valid onConflict values', () => {
    const valid = ['queue', 'reject', 'cancel_existing'];
    valid.forEach((v) => {
      expect(() => ConcurrencyPolicySchema.parse({ onConflict: v })).not.toThrow();
    });
  });

  it('should accept all valid lockScope values', () => {
    const valid = ['global', 'per_record', 'per_user'];
    valid.forEach((v) => {
      expect(() => ConcurrencyPolicySchema.parse({ lockScope: v })).not.toThrow();
    });
  });

  it('should reject invalid enum values', () => {
    expect(() => ConcurrencyPolicySchema.parse({ onConflict: 'abort' })).toThrow();
    expect(() => ConcurrencyPolicySchema.parse({ lockScope: 'per_tenant' })).toThrow();
  });

  it('should reject maxConcurrent less than 1', () => {
    expect(() => ConcurrencyPolicySchema.parse({ maxConcurrent: 0 })).toThrow();
  });
});

// ==========================================
// Schedule State
// ==========================================

describe('ScheduleStateSchema', () => {
  it('should accept a valid schedule state', () => {
    const state = ScheduleStateSchema.parse({
      id: 'sched_001',
      flowName: 'daily_report',
      cronExpression: '0 9 * * MON-FRI',
      timezone: 'America/New_York',
      status: 'active',
      nextRunAt: '2026-02-03T14:00:00Z',
      lastRunAt: '2026-01-31T14:00:00Z',
      lastExecutionId: 'exec_100',
      lastRunStatus: 'completed',
      totalRuns: 42,
      consecutiveFailures: 0,
      startDate: '2026-01-01T00:00:00Z',
      endDate: '2026-12-31T23:59:59Z',
      maxRuns: 365,
      createdAt: '2025-12-01T00:00:00Z',
      updatedAt: '2026-01-31T14:00:05Z',
      createdBy: 'user_admin',
    });
    expect(state.id).toBe('sched_001');
    expect(state.cronExpression).toEqual({ dialect: 'cron', source: '0 9 * * MON-FRI' });
    expect(state.totalRuns).toBe(42);
    expect(state.timezone).toBe('America/New_York');
  });

  it('should apply defaults', () => {
    const state = ScheduleStateSchema.parse({
      id: 'sched_002',
      flowName: 'weekly_sync',
      cronExpression: '0 6 * * MON',
      createdAt: '2026-01-01T00:00:00Z',
    });
    expect(state.timezone).toBe('UTC');
    expect(state.status).toBe('active');
    expect(state.totalRuns).toBe(0);
    expect(state.consecutiveFailures).toBe(0);
  });

  it('should accept all valid schedule statuses', () => {
    const valid = ['active', 'paused', 'disabled', 'expired'];
    valid.forEach((v) => {
      const state = ScheduleStateSchema.parse({
        id: 'sched_test',
        flowName: 'test',
        cronExpression: '* * * * *',
        createdAt: '2026-01-01T00:00:00Z',
        status: v,
      });
      expect(state.status).toBe(v);
    });
  });

  it('should reject missing required fields', () => {
    expect(() => ScheduleStateSchema.parse({
      flowName: 'test',
      cronExpression: '* * * * *',
      createdAt: '2026-01-01T00:00:00Z',
    })).toThrow(); // missing id

    expect(() => ScheduleStateSchema.parse({
      id: 'sched_003',
      cronExpression: '* * * * *',
      createdAt: '2026-01-01T00:00:00Z',
    })).toThrow(); // missing flowName

    expect(() => ScheduleStateSchema.parse({
      id: 'sched_004',
      flowName: 'test',
      createdAt: '2026-01-01T00:00:00Z',
    })).toThrow(); // missing cronExpression
  });
});
