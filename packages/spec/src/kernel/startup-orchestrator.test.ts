import { describe, it, expect } from 'vitest';
import {
  StartupOptionsSchema,
  HealthStatusSchema,
  PluginStartupResultSchema,
  StartupOrchestrationResultSchema,
} from './startup-orchestrator.zod';

describe('Startup Orchestrator Protocol', () => {
  describe('StartupOptionsSchema', () => {
    it('should apply default values', () => {
      const options = {};

      const result = StartupOptionsSchema.parse(options);
      expect(result.timeout).toBe(30000);
      expect(result.rollbackOnFailure).toBe(true);
      expect(result.healthCheck).toBe(false);
      expect(result.parallel).toBe(false);
    });

    it('should validate custom options', () => {
      const options = {
        timeout: 60000,
        rollbackOnFailure: false,
        healthCheck: true,
        parallel: true,
        context: { custom: 'data' },
      };

      const result = StartupOptionsSchema.safeParse(options);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.timeout).toBe(60000);
        expect(result.data.context).toEqual({ custom: 'data' });
      }
    });

    it('should reject negative timeout', () => {
      const options = {
        timeout: -1000,
      };

      const result = StartupOptionsSchema.safeParse(options);
      expect(result.success).toBe(false);
    });
  });

  describe('HealthStatusSchema', () => {
    it('should validate healthy status', () => {
      const healthyStatus = {
        healthy: true,
        checkedAt: Date.now(),
        details: {
          databaseConnected: true,
          memoryUsage: 45.2,
        },
      };

      const result = HealthStatusSchema.safeParse(healthyStatus);
      expect(result.success).toBe(true);
    });

    it('should validate unhealthy status with message', () => {
      const unhealthyStatus = {
        healthy: false,
        checkedAt: Date.now(),
        message: 'Database connection failed',
      };

      const result = HealthStatusSchema.safeParse(unhealthyStatus);
      expect(result.success).toBe(true);
    });
  });

  describe('PluginStartupResultSchema', () => {
    it('should validate successful startup result', () => {
      const successResult = {
        plugin: {
          name: 'crm-plugin',
          version: '1.0.0',
        },
        success: true,
        duration: 1250,
      };

      const result = PluginStartupResultSchema.safeParse(successResult);
      expect(result.success).toBe(true);
    });

    it('should validate failed startup result with error', () => {
      const failedResult = {
        plugin: {
          name: 'failing-plugin',
          version: '1.0.0',
        },
        success: false,
        duration: 500,
        error: { name: 'Error', message: 'Connection failed' },
      };

      const result = PluginStartupResultSchema.safeParse(failedResult);
      expect(result.success).toBe(true);
    });

    it('should validate result with health status', () => {
      const resultWithHealth = {
        plugin: {
          name: 'crm-plugin',
        },
        success: true,
        duration: 1250,
        health: {
          healthy: true,
          checkedAt: Date.now(),
        },
      };

      const result = PluginStartupResultSchema.safeParse(resultWithHealth);
      expect(result.success).toBe(true);
    });

    it('should reject negative duration', () => {
      const invalidResult = {
        plugin: { name: 'test' },
        success: true,
        duration: -100,
      };

      const result = PluginStartupResultSchema.safeParse(invalidResult);
      expect(result.success).toBe(false);
    });
  });

  describe('StartupOrchestrationResultSchema', () => {
    it('should validate complete orchestration result', () => {
      const orchestrationResult = {
        results: [
          {
            plugin: { name: 'plugin1', version: '1.0.0' },
            success: true,
            duration: 1200,
          },
          {
            plugin: { name: 'plugin2', version: '2.0.0' },
            success: true,
            duration: 850,
          },
        ],
        totalDuration: 2050,
        allSuccessful: true,
      };

      const result = StartupOrchestrationResultSchema.safeParse(orchestrationResult);
      expect(result.success).toBe(true);
    });

    it('should validate orchestration with rollback', () => {
      const orchestrationWithRollback = {
        results: [
          {
            plugin: { name: 'plugin1' },
            success: true,
            duration: 1200,
          },
          {
            plugin: { name: 'plugin2' },
            success: false,
            duration: 850,
            error: { name: 'Error', message: 'Startup failed' },
          },
        ],
        totalDuration: 2050,
        allSuccessful: false,
        rolledBack: ['plugin1'],
      };

      const result = StartupOrchestrationResultSchema.safeParse(orchestrationWithRollback);
      expect(result.success).toBe(true);
    });
  });
});
