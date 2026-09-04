import { describe, it, expect } from 'vitest';
import {
  ChangeTypeSchema,
  ChangePrioritySchema,
  ChangeStatusSchema,
  ChangeImpactSchema,
  RollbackPlanSchema,
  ChangeRequestSchema,
  type ChangeRequest,
  type ChangeImpact,
  type RollbackPlan,
} from './change-management.zod';

describe('ChangeTypeSchema', () => {
  it('should accept all valid change types', () => {
    const validTypes = ['standard', 'normal', 'emergency', 'major'];

    validTypes.forEach((type) => {
      expect(() => ChangeTypeSchema.parse(type)).not.toThrow();
    });
  });

  it('should reject invalid change type', () => {
    expect(() => ChangeTypeSchema.parse('invalid')).toThrow();
  });
});

describe('ChangePrioritySchema', () => {
  it('should accept all valid priorities', () => {
    const validPriorities = ['critical', 'high', 'medium', 'low'];

    validPriorities.forEach((priority) => {
      expect(() => ChangePrioritySchema.parse(priority)).not.toThrow();
    });
  });

  it('should reject invalid priority', () => {
    expect(() => ChangePrioritySchema.parse('urgent')).toThrow();
  });
});

describe('ChangeStatusSchema', () => {
  it('should accept all valid statuses', () => {
    const validStatuses = [
      'draft',
      'submitted',
      'in-review',
      'approved',
      'scheduled',
      'in-progress',
      'completed',
      'failed',
      'rolled-back',
      'cancelled',
    ];

    validStatuses.forEach((status) => {
      expect(() => ChangeStatusSchema.parse(status)).not.toThrow();
    });
  });

  it('should reject invalid status', () => {
    expect(() => ChangeStatusSchema.parse('pending')).toThrow();
  });
});

describe('ChangeImpactSchema', () => {
  it('should validate complete impact assessment', () => {
    const validImpact: ChangeImpact = {
      level: 'high',
      affectedSystems: ['crm-api', 'customer-portal'],
      affectedUsers: 5000,
      downtime: {
        required: true,
      },
    };

    expect(() => ChangeImpactSchema.parse(validImpact)).not.toThrow();
  });

  it('should accept minimal impact assessment', () => {
    const minimalImpact = {
      level: 'low',
      affectedSystems: ['test-system'],
    };

    expect(() => ChangeImpactSchema.parse(minimalImpact)).not.toThrow();
  });

  it('should accept all impact levels', () => {
    const levels = ['low', 'medium', 'high', 'critical'] as const;

    levels.forEach((level) => {
      const impact = {
        level,
        affectedSystems: ['system-1'],
      };

      expect(() => ChangeImpactSchema.parse(impact)).not.toThrow();
    });
  });

  it('should validate downtime configuration', () => {
    const impact = {
      level: 'medium',
      affectedSystems: ['api-gateway'],
      downtime: {
        required: false,
      },
    };

    expect(() => ChangeImpactSchema.parse(impact)).not.toThrow();
  });

  it('should reject invalid impact level', () => {
    const invalidImpact = {
      level: 'severe',
      affectedSystems: ['system'],
    };

    expect(() => ChangeImpactSchema.parse(invalidImpact)).toThrow();
  });
});

describe('RollbackPlanSchema', () => {
  it('should validate complete rollback plan', () => {
    const validPlan: RollbackPlan = {
      description: 'Revert database schema to previous version',
      steps: [
        {
          order: 1,
          description: 'Stop application servers',
        },
        {
          order: 2,
          description: 'Restore database backup',
        },
        {
          order: 3,
          description: 'Restart application servers',
        },
      ],
      testProcedure: 'Verify application login and basic functionality',
    };

    expect(() => RollbackPlanSchema.parse(validPlan)).not.toThrow();
  });

  it('should accept rollback plan without test procedure', () => {
    const planWithoutTest = {
      description: 'Simple rollback',
      steps: [
        {
          order: 1,
          description: 'Revert changes',
        },
      ],
    };

    expect(() => RollbackPlanSchema.parse(planWithoutTest)).not.toThrow();
  });

  it('should validate multiple rollback steps', () => {
    const plan = {
      description: 'Multi-step rollback',
      steps: [
        {
          order: 1,
          description: 'Step 1',
        },
        {
          order: 2,
          description: 'Step 2',
        },
        {
          order: 3,
          description: 'Step 3',
        },
        {
          order: 4,
          description: 'Step 4',
        },
      ],
    };

    expect(() => RollbackPlanSchema.parse(plan)).not.toThrow();
  });
});

