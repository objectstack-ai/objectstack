// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import type { IDeployPipelineService, DeployExecutionResult } from './deploy-pipeline-service';
import type { DeployBundle, MigrationPlan, DeployValidationResult } from '../system/deploy-bundle.zod';

describe('Deploy Pipeline Service Contract', () => {
  const sampleBundle: DeployBundle = {
    manifest: {
      version: '1.0.0',
      objects: ['project_task'],
      views: [],
      flows: [],
      permissions: [],
    },
    objects: [{ name: 'project_task', fields: {} }],
    views: [],
    flows: [],
    permissions: [],
    seedData: [],
  };

  const samplePlan: MigrationPlan = {
    statements: [
      { sql: 'CREATE TABLE project_task (id TEXT PRIMARY KEY)', reversible: true, order: 0 },
    ],
    dialect: 'sqlite',
    reversible: true,
  };

  it('should allow a minimal IDeployPipelineService implementation with all required methods', () => {
    const service: IDeployPipelineService = {
      validateBundle: () => ({ valid: true, issues: [], errorCount: 0, warningCount: 0 }),
      planDeployment: async () => ({ statements: [], dialect: 'sqlite', reversible: true }),
      executeDeployment: async () => ({
        deploymentId: 'deploy_001',
        status: 'ready',
        durationMs: 1200,
        statementsExecuted: 1,
        completedAt: new Date().toISOString(),
      }),
      rollbackDeployment: async () => {},
    };

    expect(typeof service.validateBundle).toBe('function');
    expect(typeof service.planDeployment).toBe('function');
    expect(typeof service.executeDeployment).toBe('function');
    expect(typeof service.rollbackDeployment).toBe('function');
  });

  it('should validate a deploy bundle', () => {
    const service: IDeployPipelineService = {
      validateBundle: (bundle) => ({
        valid: bundle.manifest.version !== '',
        issues: [],
        errorCount: 0,
        warningCount: 0,
      }),
      planDeployment: async () => ({ statements: [], dialect: 'sqlite', reversible: true }),
      executeDeployment: async () => ({
        deploymentId: 'deploy_001',
        status: 'ready',
        durationMs: 0,
        statementsExecuted: 0,
        completedAt: new Date().toISOString(),
      }),
      rollbackDeployment: async () => {},
    };

    const result: DeployValidationResult = service.validateBundle(sampleBundle);
    expect(result.valid).toBe(true);
    expect(result.errorCount).toBe(0);
  });

  it('should plan and execute a deployment', async () => {
    const deployments = new Map<string, DeployExecutionResult>();
    let counter = 0;

    const service: IDeployPipelineService = {
      validateBundle: () => ({ valid: true, issues: [], errorCount: 0, warningCount: 0 }),
      planDeployment: async () => samplePlan,
      executeDeployment: async (_tenantId, plan) => {
        const result: DeployExecutionResult = {
          deploymentId: `deploy_${++counter}`,
          status: 'ready',
          durationMs: 1500,
          statementsExecuted: plan.statements?.length ?? 0,
          completedAt: new Date().toISOString(),
        };
        deployments.set(result.deploymentId, result);
        return result;
      },
      rollbackDeployment: async () => {},
    };

    const plan = await service.planDeployment('tenant_001', sampleBundle);
    expect(plan.statements).toHaveLength(1);
    expect(plan.dialect).toBe('sqlite');

    const result = await service.executeDeployment('tenant_001', plan);
    expect(result.deploymentId).toBe('deploy_1');
    expect(result.status).toBe('ready');
    expect(result.statementsExecuted).toBe(1);
  });

  it('should handle rollback', async () => {
    let rolledBack = false;

    const service: IDeployPipelineService = {
      validateBundle: () => ({ valid: true, issues: [], errorCount: 0, warningCount: 0 }),
      planDeployment: async () => ({ statements: [], dialect: 'sqlite', reversible: true }),
      executeDeployment: async () => ({
        deploymentId: 'deploy_001',
        status: 'ready',
        durationMs: 0,
        statementsExecuted: 0,
        completedAt: new Date().toISOString(),
      }),
      rollbackDeployment: async () => {
        rolledBack = true;
      },
    };

    await service.rollbackDeployment('tenant_001', 'deploy_001');
    expect(rolledBack).toBe(true);
  });
});
