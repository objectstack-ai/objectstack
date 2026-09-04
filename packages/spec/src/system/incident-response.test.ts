import { describe, it, expect } from 'vitest';
import {
  IncidentSeveritySchema,
  IncidentCategorySchema,
  IncidentStatusSchema,
  IncidentResponsePhaseSchema,
  IncidentNotificationRuleSchema,
  IncidentNotificationMatrixSchema,
  IncidentSchema,
  IncidentResponsePolicySchema,
  type Incident,
  type IncidentResponsePhase,
  type IncidentNotificationRule,
} from './incident-response.zod';

describe('IncidentSeveritySchema', () => {
  it('should accept all valid severity levels', () => {
    const validLevels = ['critical', 'high', 'medium', 'low'];

    validLevels.forEach((level) => {
      expect(() => IncidentSeveritySchema.parse(level)).not.toThrow();
    });
  });

  it('should reject invalid severity level', () => {
    expect(() => IncidentSeveritySchema.parse('extreme')).toThrow();
  });
});

describe('IncidentCategorySchema', () => {
  it('should accept all valid categories', () => {
    const validCategories = [
      'data_breach', 'malware', 'unauthorized_access', 'denial_of_service',
      'social_engineering', 'insider_threat', 'physical_security',
      'configuration_error', 'vulnerability_exploit', 'policy_violation', 'other',
    ];

    validCategories.forEach((category) => {
      expect(() => IncidentCategorySchema.parse(category)).not.toThrow();
    });
  });

  it('should reject invalid category', () => {
    expect(() => IncidentCategorySchema.parse('unknown_type')).toThrow();
  });
});

describe('IncidentStatusSchema', () => {
  it('should accept all valid statuses', () => {
    const validStatuses = [
      'reported', 'triaged', 'investigating', 'containing',
      'eradicating', 'recovering', 'resolved', 'closed',
    ];

    validStatuses.forEach((status) => {
      expect(() => IncidentStatusSchema.parse(status)).not.toThrow();
    });
  });

  it('should reject invalid status', () => {
    expect(() => IncidentStatusSchema.parse('pending')).toThrow();
  });
});

describe('IncidentResponsePhaseSchema', () => {
  it('should accept valid response phase', () => {
    const phase: IncidentResponsePhase = {
      phase: 'containment',
      description: 'Isolate affected systems',
      assignedTo: 'security_team',
    };

    expect(() => IncidentResponsePhaseSchema.parse(phase)).not.toThrow();
  });

  it('should accept all phase types', () => {
    const phases = ['identification', 'containment', 'eradication', 'recovery', 'lessons_learned'];

    phases.forEach((phase) => {
      expect(() => IncidentResponsePhaseSchema.parse({
        phase,
        description: `${phase} phase`,
        assignedTo: 'team',
      })).not.toThrow();
    });
  });

  it('should accept optional fields', () => {
    const phase = IncidentResponsePhaseSchema.parse({
      phase: 'recovery',
      description: 'Restore services',
      assignedTo: 'ops_team',
      completedAt: 1704067200000,
      notes: 'All systems restored successfully',
    });

    expect(phase.completedAt).toBe(1704067200000);
    expect(phase.notes).toBe('All systems restored successfully');
  });

  it('REFUSES an authored `targetHours` — a retiredKey() tombstone since #14477 (ADR-0049)', () => {
    // The full refusal envelope (path, code, prescription) is pinned in
    // `deadline-keys-retirement.test.ts`; this keeps the family suite honest
    // about the shape it parses: any value, not only a negative one, is refused.
    expect(() => IncidentResponsePhaseSchema.parse({
      phase: 'identification',
      description: 'Identify',
      assignedTo: 'team',
      targetHours: 2,
    })).toThrow(/`IncidentResponsePhase\.targetHours` was removed/s);
  });
});

