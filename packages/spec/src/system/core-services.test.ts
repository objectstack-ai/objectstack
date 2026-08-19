import { describe, it, expect } from 'vitest';
import {
  CoreServiceName,
  ServiceCriticalitySchema,
  ServiceRequirementDef,
  KernelServiceStatusSchema,
  KernelServiceMapSchema,
  ServiceConfigSchema,
} from './core-services.zod';

describe('CoreServiceName', () => {
  it('should accept all valid service names', () => {
    // ('workflow' retired with its slot, #4451 v17. 'storage' is canonical
    // since the 2026-08-18 ruling on #9683; 'file-storage' stays accepted as
    // its deprecated v17 alias.)
    const services = [
      'metadata', 'data', 'auth',
      'storage', 'file-storage', 'search', 'cache', 'queue',
      'automation', 'analytics', 'realtime',
      'job', 'notification', 'ai', 'i18n', 'ui',
    ];

    services.forEach((service) => {
      expect(() => CoreServiceName.parse(service)).not.toThrow();
    });
  });

  it('should reject invalid service names', () => {
    expect(() => CoreServiceName.parse('invalid')).toThrow();
    expect(() => CoreServiceName.parse('database')).toThrow();
    expect(() => CoreServiceName.parse('')).toThrow();
  });
});

describe('ServiceCriticalitySchema', () => {
  it('should accept valid criticality levels', () => {
    const levels = ['required', 'core', 'optional'];

    levels.forEach((level) => {
      expect(() => ServiceCriticalitySchema.parse(level)).not.toThrow();
    });
  });

  it('should reject invalid criticality levels', () => {
    expect(() => ServiceCriticalitySchema.parse('invalid')).toThrow();
    expect(() => ServiceCriticalitySchema.parse('critical')).toThrow();
  });
});

describe('ServiceRequirementDef', () => {
  it('should define required services', () => {
    expect(ServiceRequirementDef.data).toBe('required');
    expect(ServiceRequirementDef.metadata).toBe('core');
    expect(ServiceRequirementDef.auth).toBe('core');
  });

  it('should define core services', () => {
    expect(ServiceRequirementDef.cache).toBe('core');
    expect(ServiceRequirementDef.queue).toBe('core');
    expect(ServiceRequirementDef.job).toBe('core');
    expect(ServiceRequirementDef.i18n).toBe('core');
  });

  it('should define optional services', () => {
    expect(ServiceRequirementDef.storage).toBe('optional');
    // Deprecated v17 alias of `storage` (#9683) — same criticality on purpose.
    expect(ServiceRequirementDef['file-storage']).toBe('optional');
    expect(ServiceRequirementDef.search).toBe('optional');
    expect(ServiceRequirementDef.automation).toBe('optional');
    expect(ServiceRequirementDef.analytics).toBe('optional');
    expect(ServiceRequirementDef.realtime).toBe('optional');
    expect(ServiceRequirementDef.notification).toBe('optional');
    expect(ServiceRequirementDef.ai).toBe('optional');
    expect(ServiceRequirementDef.ui).toBe('optional');
    // `workflow` retired with its slot (#4451, v17).
    expect(ServiceRequirementDef).not.toHaveProperty('workflow');
  });
});

describe('KernelServiceStatusSchema', () => {
  it('should accept valid service status', () => {
    const status = KernelServiceStatusSchema.parse({
      name: 'metadata',
      enabled: true,
      status: 'running',
    });

    expect(status.name).toBe('metadata');
    expect(status.enabled).toBe(true);
    expect(status.status).toBe('running');
  });

  it('should accept all status values', () => {
    const statuses = ['running', 'stopped', 'degraded', 'initializing'];

    statuses.forEach((s) => {
      expect(() => KernelServiceStatusSchema.parse({
        name: 'data',
        enabled: true,
        status: s,
      })).not.toThrow();
    });
  });

  it('should accept optional fields', () => {
    const status = KernelServiceStatusSchema.parse({
      name: 'file-storage',
      enabled: true,
      status: 'running',
      version: '1.0.0',
      provider: 's3',
      features: ['upload', 'download', 'presigned-urls'],
    });

    expect(status.version).toBe('1.0.0');
    expect(status.provider).toBe('s3');
    expect(status.features).toEqual(['upload', 'download', 'presigned-urls']);
  });

  it('should reject invalid service name', () => {
    expect(() => KernelServiceStatusSchema.parse({
      name: 'invalid',
      enabled: true,
      status: 'running',
    })).toThrow();
  });

  it('should reject missing required fields', () => {
    expect(() => KernelServiceStatusSchema.parse({})).toThrow();
    expect(() => KernelServiceStatusSchema.parse({ name: 'metadata' })).toThrow();
  });
});

describe('KernelServiceMapSchema', () => {
  it('should accept valid service map', () => {
    const map = KernelServiceMapSchema.parse({
      metadata: {},
      data: {},
      auth: {},
    });

    expect(map.metadata).toBeDefined();
    expect(map.data).toBeDefined();
    expect(map.auth).toBeDefined();
  });

  it('should accept empty map', () => {
    expect(() => KernelServiceMapSchema.parse({})).not.toThrow();
  });

  it('should reject invalid service name keys', () => {
    expect(() => KernelServiceMapSchema.parse({
      'invalid-service': {},
    })).toThrow();
  });
});

describe('ServiceConfigSchema', () => {
  it('should accept valid service config', () => {
    const config = ServiceConfigSchema.parse({
      id: 'metadata-service-1',
      name: 'metadata',
    });

    expect(config.id).toBe('metadata-service-1');
    expect(config.name).toBe('metadata');
    expect(config.options).toBeUndefined();
  });

  it('should accept optional options', () => {
    const config = ServiceConfigSchema.parse({
      id: 'cache-service-1',
      name: 'cache',
      options: { host: 'localhost', port: 6379 },
    });

    expect(config.options).toEqual({ host: 'localhost', port: 6379 });
  });

  it('should reject invalid service name', () => {
    expect(() => ServiceConfigSchema.parse({
      id: 'test',
      name: 'invalid',
    })).toThrow();
  });

  it('should reject missing required fields', () => {
    expect(() => ServiceConfigSchema.parse({})).toThrow();
    expect(() => ServiceConfigSchema.parse({ id: 'test' })).toThrow();
  });
});
