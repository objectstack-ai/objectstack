import { describe, it, expect } from 'vitest';
import {
  RuntimeMode,
  KernelContextSchema,
  TenantRuntimeContextSchema,
  type KernelContext,
  type TenantRuntimeContext,
} from './context.zod';

describe('RuntimeMode', () => {
  it('should accept valid runtime modes', () => {
    expect(() => RuntimeMode.parse('development')).not.toThrow();
    expect(() => RuntimeMode.parse('production')).not.toThrow();
    expect(() => RuntimeMode.parse('test')).not.toThrow();
    expect(() => RuntimeMode.parse('provisioning')).not.toThrow();
  });

  it('should reject invalid runtime modes', () => {
    expect(() => RuntimeMode.parse('staging')).toThrow();
    expect(() => RuntimeMode.parse('debug')).toThrow();
    expect(() => RuntimeMode.parse('')).toThrow();
    // 'preview' was RETIRED (#11846) — the full prescription pins live in
    // preview-mode-retirement.test.ts; this list only records the narrowing.
    expect(() => RuntimeMode.parse('preview')).toThrow();
  });
});

describe('KernelContextSchema', () => {
  const validContext: KernelContext = {
    instanceId: '550e8400-e29b-41d4-a716-446655440000',
    mode: 'production',
    version: '1.0.0',
    cwd: '/app',
    startTime: Date.now(),
    features: {},
  };

  it('should accept valid minimal context', () => {
    expect(() => KernelContextSchema.parse(validContext)).not.toThrow();
  });

  it('should accept context with all optional fields', () => {
    const full = {
      ...validContext,
      appName: 'My App',
      workspaceRoot: '/workspace',
    };
    const parsed = KernelContextSchema.parse(full);
    expect(parsed.appName).toBe('My App');
    expect(parsed.workspaceRoot).toBe('/workspace');
  });

  it('should apply default mode to production', () => {
    const { mode: _, ...withoutMode } = validContext;
    const parsed = KernelContextSchema.parse(withoutMode);
    expect(parsed.mode).toBe('production');
  });

  it('should apply default features to empty record', () => {
    const { features: _, ...withoutFeatures } = validContext;
    const parsed = KernelContextSchema.parse(withoutFeatures);
    expect(parsed.features).toEqual({});
  });

  it('should accept feature flags', () => {
    const ctx = {
      ...validContext,
      features: { darkMode: true, beta: false },
    };
    const parsed = KernelContextSchema.parse(ctx);
    expect(parsed.features.darkMode).toBe(true);
    expect(parsed.features.beta).toBe(false);
  });

  it('should reject invalid instanceId (not UUID)', () => {
    expect(() => KernelContextSchema.parse({
      ...validContext,
      instanceId: 'not-a-uuid',
    })).toThrow();
  });

  it('should reject missing required fields', () => {
    expect(() => KernelContextSchema.parse({})).toThrow();
    expect(() => KernelContextSchema.parse({ instanceId: '550e8400-e29b-41d4-a716-446655440000' })).toThrow();
  });

  it('should reject non-integer startTime', () => {
    expect(() => KernelContextSchema.parse({
      ...validContext,
      startTime: 1.5,
    })).toThrow();
  });

  it('should accept all runtime modes in context', () => {
    // 'preview' left this list in #11846 — see preview-mode-retirement.test.ts.
    const modes = ['development', 'production', 'test', 'provisioning'] as const;
    modes.forEach(mode => {
      const parsed = KernelContextSchema.parse({ ...validContext, mode });
      expect(parsed.mode).toBe(mode);
    });
  });

  it('should accept a context that does not author previewMode (retired key, absence is legal)', () => {
    const parsed = KernelContextSchema.parse(validContext);
    // The non-strict strip path: absence must stay absence. The retirement
    // pins for the AUTHORED case live in preview-mode-retirement.test.ts.
    expect(parsed).not.toHaveProperty('previewMode');
  });
});

describe('TenantRuntimeContextSchema', () => {
  const baseContext = {
    instanceId: '550e8400-e29b-41d4-a716-446655440000',
    mode: 'production' as const,
    version: '1.0.0',
    cwd: '/app',
    startTime: Date.now(),
    features: {},
  };

  it('should accept valid tenant runtime context', () => {
    const ctx: TenantRuntimeContext = {
      ...baseContext,
      tenantId: 'tenant_abc',
      tenantPlan: 'pro',
      tenantRegion: 'us-east',
      tenantDbUrl: 'libsql://tenant-abc-myorg.turso.io',
    };
    const parsed = TenantRuntimeContextSchema.parse(ctx);
    expect(parsed.tenantId).toBe('tenant_abc');
    expect(parsed.tenantPlan).toBe('pro');
    expect(parsed.tenantRegion).toBe('us-east');
    expect(parsed.tenantDbUrl).toContain('turso.io');
    // Inherited from KernelContextSchema
    expect(parsed.instanceId).toBe('550e8400-e29b-41d4-a716-446655440000');
    expect(parsed.mode).toBe('production');
  });

  it('should accept all tenant plans', () => {
    const plans = ['free', 'pro', 'enterprise'] as const;
    plans.forEach((plan) => {
      const parsed = TenantRuntimeContextSchema.parse({
        ...baseContext,
        tenantId: 'tenant_test',
        tenantPlan: plan,
        tenantRegion: 'eu-west',
        tenantDbUrl: 'libsql://test.turso.io',
      });
      expect(parsed.tenantPlan).toBe(plan);
    });
  });

  it('should reject missing tenant fields', () => {
    // Missing tenantId
    expect(() => TenantRuntimeContextSchema.parse({
      ...baseContext,
      tenantPlan: 'free',
      tenantDbUrl: 'libsql://test.turso.io',
    })).toThrow();
  });

  it('should reject empty tenantId', () => {
    expect(() => TenantRuntimeContextSchema.parse({
      ...baseContext,
      tenantId: '',
      tenantPlan: 'free',
      tenantDbUrl: 'libsql://test.turso.io',
    })).toThrow();
  });

  it('should reject invalid tenant plan', () => {
    expect(() => TenantRuntimeContextSchema.parse({
      ...baseContext,
      tenantId: 'tenant_test',
      tenantPlan: 'basic',
      tenantDbUrl: 'libsql://test.turso.io',
    })).toThrow();
  });

  it('should accept tenant context with tenantQuotas', () => {
    const parsed = TenantRuntimeContextSchema.parse({
      ...baseContext,
      tenantId: 'tenant_quota',
      tenantPlan: 'enterprise',
      tenantRegion: 'eu-west',
      tenantDbUrl: 'libsql://quota.turso.io',
      tenantQuotas: {
        maxUsers: 500,
        maxStorage: 53687091200,
        apiRateLimit: 5000,
        maxObjects: 100,
        maxRecordsPerObject: 1000000,
        maxDeploymentsPerDay: 50,
      },
    });
    expect(parsed.tenantQuotas).toBeDefined();
    expect(parsed.tenantQuotas?.maxUsers).toBe(500);
    expect(parsed.tenantQuotas?.maxObjects).toBe(100);
  });

  it('should accept tenant context without tenantQuotas (optional)', () => {
    const parsed = TenantRuntimeContextSchema.parse({
      ...baseContext,
      tenantId: 'tenant_noquota',
      tenantPlan: 'free',
      tenantDbUrl: 'libsql://noquota.turso.io',
    });
    expect(parsed.tenantQuotas).toBeUndefined();
    expect(parsed.tenantRegion).toBeUndefined();
  });
});
