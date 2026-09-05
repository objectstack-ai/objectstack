import { describe, it, expect } from 'vitest';
import {
  DocumentVersionSchema,
  DocumentTemplateSchema,
  ESignatureConfigSchema,
  DocumentSchema,
  type Document,
  type DocumentVersion,
  type DocumentTemplate,
  type ESignatureConfig,
} from './document.zod';

describe('DocumentVersionSchema', () => {
  it('should validate complete document version', () => {
    const validVersion: DocumentVersion = {
      versionNumber: 2,
      createdAt: 1704067200000,
      createdBy: 'user_123',
      size: 2048576,
      checksum: 'a1b2c3d4e5f6',
      downloadUrl: 'https://storage.example.com/docs/v2/file.pdf',
      isLatest: true,
    };

    expect(() => DocumentVersionSchema.parse(validVersion)).not.toThrow();
  });

  it('should accept minimal version', () => {
    const minimalVersion = {
      versionNumber: 1,
      createdAt: Date.now(),
      createdBy: 'user_456',
      size: 1024,
      checksum: 'checksum123',
      downloadUrl: 'https://example.com/file.pdf',
    };

    expect(() => DocumentVersionSchema.parse(minimalVersion)).not.toThrow();
  });

  it('should default isLatest to false', () => {
    const version = {
      versionNumber: 1,
      createdAt: Date.now(),
      createdBy: 'user_123',
      size: 1024,
      checksum: 'abc',
      downloadUrl: 'https://example.com/file.pdf',
    };

    const parsed = DocumentVersionSchema.parse(version);
    expect(parsed.isLatest).toBe(false);
  });

  it('should validate download URL', () => {
    const invalidVersion = {
      versionNumber: 1,
      createdAt: Date.now(),
      createdBy: 'user_123',
      size: 1024,
      checksum: 'abc',
      downloadUrl: 'not-a-url',
    };

    expect(() => DocumentVersionSchema.parse(invalidVersion)).toThrow();
  });
});

describe('DocumentTemplateSchema', () => {
  it('should validate complete document template', () => {
    const validTemplate: DocumentTemplate = {
      id: 'contract-template',
      name: 'Service Agreement',
      description: 'Standard service agreement template',
      fileUrl: 'https://example.com/templates/contract.docx',
      fileType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      placeholders: [
        {
          key: 'client_name',
          label: 'Client Name',
          type: 'text',
          required: true,
        },
        {
          key: 'contract_date',
          label: 'Contract Date',
          type: 'date',
          required: true,
        },
        {
          key: 'amount',
          label: 'Contract Amount',
          type: 'number',
          required: false,
        },
      ],
    };

    expect(() => DocumentTemplateSchema.parse(validTemplate)).not.toThrow();
  });

  it('should accept minimal template', () => {
    const minimalTemplate = {
      id: 'simple-template',
      name: 'Simple Template',
      fileUrl: 'https://example.com/template.pdf',
      fileType: 'application/pdf',
      placeholders: [],
    };

    expect(() => DocumentTemplateSchema.parse(minimalTemplate)).not.toThrow();
  });

  it('should default placeholder required to false', () => {
    const template = {
      id: 'template-1',
      name: 'Template',
      fileUrl: 'https://example.com/template.pdf',
      fileType: 'application/pdf',
      placeholders: [
        {
          key: 'field1',
          label: 'Field 1',
          type: 'text' as const,
        },
      ],
    };

    const parsed = DocumentTemplateSchema.parse(template);
    expect(parsed.placeholders[0].required).toBe(false);
  });

  it('should accept all placeholder types', () => {
    const types = ['text', 'number', 'date', 'image'] as const;

    types.forEach((type) => {
      const template = {
        id: `template-${type}`,
        name: 'Template',
        fileUrl: 'https://example.com/template.pdf',
        fileType: 'application/pdf',
        placeholders: [
          {
            key: 'field',
            label: 'Field',
            type,
          },
        ],
      };

      expect(() => DocumentTemplateSchema.parse(template)).not.toThrow();
    });
  });

  it('should reject invalid placeholder type', () => {
    const invalidTemplate = {
      id: 'invalid-template',
      name: 'Invalid',
      fileUrl: 'https://example.com/template.pdf',
      fileType: 'application/pdf',
      placeholders: [
        {
          key: 'field',
          label: 'Field',
          type: 'invalid',
        },
      ],
    };

    expect(() => DocumentTemplateSchema.parse(invalidTemplate)).toThrow();
  });
});

