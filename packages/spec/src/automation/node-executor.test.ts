import { describe, it, expect } from 'vitest';
import {
  WaitEventTypeSchema,
  WaitResumePayloadSchema,
  WaitTimeoutBehaviorSchema,
  WaitExecutorConfigSchema,
  NodeExecutorDescriptorSchema,
  WAIT_EXECUTOR_DESCRIPTOR,
  type WaitResumePayload,
  type WaitExecutorConfig,
  type NodeExecutorDescriptor,
} from './node-executor.zod';

// ---------------------------------------------------------------------------
// WaitEventTypeSchema
// ---------------------------------------------------------------------------
describe('WaitEventTypeSchema', () => {
  it('should accept all event types', () => {
    const types = ['timer', 'signal', 'webhook', 'manual', 'condition'];
    types.forEach(t => {
      expect(WaitEventTypeSchema.parse(t)).toBe(t);
    });
  });

  it('should reject invalid event type', () => {
    expect(() => WaitEventTypeSchema.parse('unknown')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// WaitResumePayloadSchema
// ---------------------------------------------------------------------------
describe('WaitResumePayloadSchema', () => {
  it('should accept minimal timer resume payload', () => {
    const payload: WaitResumePayload = WaitResumePayloadSchema.parse({
      executionId: 'exec_001',
      checkpointId: 'cp_001',
      nodeId: 'wait_timer',
      eventType: 'timer',
      resumedAt: '2026-02-22T10:00:00Z',
    });
    expect(payload.executionId).toBe('exec_001');
    expect(payload.eventType).toBe('timer');
  });

  it('should accept signal resume with signal name', () => {
    const payload = WaitResumePayloadSchema.parse({
      executionId: 'exec_002',
      checkpointId: 'cp_002',
      nodeId: 'wait_signal',
      eventType: 'signal',
      signalName: 'payment_received',
      resumedBy: 'system',
      resumedAt: '2026-02-22T10:05:00Z',
    });
    expect(payload.signalName).toBe('payment_received');
    expect(payload.resumedBy).toBe('system');
  });

  it('should accept webhook resume with payload data', () => {
    const payload = WaitResumePayloadSchema.parse({
      executionId: 'exec_003',
      checkpointId: 'cp_003',
      nodeId: 'wait_webhook',
      eventType: 'webhook',
      webhookPayload: {
        status: 'approved',
        approver: 'user_123',
        timestamp: '2026-02-22T11:00:00Z',
      },
      resumedAt: '2026-02-22T11:00:00Z',
    });
    expect(payload.webhookPayload?.status).toBe('approved');
  });

  it('should accept manual resume with variables', () => {
    const payload = WaitResumePayloadSchema.parse({
      executionId: 'exec_004',
      checkpointId: 'cp_004',
      nodeId: 'wait_manual',
      eventType: 'manual',
      resumedBy: 'admin_user',
      resumedAt: '2026-02-22T12:00:00Z',
      variables: {
        approved: true,
        reason: 'Looks good',
      },
    });
    expect(payload.variables?.approved).toBe(true);
    expect(payload.resumedBy).toBe('admin_user');
  });

  it('should accept condition resume', () => {
    const payload = WaitResumePayloadSchema.parse({
      executionId: 'exec_005',
      checkpointId: 'cp_005',
      nodeId: 'wait_condition',
      eventType: 'condition',
      resumedAt: '2026-02-22T13:00:00Z',
    });
    expect(payload.eventType).toBe('condition');
  });

  it('should reject without required fields', () => {
    expect(() => WaitResumePayloadSchema.parse({})).toThrow();
    expect(() => WaitResumePayloadSchema.parse({
      executionId: 'exec_001',
    })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// WaitTimeoutBehaviorSchema
// ---------------------------------------------------------------------------
describe('WaitTimeoutBehaviorSchema', () => {
  it('should accept all timeout behaviors', () => {
    ['fail', 'continue', 'fallback'].forEach(b => {
      expect(WaitTimeoutBehaviorSchema.parse(b)).toBe(b);
    });
  });
});

// ---------------------------------------------------------------------------
// WaitExecutorConfigSchema
// ---------------------------------------------------------------------------
describe('WaitExecutorConfigSchema', () => {
  it('should accept empty config with defaults', () => {
    const config: WaitExecutorConfig = WaitExecutorConfigSchema.parse({});
    expect(config.defaultTimeoutMs).toBe(86400000);
    expect(config.defaultTimeoutBehavior).toBe('fail');
    expect(config.conditionPollIntervalMs).toBe(30000);
    expect(config.conditionMaxPolls).toBe(0);
    expect(config.webhookUrlPattern).toBe('/api/v1/automation/resume/{executionId}/{nodeId}');
    expect(config.persistCheckpoints).toBe(true);
    expect(config.maxPausedExecutions).toBe(0);
  });

  it('should accept custom config', () => {
    const config = WaitExecutorConfigSchema.parse({
      defaultTimeoutMs: 3600000,
      defaultTimeoutBehavior: 'continue',
      conditionPollIntervalMs: 10000,
      conditionMaxPolls: 100,
      webhookUrlPattern: '/hooks/resume/{executionId}',
      persistCheckpoints: true,
      maxPausedExecutions: 500,
    });
    expect(config.defaultTimeoutMs).toBe(3600000);
    expect(config.conditionPollIntervalMs).toBe(10000);
    expect(config.maxPausedExecutions).toBe(500);
  });

  it('should reject polling interval below minimum', () => {
    expect(() => WaitExecutorConfigSchema.parse({
      conditionPollIntervalMs: 500,
    })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// NodeExecutorDescriptorSchema
// ---------------------------------------------------------------------------
describe('NodeExecutorDescriptorSchema', () => {
  it('should accept a valid executor descriptor', () => {
    const desc: NodeExecutorDescriptor = NodeExecutorDescriptorSchema.parse({
      id: 'custom:script-executor',
      name: 'Script Executor',
      nodeTypes: ['script'],
      version: '1.0.0',
    });
    expect(desc.id).toBe('custom:script-executor');
    expect(desc.supportsPause).toBe(false); // default
    expect(desc.supportsRetry).toBe(true); // default
  });

  it('should accept executor with all features', () => {
    const desc = NodeExecutorDescriptorSchema.parse({
      id: 'objectstack:http-executor',
      name: 'HTTP Request Executor',
      nodeTypes: ['http', 'connector_action'],
      version: '2.0.0',
      description: 'Executes HTTP requests and connector actions',
      supportsPause: false,
      supportsCancellation: true,
      supportsRetry: true,
      configSchemaRef: '#/definitions/HttpExecutorConfig',
    });
    expect(desc.nodeTypes).toContain('http');
    expect(desc.nodeTypes).toContain('connector_action');
    expect(desc.supportsCancellation).toBe(true);
  });

  it('should reject empty nodeTypes', () => {
    expect(() => NodeExecutorDescriptorSchema.parse({
      id: 'bad',
      name: 'Bad',
      nodeTypes: [],
      version: '1.0.0',
    })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// WAIT_EXECUTOR_DESCRIPTOR
// ---------------------------------------------------------------------------
describe('WAIT_EXECUTOR_DESCRIPTOR', () => {
  it('should be a valid NodeExecutorDescriptor', () => {
    expect(() => NodeExecutorDescriptorSchema.parse(WAIT_EXECUTOR_DESCRIPTOR)).not.toThrow();
  });

  it('should handle wait node type', () => {
    expect(WAIT_EXECUTOR_DESCRIPTOR.nodeTypes).toContain('wait');
  });

  it('should support pause and cancellation', () => {
    expect(WAIT_EXECUTOR_DESCRIPTOR.supportsPause).toBe(true);
    expect(WAIT_EXECUTOR_DESCRIPTOR.supportsCancellation).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Scenario: Wait Pause/Resume Flow
// ---------------------------------------------------------------------------
describe('Wait Executor — pause/resume scenario', () => {
  it('should model a full wait → checkpoint → resume lifecycle', () => {
    // 1. Configure the wait executor
    const config = WaitExecutorConfigSchema.parse({
      defaultTimeoutMs: 3600000,
      conditionPollIntervalMs: 15000,
      persistCheckpoints: true,
    });
    expect(config.persistCheckpoints).toBe(true);

    // 2. Simulate a webhook resume
    const resume = WaitResumePayloadSchema.parse({
      executionId: 'exec_lifecycle_001',
      checkpointId: 'cp_lifecycle_001',
      nodeId: 'wait_webhook_approval',
      eventType: 'webhook',
      webhookPayload: {
        decision: 'approved',
        comments: 'All checks passed',
      },
      resumedBy: 'webhook_service',
      resumedAt: '2026-02-22T14:00:00Z',
      variables: {
        approval_status: 'approved',
      },
    });

    expect(resume.eventType).toBe('webhook');
    expect(resume.variables?.approval_status).toBe('approved');
  });
});
