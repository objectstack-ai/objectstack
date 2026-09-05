import { describe, expect, it } from 'vitest';
import {
  RuntimeConfigSchema,
  SandboxConfigSchema,
  PluginPermissionSchema,
  PluginPermissionSetSchema,
  KernelSecurityPolicySchema,
  PluginSecurityManifestSchema,
} from './plugin-security-advanced.zod';

describe('Plugin Security Advanced Schemas', () => {
  describe('RuntimeConfigSchema', () => {
    it('should validate default V8 isolate runtime', () => {
      const config = RuntimeConfigSchema.parse({});
      expect(config.engine).toBe('v8-isolate');
    });

    it('should validate WASM runtime with memory pages', () => {
      const config = {
        engine: 'wasm' as const,
        engineConfig: {
          wasm: {
            maxMemoryPages: 256,
            instructionLimit: 1000000,
            enableSimd: true,
            enableThreads: false,
            enableBulkMemory: true,
          },
        },
        resourceLimits: {
          maxMemory: 16777216, // 16MB
          maxCpu: 50,
          timeout: 30000,
        },
      };
      const result = RuntimeConfigSchema.parse(config);
      expect(result.engine).toBe('wasm');
      expect(result.engineConfig?.wasm?.maxMemoryPages).toBe(256);
      expect(result.engineConfig?.wasm?.instructionLimit).toBe(1000000);
      expect(result.resourceLimits?.maxMemory).toBe(16777216);
    });

    it('should validate container runtime', () => {
      const config = {
        engine: 'container' as const,
        engineConfig: {
          container: {
            image: 'objectstack/plugin-runtime:latest',
            runtime: 'docker' as const,
            resources: {
              cpuLimit: '0.5',
              memoryLimit: '512m',
            },
            networkMode: 'bridge' as const,
          },
        },
      };
      const result = RuntimeConfigSchema.parse(config);
      expect(result.engine).toBe('container');
      expect(result.engineConfig?.container?.image).toBe('objectstack/plugin-runtime:latest');
      expect(result.engineConfig?.container?.runtime).toBe('docker');
    });

    it('should validate process runtime', () => {
      const config = {
        engine: 'process' as const,
        resourceLimits: {
          maxMemory: 1073741824, // 1GB
          maxCpu: 100,
          timeout: 60000,
        },
      };
      const result = RuntimeConfigSchema.parse(config);
      expect(result.engine).toBe('process');
    });

    it('should validate V8 isolate with custom settings', () => {
      const config = {
        engine: 'v8-isolate' as const,
        engineConfig: {
          v8Isolate: {
            heapSizeMb: 128,
            enableSnapshot: true,
          },
        },
      };
      const result = RuntimeConfigSchema.parse(config);
      expect(result.engineConfig?.v8Isolate?.heapSizeMb).toBe(128);
    });
  });

  describe('SandboxConfigSchema', () => {
    it('should validate sandbox with defaults', () => {
      const config = SandboxConfigSchema.parse({});
      expect(config.enabled).toBe(true);
      expect(config.level).toBe('standard');
    });

    it('should validate strict sandbox with WASM runtime', () => {
      const config = {
        enabled: true,
        level: 'strict' as const,
        runtime: {
          engine: 'wasm' as const,
          engineConfig: {
            wasm: {
              maxMemoryPages: 128,
              instructionLimit: 500000,
            },
          },
        },
        filesystem: {
          mode: 'readonly' as const,
          allowedPaths: ['/data/readonly'],
        },
        network: {
          mode: 'restricted' as const,
          allowedHosts: ['api.objectstack.com'],
          allowedPorts: [443],
        },
        memory: {
          maxHeap: 67108864, // 64MB
        },
        cpu: {
          maxCpuPercent: 25,
          maxThreads: 2,
        },
      };
      const result = SandboxConfigSchema.parse(config);
      expect(result.level).toBe('strict');
      expect(result.runtime?.engine).toBe('wasm');
      expect(result.filesystem?.mode).toBe('readonly');
    });

    it('should validate paranoid sandbox', () => {
      const config = {
        enabled: true,
        level: 'paranoid' as const,
        runtime: {
          engine: 'wasm' as const,
        },
        filesystem: {
          mode: 'none' as const,
        },
        network: {
          mode: 'none' as const,
        },
        process: {
          allowSpawn: false,
        },
        environment: {
          mode: 'none' as const,
        },
      };
      const result = SandboxConfigSchema.parse(config);
      expect(result.level).toBe('paranoid');
      expect(result.filesystem?.mode).toBe('none');
      expect(result.network?.mode).toBe('none');
    });
  });

  describe('PluginPermissionSchema', () => {
    it('should validate basic permission', () => {
      const permission = {
        id: 'read-objects',
        resource: 'data.object' as const,
        actions: ['read' as const],
        description: 'Read access to data objects',
      };
      const result = PluginPermissionSchema.parse(permission);
      expect(result.id).toBe('read-objects');
      expect(result.scope).toBe('plugin');
      expect(result.required).toBe(true);
    });

    it('should validate permission with filter', () => {
      const permission = {
        id: 'manage-user-records',
        resource: 'data.record' as const,
        actions: ['read' as const, 'update' as const],
        scope: 'user' as const,
        filter: {
          condition: 'owner = currentUser',
          fields: ['name', 'email', 'preferences'],
        },
        description: 'Manage user records',
        justification: 'Required for user profile management',
      };
      const result = PluginPermissionSchema.parse(permission);
      expect(result.scope).toBe('user');
      expect(result.filter?.fields).toHaveLength(3);
    });
  });

  describe('PluginPermissionSetSchema', () => {
    it('should validate permission set', () => {
      const permissionSet = {
        permissions: [
          {
            id: 'read-data',
            resource: 'data.object' as const,
            actions: ['read' as const],
            description: 'Read data',
          },
        ],
        groups: [
          {
            name: 'data-access',
            description: 'Data access permissions',
            permissions: ['read-data'],
          },
        ],
        defaultGrant: 'prompt' as const,
      };
      const result = PluginPermissionSetSchema.parse(permissionSet);
      expect(result.permissions).toHaveLength(1);
      expect(result.groups).toHaveLength(1);
    });
  });

  describe('KernelSecurityPolicySchema', () => {
    it('should validate comprehensive security policy', () => {
      const policy = {
        csp: {
          directives: {
            'default-src': ["'self'"],
            'script-src': ["'self'", "'unsafe-inline'"],
          },
          reportOnly: false,
        },
        cors: {
          allowedOrigins: ['https://app.objectstack.com'],
          allowedMethods: ['GET', 'POST'],
          allowedHeaders: ['Content-Type', 'Authorization'],
          allowCredentials: true,
        },
        rateLimit: {
          enabled: true,
          maxRequests: 100,
          windowMs: 60000,
          strategy: 'sliding' as const,
        },
        authentication: {
          required: true,
          methods: ['jwt' as const, 'api-key' as const],
          tokenExpirationSeconds: 3600,
        },
        encryption: {
          dataAtRest: true,
          dataInTransit: true,
          algorithm: 'AES-256-GCM',
          minKeyLength: 256,
        },
        auditLog: {
          enabled: true,
          events: ['auth', 'data-access', 'config-change'],
          retentionDays: 90,
        },
      };
      const result = KernelSecurityPolicySchema.parse(policy);
      expect(result.rateLimit?.enabled).toBe(true);
      expect(result.authentication?.required).toBe(true);
      expect(result.encryption?.dataAtRest).toBe(true);
    });
  });

  describe('PluginSecurityManifestSchema', () => {
    it('should validate complete security manifest', () => {
      const manifest = {
        pluginId: 'com.acme.analytics',
        trustLevel: 'trusted' as const,
        permissions: {
          permissions: [
            {
              id: 'read-analytics',
              resource: 'data.object' as const,
              actions: ['read' as const],
              description: 'Read analytics data',
            },
          ],
          defaultGrant: 'prompt' as const,
        },
        sandbox: {
          enabled: true,
          level: 'strict' as const,
          runtime: {
            engine: 'wasm' as const,
            engineConfig: {
              wasm: {
                maxMemoryPages: 256,
              },
            },
          },
        },
        codeSigning: {
          signed: true,
          signature: 'sha256:abc123...',
          algorithm: 'RSA-SHA256',
          timestamp: new Date().toISOString(),
        },
      };
      const result = PluginSecurityManifestSchema.parse(manifest);
      expect(result.trustLevel).toBe('trusted');
      expect(result.sandbox.level).toBe('strict');
      expect(result.codeSigning?.signed).toBe(true);
    });
  });
});