describe('ESignatureConfigSchema', () => {
  it('should validate complete e-signature config', () => {
    const validConfig: ESignatureConfig = {
      provider: 'docusign',
      enabled: true,
      signers: [
        {
          email: 'client@example.com',
          name: 'John Doe',
          role: 'Client',
          order: 1,
        },
        {
          email: 'manager@example.com',
          name: 'Jane Smith',
          role: 'Manager',
          order: 2,
        },
      ],
    };

    expect(() => ESignatureConfigSchema.parse(validConfig)).not.toThrow();
  });

  it('should accept minimal e-signature config', () => {
    const minimalConfig = {
      provider: 'hellosign',
      signers: [
        {
          email: 'signer@example.com',
          name: 'Signer',
          role: 'Signer',
          order: 1,
        },
      ],
    };

    expect(() => ESignatureConfigSchema.parse(minimalConfig)).not.toThrow();
  });

  it('should default enabled to false', () => {
    const config = {
      provider: 'adobe-sign',
      signers: [
        {
          email: 'test@example.com',
          name: 'Test',
          role: 'Test',
          order: 1,
        },
      ],
    };

    const parsed = ESignatureConfigSchema.parse(config);
    expect(parsed.enabled).toBe(false);
  });

  // `expirationDays` / `reminderDays` were retiredKey() tombstones since #14477
  // (ADR-0049): the two former default pins (30 / 7) pinned exactly the branch
  // that left, so they are replaced, not adjusted. The full kit — refusal on
  // the base schema and through `DocumentSchema.eSignature`, the no-materialize
  // pin, the tsc `never` channel and the ADR-0087 registration — lives in
  // `esignature-deadline-keys-retirement.test.ts`; these two are the family
  // tests' one-line refusal witnesses (the #14477 house shape).
  it('REFUSES an authored `expirationDays` — a retiredKey() tombstone since #14477 (ADR-0049)', () => {
    const wellFormed = {
      provider: 'custom',
      signers: [{ email: 'test@example.com', name: 'Test', role: 'Test', order: 1 }],
    };
    const result = ESignatureConfigSchema.safeParse({ ...wellFormed, expirationDays: 30 });
    expect(result.success).toBe(false);
    if (result.success) return;
    const issue = result.error.issues.find((i) => i.path.join('.') === 'expirationDays');
    expect(issue?.code).toBe('invalid_type');
    expect(issue?.message).toMatch(/^`ESignatureConfig\.expirationDays` was removed in @objectstack\/spec 17 \(ADR-0049 enforce-or-remove\)/);
    // Attribution control: the same config WITHOUT the key parses, and the
    // parsed value carries neither the key nor its former default.
    const parsed = ESignatureConfigSchema.parse(wellFormed);
    expect(parsed).not.toHaveProperty('expirationDays');
  });

  it('REFUSES an authored `reminderDays` — a retiredKey() tombstone since #14477 (ADR-0049)', () => {
    const wellFormed = {
      provider: 'docusign',
      signers: [{ email: 'test@example.com', name: 'Test', role: 'Test', order: 1 }],
    };
    const result = ESignatureConfigSchema.safeParse({ ...wellFormed, reminderDays: 7 });
    expect(result.success).toBe(false);
    if (result.success) return;
    const issue = result.error.issues.find((i) => i.path.join('.') === 'reminderDays');
    expect(issue?.code).toBe('invalid_type');
    expect(issue?.message).toMatch(/^`ESignatureConfig\.reminderDays` was removed in @objectstack\/spec 17 \(ADR-0049 enforce-or-remove\)/);
    const parsed = ESignatureConfigSchema.parse(wellFormed);
    expect(parsed).not.toHaveProperty('reminderDays');
  });

  it('should accept all provider types', () => {
    const providers = ['docusign', 'adobe-sign', 'hellosign', 'custom'] as const;

    providers.forEach((provider) => {
      const config = {
        provider,
        signers: [
          {
            email: 'test@example.com',
            name: 'Test',
            role: 'Test',
            order: 1,
          },
        ],
      };

      expect(() => ESignatureConfigSchema.parse(config)).not.toThrow();
    });
  });

  it('should validate signer email addresses', () => {
    const invalidConfig = {
      provider: 'docusign',
      signers: [
        {
          email: 'not-an-email',
          name: 'Test',
          role: 'Test',
          order: 1,
        },
      ],
    };

    expect(() => ESignatureConfigSchema.parse(invalidConfig)).toThrow();
  });

  it('should accept multiple signers in order', () => {
    const config = {
      provider: 'docusign',
      signers: [
        {
          email: 'first@example.com',
          name: 'First Signer',
          role: 'Client',
          order: 1,
        },
        {
          email: 'second@example.com',
          name: 'Second Signer',
          role: 'Vendor',
          order: 2,
        },
        {
          email: 'third@example.com',
          name: 'Third Signer',
          role: 'Witness',
          order: 3,
        },
      ],
    };

    expect(() => ESignatureConfigSchema.parse(config)).not.toThrow();
  });
});

