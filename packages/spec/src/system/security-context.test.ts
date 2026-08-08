import { describe, it, expect } from 'vitest';
import {
  ComplianceAuditRequirementSchema,
  ComplianceEncryptionRequirementSchema,
  MaskingVisibilityRuleSchema,
  SecurityEventCorrelationSchema,
  DataClassificationPolicySchema,
  SecurityContextConfigSchema,
  type ComplianceAuditRequirement,
  type ComplianceEncryptionRequirement,
  type MaskingVisibilityRule,
  type SecurityEventCorrelation,
  type DataClassificationPolicy,
  type SecurityContextConfig,
} from './security-context.zod';

describe('ComplianceAuditRequirementSchema', () => {
  it('should accept valid GDPR audit requirement', () => {
    const req: ComplianceAuditRequirement = {
      framework: 'gdpr',
      requiredEvents: ['data.delete', 'data.export', 'auth.login'],
      retentionDays: 180,
      alertOnMissing: true,
    };
    const result = ComplianceAuditRequirementSchema.parse(req);
    expect(result.framework).toBe('gdpr');
    expect(result.requiredEvents).toHaveLength(3);
    expect(result.retentionDays).toBe(180);
  });

  it('should accept all framework types', () => {
    const frameworks = ['gdpr', 'hipaa', 'sox', 'pci_dss', 'ccpa', 'iso27001'] as const;
    frameworks.forEach(fw => {
      expect(() => ComplianceAuditRequirementSchema.parse({
        framework: fw,
        requiredEvents: ['data.read'],
        retentionDays: 90,
      })).not.toThrow();
    });
  });

  it('should default alertOnMissing to true', () => {
    const result = ComplianceAuditRequirementSchema.parse({
      framework: 'hipaa',
      requiredEvents: ['data.read'],
      retentionDays: 365,
    });
    expect(result.alertOnMissing).toBe(true);
  });

  it('should reject missing required fields', () => {
    expect(() => ComplianceAuditRequirementSchema.parse({})).toThrow();
    expect(() => ComplianceAuditRequirementSchema.parse({ framework: 'gdpr' })).toThrow();
  });

  it('should reject invalid framework', () => {
    expect(() => ComplianceAuditRequirementSchema.parse({
      framework: 'invalid',
      requiredEvents: [],
      retentionDays: 30,
    })).toThrow();
  });
});

describe('ComplianceEncryptionRequirementSchema', () => {
  it('should accept valid HIPAA encryption requirement', () => {
    const req: ComplianceEncryptionRequirement = {
      framework: 'hipaa',
      dataClassifications: ['phi', 'pii'],
      minimumAlgorithm: 'aes-256-gcm',
      keyRotationMaxDays: 90,
    };
    const result = ComplianceEncryptionRequirementSchema.parse(req);
    expect(result.framework).toBe('hipaa');
    expect(result.dataClassifications).toEqual(['phi', 'pii']);
  });

  it('should apply defaults for algorithm and rotation', () => {
    const result = ComplianceEncryptionRequirementSchema.parse({
      framework: 'pci_dss',
      dataClassifications: ['pci'],
    });
    expect(result.minimumAlgorithm).toBe('aes-256-gcm');
    expect(result.keyRotationMaxDays).toBe(90);
  });

  it('should accept all data classifications', () => {
    const result = ComplianceEncryptionRequirementSchema.parse({
      framework: 'gdpr',
      dataClassifications: ['pii', 'phi', 'pci', 'financial', 'confidential', 'internal', 'public'],
    });
    expect(result.dataClassifications).toHaveLength(7);
  });
});

describe('MaskingVisibilityRuleSchema', () => {
  it('should accept valid masking visibility rule', () => {
    const rule: MaskingVisibilityRule = {
      dataClassification: 'pii',
      defaultMasked: true,
      unmaskRoles: ['admin', 'compliance_officer'],
      auditUnmask: true,
      requireApproval: false,
    };
    const result = MaskingVisibilityRuleSchema.parse(rule);
    expect(result.dataClassification).toBe('pii');
    expect(result.unmaskRoles).toEqual(['admin', 'compliance_officer']);
  });

  it('should apply defaults', () => {
    const result = MaskingVisibilityRuleSchema.parse({ dataClassification: 'phi' });
    expect(result.defaultMasked).toBe(true);
    expect(result.auditUnmask).toBe(true);
    expect(result.requireApproval).toBe(false);
  });

  it('should accept approval workflow configuration', () => {
    const result = MaskingVisibilityRuleSchema.parse({
      dataClassification: 'financial',
      requireApproval: true,
      approvalRoles: ['cfo', 'auditor'],
    });
    expect(result.requireApproval).toBe(true);
    expect(result.approvalRoles).toEqual(['cfo', 'auditor']);
  });
});

describe('SecurityEventCorrelationSchema', () => {
  it('should apply all defaults for empty config', () => {
    const result = SecurityEventCorrelationSchema.parse({});
    expect(result.enabled).toBe(true);
    expect(result.correlationId).toBe(true);
    expect(result.linkAuthToAudit).toBe(true);
    expect(result.linkEncryptionToAudit).toBe(true);
    expect(result.linkMaskingToAudit).toBe(true);
  });

  it('should accept custom correlation config', () => {
    const result = SecurityEventCorrelationSchema.parse({
      enabled: true,
      linkEncryptionToAudit: false,
    });
    expect(result.linkEncryptionToAudit).toBe(false);
    expect(result.linkAuthToAudit).toBe(true);
  });
});