describe('IncidentNotificationRuleSchema', () => {
  it('should accept valid notification rule', () => {
    const rule: IncidentNotificationRule = {
      severity: 'critical',
      channels: ['email', 'pagerduty'],
      recipients: ['ciso', 'security_team'],
      notifyRegulators: true,
    };

    expect(() => IncidentNotificationRuleSchema.parse(rule)).not.toThrow();
  });

  it('should apply defaults', () => {
    const rule = IncidentNotificationRuleSchema.parse({
      severity: 'low',
      channels: ['email'],
      recipients: ['security_team'],
    });

    expect(rule.notifyRegulators).toBe(false);
  });

  it('should accept all channel types', () => {
    const channels = ['email', 'sms', 'slack', 'pagerduty', 'webhook'];

    expect(() => IncidentNotificationRuleSchema.parse({
      severity: 'high',
      channels,
      recipients: ['all'],
    })).not.toThrow();
  });

  it('should reject invalid channel', () => {
    expect(() => IncidentNotificationRuleSchema.parse({
      severity: 'high',
      channels: ['carrier_pigeon'],
      recipients: ['team'],
    })).toThrow();
  });
});

describe('IncidentNotificationMatrixSchema', () => {
  it('should accept valid notification matrix with defaults', () => {
    const matrix = IncidentNotificationMatrixSchema.parse({
      rules: [
        {
          severity: 'critical',
          channels: ['pagerduty', 'sms'],
          recipients: ['ciso', 'security_team'],
        },
      ],
    });

    expect(matrix).not.toHaveProperty('escalationTimeoutMinutes');
    expect(matrix.escalationChain).toEqual([]);
    expect(matrix.rules).toHaveLength(1);
  });

  it('should accept full matrix configuration', () => {
    const matrix = IncidentNotificationMatrixSchema.parse({
      rules: [
        {
          severity: 'critical',
          channels: ['pagerduty', 'sms', 'email'],
          recipients: ['ciso', 'executive_team'],
          notifyRegulators: true,
        },
        {
          severity: 'high',
          channels: ['slack', 'email'],
          recipients: ['security_team'],
        },
        {
          severity: 'low',
          channels: ['email'],
          recipients: ['security_team'],
        },
      ],
      escalationChain: ['security_lead', 'ciso', 'ceo'],
    });

    expect(matrix.rules).toHaveLength(3);
    expect(matrix).not.toHaveProperty('escalationTimeoutMinutes');
    expect(matrix.escalationChain).toHaveLength(3);
  });
});

