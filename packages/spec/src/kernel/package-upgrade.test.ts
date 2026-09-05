import { describe, it, expect } from 'vitest';
import {
  MetadataChangeTypeSchema,
  MetadataDiffItemSchema,
  UpgradeImpactLevelSchema,
  UpgradePlanSchema,
  UpgradeSnapshotSchema,
  UpgradePackageRequestSchema,
  UpgradePhaseSchema,
  UpgradePackageResponseSchema,
  RollbackPackageRequestSchema,
  RollbackPackageResponseSchema,
} from './package-upgrade.zod';

const validManifest = {
  id: 'com.acme.crm',
  version: '1.0.0',
  type: 'app' as const,
  name: 'Acme CRM',
};

describe('MetadataChangeTypeSchema', () => {
  it('should accept valid change types', () => {
    const types = ['added', 'modified', 'removed', 'renamed'];
    types.forEach(type => {
      expect(() => MetadataChangeTypeSchema.parse(type)).not.toThrow();
    });
  });

  it('should reject invalid change types', () => {
    expect(() => MetadataChangeTypeSchema.parse('updated')).toThrow();
  });
});

describe('MetadataDiffItemSchema', () => {
  it('should accept valid diff item', () => {
    const diff = {
      type: 'object',
      name: 'account',
      changeType: 'modified' as const,
      summary: 'Added new field "priority"',
    };
    const parsed = MetadataDiffItemSchema.parse(diff);
    expect(parsed.hasConflict).toBe(false);
  });

  it('should accept diff item with conflict flag', () => {
    const diff = {
      type: 'view',
      name: 'account_list',
      changeType: 'modified' as const,
      hasConflict: true,
      summary: 'Column order changed — conflicts with customer customization',
    };
    const parsed = MetadataDiffItemSchema.parse(diff);
    expect(parsed.hasConflict).toBe(true);
  });

  it('should accept renamed item with previous name', () => {
    const diff = {
      type: 'object',
      name: 'contact_v2',
      changeType: 'renamed' as const,
      previousName: 'contact',
    };
    expect(() => MetadataDiffItemSchema.parse(diff)).not.toThrow();
  });
});

describe('UpgradeImpactLevelSchema', () => {
  it('should accept all impact levels', () => {
    const levels = ['none', 'low', 'medium', 'high', 'critical'];
    levels.forEach(level => {
      expect(() => UpgradeImpactLevelSchema.parse(level)).not.toThrow();
    });
  });
});

describe('UpgradePlanSchema', () => {
  it('should accept minimal upgrade plan', () => {
    const plan = {
      packageId: 'com.acme.crm',
      fromVersion: '1.0.0',
      toVersion: '2.0.0',
      impactLevel: 'medium' as const,
      changes: [],
    };
    const parsed = UpgradePlanSchema.parse(plan);
    expect(parsed.affectedCustomizations).toBe(0);
    expect(parsed.requiresMigration).toBe(false);
  });

  it('should accept full upgrade plan with changes and migrations', () => {
    const plan = {
      packageId: 'com.acme.crm',
      fromVersion: '1.0.0',
      toVersion: '2.0.0',
      impactLevel: 'high' as const,
      changes: [
        { type: 'object', name: 'account', changeType: 'modified' as const, hasConflict: true },
        { type: 'object', name: 'deal', changeType: 'added' as const },
        { type: 'view', name: 'lead_list', changeType: 'removed' as const },
      ],
      affectedCustomizations: 3,
      requiresMigration: true,
      migrationScripts: ['migrations/v2-add-deal.ts', 'migrations/v2-update-account.ts'],
      dependencyUpgrades: [
        { packageId: 'com.acme.base', fromVersion: '1.0.0', toVersion: '1.1.0' },
      ],
      estimatedDurationSeconds: 120,
      summary: 'Major upgrade adding Deals module and restructuring Account object',
    };
    const parsed = UpgradePlanSchema.parse(plan);
    expect(parsed.changes).toHaveLength(3);
    expect(parsed.requiresMigration).toBe(true);
    expect(parsed.dependencyUpgrades).toHaveLength(1);
  });
});

describe('UpgradeSnapshotSchema', () => {
  it('should accept valid snapshot', () => {
    const snapshot = {
      id: 'snap-001',
      packageId: 'com.acme.crm',
      fromVersion: '1.0.0',
      toVersion: '2.0.0',
      previousManifest: validManifest,
      metadataSnapshot: [
        { type: 'object', name: 'account', metadata: { label: 'Account' } },
        { type: 'view', name: 'account_list', metadata: { type: 'grid' } },
      ],
      createdAt: '2025-06-15T10:00:00Z',
    };
    const parsed = UpgradeSnapshotSchema.parse(snapshot);
    expect(parsed.metadataSnapshot).toHaveLength(2);
  });

  it('should accept snapshot with customizations backup', () => {
    const snapshot = {
      id: 'snap-002',
      packageId: 'com.acme.crm',
      fromVersion: '1.0.0',
      toVersion: '2.0.0',
      tenantId: 'tenant-001',
      previousManifest: validManifest,
      metadataSnapshot: [],
      customizationSnapshot: [
        { overlayId: 'overlay-001', patch: { label: 'Custom Label' } },
      ],
      createdAt: '2025-06-15T10:00:00Z',
      expiresAt: '2025-07-15T10:00:00Z',
    };
    const parsed = UpgradeSnapshotSchema.parse(snapshot);
    expect(parsed.customizationSnapshot).toHaveLength(1);
  });
});