describe('DocumentSchema', () => {
  it('should validate complete document', () => {
    const validDocument: Document = {
      id: 'doc_123',
      name: 'Service Agreement 2024',
      description: 'Annual service agreement',
      fileType: 'application/pdf',
      fileSize: 1048576,
      category: 'contracts',
      tags: ['legal', '2024', 'services'],
      versioning: {
        enabled: true,
        versions: [
          {
            versionNumber: 1,
            createdAt: 1704067200000,
            createdBy: 'user_123',
            size: 1048576,
            checksum: 'abc123',
            downloadUrl: 'https://example.com/docs/v1.pdf',
            isLatest: true,
          },
        ],
        majorVersion: 1,
        minorVersion: 0,
      },
      access: {
        isPublic: false,
        sharedWith: ['user_456', 'team_789'],
        expiresAt: 1735689600000,
      },
      metadata: {
        author: 'John Doe',
        department: 'Legal',
      },
    };

    expect(() => DocumentSchema.parse(validDocument)).not.toThrow();
  });

  it('should accept minimal document', () => {
    const minimalDocument = {
      id: 'doc_456',
      name: 'Simple Document',
      fileType: 'application/pdf',
      fileSize: 1024,
    };

    expect(() => DocumentSchema.parse(minimalDocument)).not.toThrow();
  });

  it('should validate document with template', () => {
    const documentWithTemplate = {
      id: 'doc_789',
      name: 'Generated Contract',
      fileType: 'application/pdf',
      fileSize: 2048,
      template: {
        id: 'contract-template',
        name: 'Contract Template',
        fileUrl: 'https://example.com/template.docx',
        fileType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        placeholders: [
          {
            key: 'client_name',
            label: 'Client Name',
            type: 'text' as const,
            required: true,
          },
        ],
      },
    };

    expect(() => DocumentSchema.parse(documentWithTemplate)).not.toThrow();
  });

  it('should validate document with e-signature', () => {
    const documentWithSignature = {
      id: 'doc_101',
      name: 'Contract for Signature',
      fileType: 'application/pdf',
      fileSize: 1536,
      eSignature: {
        provider: 'docusign' as const,
        enabled: true,
        signers: [
          {
            email: 'client@example.com',
            name: 'Client',
            role: 'Client',
            order: 1,
          },
        ],
      },
    };

    expect(() => DocumentSchema.parse(documentWithSignature)).not.toThrow();
  });

  it('should validate versioning configuration', () => {
    const documentWithVersions = {
      id: 'doc_202',
      name: 'Versioned Document',
      fileType: 'application/pdf',
      fileSize: 2048,
      versioning: {
        enabled: true,
        versions: [
          {
            versionNumber: 1,
            createdAt: 1704000000000,
            createdBy: 'user_123',
            size: 1024,
            checksum: 'v1-checksum',
            downloadUrl: 'https://example.com/v1.pdf',
            isLatest: false,
          },
          {
            versionNumber: 2,
            createdAt: 1704067200000,
            createdBy: 'user_456',
            size: 2048,
            checksum: 'v2-checksum',
            downloadUrl: 'https://example.com/v2.pdf',
            isLatest: true,
          },
        ],
        majorVersion: 2,
        minorVersion: 0,
      },
    };

    expect(() => DocumentSchema.parse(documentWithVersions)).not.toThrow();
  });

  it('should default access.isPublic to false', () => {
    const document = {
      id: 'doc_303',
      name: 'Document',
      fileType: 'application/pdf',
      fileSize: 1024,
      access: {
        sharedWith: ['user_123'],
      },
    };

    const parsed = DocumentSchema.parse(document);
    expect(parsed.access?.isPublic).toBe(false);
  });

  it('should validate document with tags and category', () => {
    const document = {
      id: 'doc_404',
      name: 'Tagged Document',
      fileType: 'application/pdf',
      fileSize: 1024,
      category: 'invoices',
      tags: ['2024', 'Q1', 'paid'],
    };

    expect(() => DocumentSchema.parse(document)).not.toThrow();
  });

  it('should validate document with custom metadata', () => {
    const document = {
      id: 'doc_505',
      name: 'Document with Metadata',
      fileType: 'application/pdf',
      fileSize: 1024,
      metadata: {
        author: 'Jane Doe',
        department: 'Finance',
        projectCode: 'PROJ-2024-001',
        customField: 'Custom Value',
      },
    };

    expect(() => DocumentSchema.parse(document)).not.toThrow();
  });

  it('should validate complete document with all features', () => {
    const completeDocument: Document = {
      id: 'doc_complete',
      name: 'Complete Document Example',
      description: 'A fully-featured document with all options',
      fileType: 'application/pdf',
      fileSize: 5242880,
      category: 'legal-contracts',
      tags: ['important', 'signed', '2024', 'annual'],
      versioning: {
        enabled: true,
        versions: [
          {
            versionNumber: 1,
            createdAt: 1704000000000,
            createdBy: 'user_001',
            size: 5000000,
            checksum: 'checksum-v1',
            downloadUrl: 'https://storage.example.com/docs/complete-v1.pdf',
            isLatest: false,
          },
          {
            versionNumber: 2,
            createdAt: 1704067200000,
            createdBy: 'user_002',
            size: 5242880,
            checksum: 'checksum-v2',
            downloadUrl: 'https://storage.example.com/docs/complete-v2.pdf',
            isLatest: true,
          },
        ],
        majorVersion: 2,
        minorVersion: 0,
      },
      template: {
        id: 'annual-contract-template',
        name: 'Annual Contract Template',
        description: 'Standard annual contract',
        fileUrl: 'https://example.com/templates/annual-contract.docx',
        fileType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        placeholders: [
          {
            key: 'company_name',
            label: 'Company Name',
            type: 'text',
            required: true,
          },
          {
            key: 'contract_value',
            label: 'Contract Value',
            type: 'number',
            required: true,
          },
          {
            key: 'start_date',
            label: 'Start Date',
            type: 'date',
            required: true,
          },
          {
            key: 'company_logo',
            label: 'Company Logo',
            type: 'image',
            required: false,
          },
        ],
      },
      eSignature: {
        provider: 'docusign',
        enabled: true,
        signers: [
          {
            email: 'client@company.com',
            name: 'John Client',
            role: 'Client Representative',
            order: 1,
          },
          {
            email: 'vendor@example.com',
            name: 'Jane Vendor',
            role: 'Vendor Representative',
            order: 2,
          },
          {
            email: 'legal@example.com',
            name: 'Legal Counsel',
            role: 'Legal Reviewer',
            order: 3,
          },
        ],
      },
      access: {
        isPublic: false,
        sharedWith: ['user_001', 'user_002', 'team_legal', 'team_finance'],
        expiresAt: 1767225600000, // Future date
      },
      metadata: {
        author: 'Legal Department',
        department: 'Legal',
        projectCode: 'PROJ-2024-ANNUAL',
        confidentialityLevel: 'High',
        retentionYears: 7,
        complianceStandards: ['SOX', 'GDPR'],
      },
    };

    expect(() => DocumentSchema.parse(completeDocument)).not.toThrow();
  });
});