describe('IncidentSchema', () => {
  it('should accept complete incident', () => {
    const incident: Incident = {
      id: 'INC-2024-001',
      title: 'Unauthorized API Access Detected',
      description: 'Multiple failed authentication attempts from unknown IP range',
      severity: 'high',
      category: 'unauthorized_access',
      status: 'investigating',
      reportedBy: 'monitoring_system',
      reportedAt: 1704067200000,
      detectedAt: 1704067100000,
      affectedSystems: ['api-gateway', 'auth-service'],
      affectedDataClassifications: ['pii', 'confidential'],
      responsePhases: [
        {
          phase: 'identification',
          description: 'Identify scope of unauthorized access',
          assignedTo: 'security_team',
        },
        {
          phase: 'containment',
          description: 'Block suspicious IP range',
          assignedTo: 'network_team',
        },
      ],
      rootCause: 'Compromised API key',
      correctiveActions: ['Rotate all API keys', 'Implement IP allowlisting'],
      lessonsLearned: 'Need to implement API key rotation policy',
      relatedChangeRequestIds: ['CHG-2024-001'],
      metadata: { sourceIp: '10.0.0.1' },
    };

    expect(() => IncidentSchema.parse(incident)).not.toThrow();
  });

  it('should accept minimal incident', () => {
    const minimal = {
      id: 'INC-2024-002',
      title: 'Policy Violation',
      description: 'Employee accessed restricted data',
      severity: 'low',
      category: 'policy_violation',
      status: 'reported',
      reportedBy: 'user_123',
      reportedAt: Date.now(),
      affectedSystems: ['hr-system'],
    };

    expect(() => IncidentSchema.parse(minimal)).not.toThrow();
  });

  it('should accept resolved incident with full lifecycle', () => {
    const resolved = {
      id: 'INC-2024-003',
      title: 'Malware Detection',
      description: 'Ransomware detected on workstation',
      severity: 'critical',
      category: 'malware',
      status: 'closed',
      reportedBy: 'endpoint_detection',
      reportedAt: 1704067200000,
      detectedAt: 1704067100000,
      resolvedAt: 1704153600000,
      affectedSystems: ['workstation-42'],
      responsePhases: [
        {
          phase: 'identification',
          description: 'Identify malware type',
          assignedTo: 'security_team',
          completedAt: 1704070800000,
          notes: 'Identified as known ransomware variant',
        },
        {
          phase: 'containment',
          description: 'Isolate affected workstation',
          assignedTo: 'it_support',
          completedAt: 1704072600000,
        },
        {
          phase: 'eradication',
          description: 'Remove malware and reimage',
          assignedTo: 'it_support',
          completedAt: 1704086400000,
        },
        {
          phase: 'recovery',
          description: 'Restore from backup',
          assignedTo: 'it_support',
          completedAt: 1704115200000,
        },
        {
          phase: 'lessons_learned',
          description: 'Post-incident review',
          assignedTo: 'security_team',
          completedAt: 1704153600000,
        },
      ],
      rootCause: 'Phishing email with malicious attachment',
      correctiveActions: [
        'Block malicious email domain',
        'Update email filtering rules',
        'Deploy additional endpoint protection',
      ],
      lessonsLearned: 'Need enhanced phishing detection and user training',
    };

    expect(() => IncidentSchema.parse(resolved)).not.toThrow();
  });

  it('should accept all data classification values', () => {
    const classifications = ['pii', 'phi', 'pci', 'financial', 'confidential', 'internal', 'public'];

    const incident = {
      id: 'INC-2024-004',
      title: 'Data Breach',
      description: 'Comprehensive data breach',
      severity: 'critical',
      category: 'data_breach',
      status: 'reported',
      reportedBy: 'system',
      reportedAt: Date.now(),
      affectedSystems: ['database'],
      affectedDataClassifications: classifications,
    };

    expect(() => IncidentSchema.parse(incident)).not.toThrow();
  });

  it('should reject missing required fields', () => {
    expect(() => IncidentSchema.parse({})).toThrow();
    expect(() => IncidentSchema.parse({ id: 'INC-001' })).toThrow();
  });
});

describe('IncidentResponsePolicySchema', () => {
  it('should accept valid policy with defaults', () => {
    const policy = IncidentResponsePolicySchema.parse({
      notificationMatrix: {
        rules: [
          {
            severity: 'critical',
            channels: ['pagerduty'],
            recipients: ['security_team'],
          },
        ],
      },
      defaultResponseTeam: 'security_team',
    });

    expect(policy.enabled).toBe(true);
    expect(policy).not.toHaveProperty('triageDeadlineHours');
    expect(policy.requirePostIncidentReview).toBe(true);
    expect(policy.regulatoryNotificationThreshold).toBe('high');
    expect(policy).not.toHaveProperty('retentionDays');
  });

  it('should accept full policy configuration', () => {
    const policy = IncidentResponsePolicySchema.parse({
      enabled: true,
      notificationMatrix: {
        rules: [
          {
            severity: 'critical',
            channels: ['pagerduty', 'sms', 'email'],
            recipients: ['ciso', 'executive_team'],
            notifyRegulators: true,
          },
          {
            severity: 'high',
            channels: ['slack', 'email'],
            recipients: ['security_team'],
          },
        ],
        escalationChain: ['security_lead', 'ciso'],
      },
      defaultResponseTeam: 'incident_response_team',
      requirePostIncidentReview: true,
      regulatoryNotificationThreshold: 'critical',
    });

    expect(policy).not.toHaveProperty('triageDeadlineHours');
    expect(policy.regulatoryNotificationThreshold).toBe('critical');
    expect(policy).not.toHaveProperty('retentionDays');
  });

  it('should reject missing required fields', () => {
    expect(() => IncidentResponsePolicySchema.parse({})).toThrow();
    expect(() => IncidentResponsePolicySchema.parse({ enabled: true })).toThrow();
  });
});