describe('UpgradePackageRequestSchema', () => {
  it('should accept minimal upgrade request', () => {
    const request = {
      packageId: 'com.acme.crm',
    };
    const parsed = UpgradePackageRequestSchema.parse(request);
    expect(parsed.createSnapshot).toBe(true);
    expect(parsed.mergeStrategy).toBe('three-way-merge');
    expect(parsed.dryRun).toBe(false);
    expect(parsed.skipValidation).toBe(false);
  });

  it('should accept full upgrade request', () => {
    const request = {
      packageId: 'com.acme.crm',
      targetVersion: '2.0.0',
      manifest: { ...validManifest, version: '2.0.0' },
      createSnapshot: true,
      mergeStrategy: 'keep-custom' as const,
      dryRun: false,
      skipValidation: false,
    };
    const parsed = UpgradePackageRequestSchema.parse(request);
    expect(parsed.targetVersion).toBe('2.0.0');
    expect(parsed.mergeStrategy).toBe('keep-custom');
  });

  it('should accept dry-run request', () => {
    const request = {
      packageId: 'com.acme.crm',
      targetVersion: '2.0.0',
      dryRun: true,
    };
    const parsed = UpgradePackageRequestSchema.parse(request);
    expect(parsed.dryRun).toBe(true);
  });
});

describe('UpgradePhaseSchema', () => {
  it('should accept all upgrade phases', () => {
    const phases = [
      'pending', 'analyzing', 'snapshot', 'executing',
      'migrating', 'validating', 'completed', 'failed',
      'rolling-back', 'rolled-back',
    ];
    phases.forEach(phase => {
      expect(() => UpgradePhaseSchema.parse(phase)).not.toThrow();
    });
  });
});

describe('UpgradePackageResponseSchema', () => {
  it('should accept successful upgrade response', () => {
    const response = {
      success: true,
      phase: 'completed' as const,
      snapshotId: 'snap-001',
      message: 'Package upgraded successfully from 1.0.0 to 2.0.0',
    };
    expect(() => UpgradePackageResponseSchema.parse(response)).not.toThrow();
  });

  it('should accept failed upgrade with conflicts', () => {
    const response = {
      success: false,
      phase: 'failed' as const,
      plan: {
        packageId: 'com.acme.crm',
        fromVersion: '1.0.0',
        toVersion: '2.0.0',
        impactLevel: 'high' as const,
        changes: [],
      },
      conflicts: [{
        path: 'fields.status.options',
        baseValue: ['a'],
        incomingValue: ['a', 'b'],
        customValue: ['a', 'c'],
      }],
      errorMessage: 'Upgrade failed: unresolved merge conflicts',
    };
    const parsed = UpgradePackageResponseSchema.parse(response);
    expect(parsed.success).toBe(false);
    expect(parsed.conflicts).toHaveLength(1);
  });
});

describe('RollbackPackageRequestSchema', () => {
  it('should accept valid rollback request', () => {
    const request = {
      packageId: 'com.acme.crm',
      snapshotId: 'snap-001',
    };
    const parsed = RollbackPackageRequestSchema.parse(request);
    expect(parsed.rollbackCustomizations).toBe(true);
  });

  it('should accept rollback without customization restore', () => {
    const request = {
      packageId: 'com.acme.crm',
      snapshotId: 'snap-001',
      rollbackCustomizations: false,
    };
    const parsed = RollbackPackageRequestSchema.parse(request);
    expect(parsed.rollbackCustomizations).toBe(false);
  });

  it('should reject missing required fields', () => {
    expect(() => RollbackPackageRequestSchema.parse({ packageId: 'test' })).toThrow();
    expect(() => RollbackPackageRequestSchema.parse({ snapshotId: 'test' })).toThrow();
  });
});

describe('RollbackPackageResponseSchema', () => {
  it('should accept successful rollback', () => {
    const response = {
      success: true,
      restoredVersion: '1.0.0',
      message: 'Rolled back to version 1.0.0',
    };
    const parsed = RollbackPackageResponseSchema.parse(response);
    expect(parsed.success).toBe(true);
    expect(parsed.restoredVersion).toBe('1.0.0');
  });
});

// #15678 (stack card 3/6 of #14478) — ruling B: the unit of a duration-shaped
// number lives in the key NAME. The old spelling is a `retiredKey()` tombstone,
// so the refusal carries the RENAME rather than a bare unrecognized-key error.
describe('UpgradePlan.estimatedDuration carries its unit (#15678)', () => {
  const basePlan = {
    packageId: 'com.acme.crm',
    fromVersion: '1.0.0',
    toVersion: '2.0.0',
    impactLevel: 'low' as const,
    changes: [],
  };

  it('REFUSES the retired `estimatedDuration` with the rename in the message', () => {
    const result = UpgradePlanSchema.safeParse({ ...basePlan, estimatedDuration: 120 });
    expect(result.success).toBe(false);
    const issue = result.error!.issues.find((i) => i.path.join('.') === 'estimatedDuration');
    expect(issue).toBeDefined();
    expect(issue!.code).not.toBe('unrecognized_keys');
    expect(issue!.message).toContain(
      '`UpgradePlan.estimatedDuration` was renamed to `estimatedDurationSeconds`',
    );
    // The prescription must name the unit, because SECONDS is the minority unit
    // in this package and the sibling rename on this card is milliseconds.
    expect(issue!.message).toContain('the value (seconds) is unchanged');
  });

  it('accepts `estimatedDurationSeconds` at the same magnitude', () => {
    const parsed = UpgradePlanSchema.parse({ ...basePlan, estimatedDurationSeconds: 120 });
    expect(parsed.estimatedDurationSeconds).toBe(120);
  });
});