describe('ChangeRequestSchema', () => {
  it('should validate complete change request', () => {
    const validRequest: ChangeRequest = {
      id: 'CHG-2024-001',
      title: 'Upgrade CRM Database Schema',
      description: 'Migrate customer database to new schema version 2.0',
      type: 'normal',
      priority: 'high',
      status: 'approved',
      requestedBy: 'user_123',
      requestedAt: 1704067200000,
      impact: {
        level: 'high',
        affectedSystems: ['crm-api', 'customer-portal'],
        affectedUsers: 5000,
        downtime: {
          required: true,
        },
      },
      implementation: {
        description: 'Execute database migration scripts',
        steps: [
          {
            order: 1,
            description: 'Backup current database',
          },
          {
            order: 2,
            description: 'Run migration scripts',
          },
        ],
        testing: 'Run integration test suite',
      },
      rollbackPlan: {
        description: 'Restore from backup',
        steps: [
          {
            order: 1,
            description: 'Restore backup',
          },
        ],
      },
      schedule: {
        plannedStart: 1704153600000,
        plannedEnd: 1704155400000,
      },
    };

    expect(() => ChangeRequestSchema.parse(validRequest)).not.toThrow();
  });

  it('should accept minimal change request', () => {
    const minimalRequest = {
      id: 'CHG-2024-002',
      title: 'Simple Change',
      description: 'A simple change',
      type: 'standard',
      priority: 'low',
      status: 'draft',
      requestedBy: 'user_456',
      requestedAt: Date.now(),
      impact: {
        level: 'low',
        affectedSystems: ['test-system'],
      },
      implementation: {
        description: 'Make the change',
        steps: [
          {
            order: 1,
            description: 'Execute change',
          },
        ],
      },
      rollbackPlan: {
        description: 'Undo the change',
        steps: [
          {
            order: 1,
            description: 'Revert',
          },
        ],
      },
    };

    expect(() => ChangeRequestSchema.parse(minimalRequest)).not.toThrow();
  });

  it('should validate standard change type', () => {
    const standardChange = {
      id: 'CHG-STD-001',
      title: 'Standard Change',
      description: 'Pre-approved standard change',
      type: 'standard',
      priority: 'low',
      status: 'approved',
      requestedBy: 'user_789',
      requestedAt: Date.now(),
      impact: {
        level: 'low',
        affectedSystems: ['component-a'],
      },
      implementation: {
        description: 'Standard procedure',
        steps: [
          {
            order: 1,
            description: 'Execute',
          },
        ],
      },
      rollbackPlan: {
        description: 'Standard rollback',
        steps: [
          {
            order: 1,
            description: 'Revert',
          },
        ],
      },
    };

    expect(() => ChangeRequestSchema.parse(standardChange)).not.toThrow();
  });

  it('should validate emergency change type', () => {
    const emergencyChange = {
      id: 'CHG-EMG-001',
      title: 'Emergency Security Patch',
      description: 'Critical security vulnerability fix',
      type: 'emergency',
      priority: 'critical',
      status: 'in-progress',
      requestedBy: 'security_team',
      requestedAt: Date.now(),
      impact: {
        level: 'critical',
        affectedSystems: ['all-systems'],
        affectedUsers: 50000,
        downtime: {
          required: true,
        },
      },
      implementation: {
        description: 'Apply security patch',
        steps: [
          {
            order: 1,
            description: 'Deploy patch',
          },
        ],
      },
      rollbackPlan: {
        description: 'Remove patch',
        steps: [
          {
            order: 1,
            description: 'Rollback',
          },
        ],
      },
    };

    expect(() => ChangeRequestSchema.parse(emergencyChange)).not.toThrow();
  });

  it('should validate major change requiring CAB approval', () => {
    const majorChange = {
      id: 'CHG-MAJ-001',
      title: 'Major Infrastructure Upgrade',
      description: 'Upgrade core infrastructure',
      type: 'major',
      priority: 'high',
      status: 'in-review',
      requestedBy: 'infrastructure_team',
      requestedAt: Date.now(),
      impact: {
        level: 'critical',
        affectedSystems: ['core-infrastructure', 'all-applications'],
        affectedUsers: 100000,
        downtime: {
          required: true,
        },
      },
      implementation: {
        description: 'Multi-phase infrastructure upgrade',
        steps: [
          {
            order: 1,
            description: 'Phase 1: Database upgrade',
          },
          {
            order: 2,
            description: 'Phase 2: Application upgrade',
          },
        ],
        testing: 'Comprehensive integration testing',
      },
      rollbackPlan: {
        description: 'Restore from snapshots',
        steps: [
          {
            order: 1,
            description: 'Restore infrastructure snapshot',
          },
        ],
      },
      approval: {
        required: true,
        approvers: [
          {
            userId: 'cab_member_1',
            approvedAt: 1704067200000,
            comments: 'Approved with conditions',
          },
          {
            userId: 'cab_member_2',
          },
        ],
      },
    };

    expect(() => ChangeRequestSchema.parse(majorChange)).not.toThrow();
  });

  it('should validate schedule with actual times', () => {
    const scheduledChange = {
      id: 'CHG-2024-003',
      title: 'Scheduled Maintenance',
      description: 'Routine maintenance',
      type: 'normal',
      priority: 'medium',
      status: 'completed',
      requestedBy: 'ops_team',
      requestedAt: Date.now(),
      impact: {
        level: 'medium',
        affectedSystems: ['web-servers'],
      },
      implementation: {
        description: 'Update web servers',
        steps: [
          {
            order: 1,
            description: 'Update',
          },
        ],
      },
      rollbackPlan: {
        description: 'Rollback update',
        steps: [
          {
            order: 1,
            description: 'Revert',
          },
        ],
      },
      schedule: {
        plannedStart: 1704153600000,
        plannedEnd: 1704155400000,
        actualStart: 1704153650000,
        actualEnd: 1704155350000,
      },
    };

    expect(() => ChangeRequestSchema.parse(scheduledChange)).not.toThrow();
  });

  it('should validate attachments', () => {
    const changeWithAttachments = {
      id: 'CHG-2024-004',
      title: 'Change with Documentation',
      description: 'Well-documented change',
      type: 'normal',
      priority: 'medium',
      status: 'submitted',
      requestedBy: 'user_123',
      requestedAt: Date.now(),
      impact: {
        level: 'medium',
        affectedSystems: ['api'],
      },
      implementation: {
        description: 'API update',
        steps: [
          {
            order: 1,
            description: 'Deploy',
          },
        ],
      },
      rollbackPlan: {
        description: 'Rollback',
        steps: [
          {
            order: 1,
            description: 'Revert',
          },
        ],
      },
      attachments: [
        {
          name: 'implementation-plan.pdf',
          url: 'https://example.com/docs/plan.pdf',
        },
        {
          name: 'architecture-diagram.png',
          url: 'https://example.com/diagrams/arch.png',
        },
      ],
    };

    expect(() => ChangeRequestSchema.parse(changeWithAttachments)).not.toThrow();
  });

  it('should validate attachment URLs', () => {
    const invalidChange = {
      id: 'CHG-2024-005',
      title: 'Invalid Attachment',
      description: 'Change with invalid attachment URL',
      type: 'normal',
      priority: 'low',
      status: 'draft',
      requestedBy: 'user_123',
      requestedAt: Date.now(),
      impact: {
        level: 'low',
        affectedSystems: ['test'],
      },
      implementation: {
        description: 'Test',
        steps: [
          {
            order: 1,
            description: 'Test',
          },
        ],
      },
      rollbackPlan: {
        description: 'Test',
        steps: [
          {
            order: 1,
            description: 'Test',
          },
        ],
      },
      attachments: [
        {
          name: 'document.pdf',
          url: 'not-a-valid-url',
        },
      ],
    };

    expect(() => ChangeRequestSchema.parse(invalidChange)).toThrow();
  });

  it('should validate failed change status', () => {
    const failedChange = {
      id: 'CHG-2024-006',
      title: 'Failed Change',
      description: 'Change that failed',
      type: 'normal',
      priority: 'high',
      status: 'failed',
      requestedBy: 'user_123',
      requestedAt: Date.now(),
      impact: {
        level: 'high',
        affectedSystems: ['database'],
      },
      implementation: {
        description: 'Database update',
        steps: [
          {
            order: 1,
            description: 'Update schema',
          },
        ],
      },
      rollbackPlan: {
        description: 'Restore backup',
        steps: [
          {
            order: 1,
            description: 'Restore',
          },
        ],
      },
    };

    expect(() => ChangeRequestSchema.parse(failedChange)).not.toThrow();
  });

  it('should validate rolled-back change status', () => {
    const rolledBackChange = {
      id: 'CHG-2024-007',
      title: 'Rolled Back Change',
      description: 'Change that was rolled back',
      type: 'normal',
      priority: 'high',
      status: 'rolled-back',
      requestedBy: 'user_123',
      requestedAt: Date.now(),
      impact: {
        level: 'high',
        affectedSystems: ['application'],
      },
      implementation: {
        description: 'App update',
        steps: [
          {
            order: 1,
            description: 'Deploy',
          },
        ],
      },
      rollbackPlan: {
        description: 'Revert deployment',
        steps: [
          {
            order: 1,
            description: 'Rollback',
          },
        ],
        testProcedure: 'Verify app functionality',
      },
    };

    expect(() => ChangeRequestSchema.parse(rolledBackChange)).not.toThrow();
  });

  it('should accept change with security impact assessment (A.8.32)', () => {
    const changeWithSecurityImpact = {
      id: 'CHG-2024-SEC-001',
      title: 'API Gateway Configuration Change',
      description: 'Update API gateway security headers',
      type: 'normal',
      priority: 'high',
      status: 'approved',
      requestedBy: 'security_team',
      requestedAt: Date.now(),
      impact: {
        level: 'high',
        affectedSystems: ['api-gateway'],
      },
      implementation: {
        description: 'Update security headers',
        steps: [
          {
            order: 1,
            description: 'Deploy configuration',
          },
        ],
      },
      rollbackPlan: {
        description: 'Revert configuration',
        steps: [
          {
            order: 1,
            description: 'Restore previous config',
          },
        ],
      },
      securityImpact: {
        assessed: true,
        riskLevel: 'high',
        affectedDataClassifications: ['pii', 'confidential'],
        requiresSecurityApproval: true,
        reviewedBy: 'ciso',
        reviewedAt: Date.now(),
        reviewNotes: 'Approved with monitoring requirement',
      },
    };

    const parsed = ChangeRequestSchema.parse(changeWithSecurityImpact);
    expect(parsed.securityImpact?.assessed).toBe(true);
    expect(parsed.securityImpact?.riskLevel).toBe('high');
    expect(parsed.securityImpact?.requiresSecurityApproval).toBe(true);
  });

  it('should accept change with minimal security impact', () => {
    const change = {
      id: 'CHG-2024-SEC-002',
      title: 'Minor UI Change',
      description: 'Update button color',
      type: 'standard',
      priority: 'low',
      status: 'draft',
      requestedBy: 'user_123',
      requestedAt: Date.now(),
      impact: {
        level: 'low',
        affectedSystems: ['ui'],
      },
      implementation: {
        description: 'Update CSS',
        steps: [{ order: 1, description: 'Deploy' }],
      },
      rollbackPlan: {
        description: 'Revert CSS',
        steps: [{ order: 1, description: 'Revert' }],
      },
      securityImpact: {
        assessed: true,
        riskLevel: 'none',
      },
    };

    const parsed = ChangeRequestSchema.parse(change);
    expect(parsed.securityImpact?.riskLevel).toBe('none');
    expect(parsed.securityImpact?.requiresSecurityApproval).toBe(false);
  });

  it('should accept all security risk levels', () => {
    const levels = ['none', 'low', 'medium', 'high', 'critical'] as const;

    levels.forEach((riskLevel) => {
      const change = {
        id: `CHG-${riskLevel}`,
        title: 'Test',
        description: 'Test',
        type: 'standard',
        priority: 'low',
        status: 'draft',
        requestedBy: 'user',
        requestedAt: Date.now(),
        impact: { level: 'low', affectedSystems: ['test'] },
        implementation: {
          description: 'Test',
          steps: [{ order: 1, description: 'Test' }],
        },
        rollbackPlan: {
          description: 'Test',
          steps: [{ order: 1, description: 'Test' }],
        },
        securityImpact: {
          assessed: true,
          riskLevel,
        },
      };

      expect(() => ChangeRequestSchema.parse(change)).not.toThrow();
    });
  });
});