describe('DataClassificationPolicySchema', () => {
  it('should accept valid classification policy', () => {
    const policy: DataClassificationPolicy = {
      classification: 'pii',
      requireEncryption: true,
      requireMasking: true,
      requireAudit: true,
      retentionDays: 365,
    };
    const result = DataClassificationPolicySchema.parse(policy);
    expect(result.classification).toBe('pii');
    expect(result.requireEncryption).toBe(true);
  });

  it('should apply defaults', () => {
    const result = DataClassificationPolicySchema.parse({ classification: 'public' });
    expect(result.requireEncryption).toBe(false);
    expect(result.requireMasking).toBe(false);
    expect(result.requireAudit).toBe(false);
    expect(result.retentionDays).toBeUndefined();
  });

  it('should accept all classification levels', () => {
    const levels = ['pii', 'phi', 'pci', 'financial', 'confidential', 'internal', 'public'] as const;
    levels.forEach(level => {
      expect(() => DataClassificationPolicySchema.parse({ classification: level })).not.toThrow();
    });
  });
});

describe('SecurityContextConfigSchema', () => {
  it('should apply defaults for empty config', () => {
    const result = SecurityContextConfigSchema.parse({});
    expect(result.enabled).toBe(true);
    expect(result.enforceOnWrite).toBe(true);
    expect(result.enforceOnRead).toBe(true);
    expect(result.failOpen).toBe(false);
  });

  it('should accept full security context configuration', () => {
    const config: SecurityContextConfig = {
      enabled: true,
      complianceAuditRequirements: [
        { framework: 'gdpr', requiredEvents: ['data.delete', 'data.export'], retentionDays: 180 },
        { framework: 'hipaa', requiredEvents: ['data.read', 'data.update'], retentionDays: 365 },
      ],
      complianceEncryptionRequirements: [
        { framework: 'hipaa', dataClassifications: ['phi'] },
        { framework: 'pci_dss', dataClassifications: ['pci', 'financial'] },
      ],
      maskingVisibility: [
        { dataClassification: 'pii', unmaskRoles: ['admin'], requireApproval: true, approvalRoles: ['dpo'] },
      ],
      dataClassifications: [
        { classification: 'pii', requireEncryption: true, requireMasking: true, requireAudit: true },
        { classification: 'public', requireEncryption: false },
      ],
      eventCorrelation: { enabled: true, correlationId: true },
      enforceOnWrite: true,
      enforceOnRead: true,
      failOpen: false,
    };
    const result = SecurityContextConfigSchema.parse(config);
    expect(result.complianceAuditRequirements).toHaveLength(2);
    expect(result.complianceEncryptionRequirements).toHaveLength(2);
    expect(result.maskingVisibility).toHaveLength(1);
    expect(result.dataClassifications).toHaveLength(2);
    expect(result.eventCorrelation?.enabled).toBe(true);
  });

  it('should leave optional arrays undefined when not provided', () => {
    const result = SecurityContextConfigSchema.parse({});
    expect(result.complianceAuditRequirements).toBeUndefined();
    expect(result.complianceEncryptionRequirements).toBeUndefined();
    expect(result.maskingVisibility).toBeUndefined();
    expect(result.dataClassifications).toBeUndefined();
    expect(result.eventCorrelation).toBeUndefined();
  });

  it('should accept failOpen true for development environments', () => {
    const result = SecurityContextConfigSchema.parse({ failOpen: true });
    expect(result.failOpen).toBe(true);
  });
});

describe('Type exports', () => {
  it('should have valid type exports', () => {
    const audit: ComplianceAuditRequirement = {
      framework: 'gdpr', requiredEvents: ['data.delete'], retentionDays: 180, alertOnMissing: true,
    };
    const encryption: ComplianceEncryptionRequirement = {
      framework: 'hipaa', dataClassifications: ['phi'], minimumAlgorithm: 'aes-256-gcm', keyRotationMaxDays: 90,
    };
    const masking: MaskingVisibilityRule = {
      dataClassification: 'pii', defaultMasked: true, auditUnmask: true, requireApproval: false,
    };
    const correlation: SecurityEventCorrelation = {
      enabled: true, correlationId: true, linkAuthToAudit: true, linkEncryptionToAudit: true, linkMaskingToAudit: true,
    };
    const policy: DataClassificationPolicy = {
      classification: 'confidential', requireEncryption: true, requireMasking: false, requireAudit: true,
    };
    const context: SecurityContextConfig = {
      enabled: true, enforceOnWrite: true, enforceOnRead: true, failOpen: false,
    };
    const contextInput: SecurityContextConfig = { enabled: true };
    expect(audit).toBeDefined();
    expect(encryption).toBeDefined();
    expect(masking).toBeDefined();
    expect(correlation).toBeDefined();
    expect(policy).toBeDefined();
    expect(context).toBeDefined();
    expect(contextInput).toBeDefined();
  });
});
