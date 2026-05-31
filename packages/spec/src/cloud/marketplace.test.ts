import { describe, it, expect } from 'vitest';
import {
  PublisherVerificationSchema,
  PublisherSchema,
  MarketplaceCategorySchema,
  ListingStatusSchema,
  PricingModelSchema,
  MarketplaceListingSchema,
  PackageSubmissionSchema,
  MarketplaceSearchRequestSchema,
  MarketplaceSearchResponseSchema,
  MarketplaceInstallRequestSchema,
  MarketplaceInstallResponseSchema,
  ArtifactReferenceSchema,
  ArtifactDownloadResponseSchema,
} from './marketplace.zod';

describe('PublisherVerificationSchema', () => {
  it('should accept valid verification statuses', () => {
    const statuses = ['unverified', 'pending', 'verified', 'trusted', 'partner'];
    statuses.forEach(status => {
      expect(() => PublisherVerificationSchema.parse(status)).not.toThrow();
    });
  });

  it('should reject invalid status', () => {
    expect(() => PublisherVerificationSchema.parse('approved')).toThrow();
  });
});

describe('PublisherSchema', () => {
  it('should accept minimal publisher', () => {
    const publisher = {
      id: 'pub-001',
      name: 'Acme Corp',
      type: 'organization' as const,
    };
    const parsed = PublisherSchema.parse(publisher);
    expect(parsed.verification).toBe('unverified');
  });

  it('should accept full publisher profile', () => {
    const publisher = {
      id: 'pub-001',
      name: 'Acme Corp',
      type: 'organization' as const,
      verification: 'verified' as const,
      email: 'support@acme.com',
      website: 'https://acme.com',
      logoUrl: 'https://acme.com/logo.png',
      description: 'Leading enterprise solutions provider',
      registeredAt: '2025-01-15T10:00:00Z',
    };
    const parsed = PublisherSchema.parse(publisher);
    expect(parsed.verification).toBe('verified');
  });
});

describe('MarketplaceCategorySchema', () => {
  it('should accept all valid categories', () => {
    const categories = [
      'crm', 'erp', 'hr', 'finance', 'project', 'collaboration',
      'analytics', 'integration', 'automation', 'ai', 'security',
      'developer-tools', 'ui-theme', 'storage', 'other',
    ];
    categories.forEach(cat => {
      expect(() => MarketplaceCategorySchema.parse(cat)).not.toThrow();
    });
  });
});

describe('ListingStatusSchema', () => {
  it('should accept all listing statuses', () => {
    const statuses = [
      'draft', 'submitted', 'in-review', 'approved', 'published',
      'rejected', 'suspended', 'deprecated', 'unlisted',
    ];
    statuses.forEach(status => {
      expect(() => ListingStatusSchema.parse(status)).not.toThrow();
    });
  });
});

describe('PricingModelSchema', () => {
  it('should accept all pricing models', () => {
    const models = ['free', 'freemium', 'paid', 'subscription', 'usage-based', 'contact-sales'];
    models.forEach(model => {
      expect(() => PricingModelSchema.parse(model)).not.toThrow();
    });
  });
});

describe('MarketplaceListingSchema', () => {
  it('should accept minimal listing', () => {
    const listing = {
      id: 'listing-001',
      packageId: 'com.acme.crm',
      publisherId: 'pub-001',
      name: 'Acme CRM',
      category: 'crm' as const,
      latestVersion: '1.0.0',
    };
    const parsed = MarketplaceListingSchema.parse(listing);
    expect(parsed.status).toBe('draft');
    expect(parsed.pricing).toBe('free');
  });

  it('defaults packageType to `app` (ADR-0019 — only Apps are listable)', () => {
    const listing = {
      id: 'listing-001',
      packageId: 'com.acme.crm',
      publisherId: 'pub-001',
      name: 'Acme CRM',
      category: 'crm' as const,
      latestVersion: '1.0.0',
    };
    expect(MarketplaceListingSchema.parse(listing).packageType).toBe('app');
  });

  it('rejects a non-consumer-installable packageType (driver/plugin/… cannot be listed)', () => {
    const listing = {
      id: 'listing-001',
      packageId: 'com.acme.pg-driver',
      publisherId: 'pub-001',
      name: 'Postgres Driver',
      category: 'crm' as const,
      latestVersion: '1.0.0',
      packageType: 'driver',
    };
    expect(() => MarketplaceListingSchema.parse(listing)).toThrow();
  });

  it('should accept full listing', () => {
    const listing = {
      id: 'listing-001',
      packageId: 'com.acme.crm',
      publisherId: 'pub-001',
      status: 'published' as const,
      name: 'Acme CRM',
      tagline: 'Complete customer relationship management for ObjectStack',
      description: '# Acme CRM\n\nFull-featured CRM with sales pipeline...',
      category: 'crm' as const,
      tags: ['sales', 'pipeline', 'contacts'],
      iconUrl: 'https://acme.com/crm-icon.png',
      screenshots: [
        { url: 'https://acme.com/screenshot1.png', caption: 'Sales Pipeline' },
        { url: 'https://acme.com/screenshot2.png', caption: 'Contact Management' },
      ],
      documentationUrl: 'https://docs.acme.com/crm',
      supportUrl: 'https://support.acme.com',
      repositoryUrl: 'https://github.com/acme/crm',
      pricing: 'freemium' as const,
      priceInCents: 999,
      latestVersion: '2.1.0',
      minPlatformVersion: '1.0.0',
      versions: [
        {
          version: '2.1.0',
          releaseDate: '2025-06-01T00:00:00Z',
          releaseNotes: 'Added deal forecasting',
        },
        {
          version: '2.0.0',
          releaseDate: '2025-03-01T00:00:00Z',
          releaseNotes: 'Major update with new pipeline view',
          deprecated: false,
        },
      ],
      stats: {
        totalInstalls: 5000,
        activeInstalls: 3200,
        averageRating: 4.5,
        totalRatings: 120,
        totalReviews: 45,
      },
      publishedAt: '2025-01-15T00:00:00Z',
      updatedAt: '2025-06-01T00:00:00Z',
    };
    const parsed = MarketplaceListingSchema.parse(listing);
    expect(parsed.screenshots).toHaveLength(2);
    expect(parsed.versions).toHaveLength(2);
    expect(parsed.stats?.totalInstalls).toBe(5000);
  });

  it('should enforce tagline max length', () => {
    const listing = {
      id: 'listing-001',
      packageId: 'com.acme.crm',
      publisherId: 'pub-001',
      name: 'Test',
      tagline: 'x'.repeat(121),
      category: 'other' as const,
      latestVersion: '1.0.0',
    };
    expect(() => MarketplaceListingSchema.parse(listing)).toThrow();
  });
});

describe('PackageSubmissionSchema', () => {
  it('should accept minimal submission', () => {
    const submission = {
      id: 'sub-001',
      packageId: 'com.acme.crm',
      version: '2.0.0',
      publisherId: 'pub-001',
      artifactUrl: 'https://registry.objectstack.io/packages/com.acme.crm-2.0.0.tgz',
    };
    const parsed = PackageSubmissionSchema.parse(submission);
    expect(parsed.status).toBe('pending');
    expect(parsed.isNewListing).toBe(false);
  });

  it('should accept submission with scan results', () => {
    const submission = {
      id: 'sub-001',
      packageId: 'com.acme.crm',
      version: '2.0.0',
      publisherId: 'pub-001',
      status: 'scanning' as const,
      artifactUrl: 'https://registry.objectstack.io/packages/com.acme.crm-2.0.0.tgz',
      releaseNotes: 'Added deal module and improved account views',
      isNewListing: false,
      scanResults: {
        passed: true,
        securityScore: 92,
        compatibilityCheck: true,
        issues: [
          { severity: 'low' as const, message: 'Unused dependency detected', file: 'package.json' },
        ],
      },
    };
    const parsed = PackageSubmissionSchema.parse(submission);
    expect(parsed.scanResults?.passed).toBe(true);
    expect(parsed.scanResults?.securityScore).toBe(92);
  });

  it('should accept all submission statuses', () => {
    const statuses = ['pending', 'scanning', 'in-review', 'changes-requested', 'approved', 'rejected'];
    statuses.forEach(status => {
      const submission = {
        id: 'sub-001',
        packageId: 'com.acme.crm',
        version: '1.0.0',
        publisherId: 'pub-001',
        status,
        artifactUrl: 'https://registry.objectstack.io/pkg.tgz',
      };
      expect(() => PackageSubmissionSchema.parse(submission)).not.toThrow();
    });
  });
});

describe('MarketplaceSearchRequestSchema', () => {
  it('should accept empty search (browse all)', () => {
    const parsed = MarketplaceSearchRequestSchema.parse({});
    expect(parsed.sortBy).toBe('relevance');
    expect(parsed.sortDirection).toBe('desc');
    expect(parsed.page).toBe(1);
    expect(parsed.pageSize).toBe(20);
  });

  it('should accept search with filters', () => {
    const request = {
      query: 'crm',
      category: 'crm' as const,
      pricing: 'free' as const,
      publisherVerification: 'verified' as const,
      sortBy: 'popularity' as const,
      page: 2,
      pageSize: 50,
    };
    const parsed = MarketplaceSearchRequestSchema.parse(request);
    expect(parsed.query).toBe('crm');
    expect(parsed.category).toBe('crm');
    expect(parsed.page).toBe(2);
  });

  it('should reject invalid page size', () => {
    expect(() => MarketplaceSearchRequestSchema.parse({ pageSize: 0 })).toThrow();
    expect(() => MarketplaceSearchRequestSchema.parse({ pageSize: 101 })).toThrow();
  });
});

describe('MarketplaceSearchResponseSchema', () => {
  it('should accept empty search results', () => {
    const response = {
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    };
    const parsed = MarketplaceSearchResponseSchema.parse(response);
    expect(parsed.items).toHaveLength(0);
  });

  it('should accept search results with facets', () => {
    const response = {
      items: [{
        id: 'listing-001',
        packageId: 'com.acme.crm',
        publisherId: 'pub-001',
        name: 'Acme CRM',
        category: 'crm' as const,
        latestVersion: '1.0.0',
      }],
      total: 1,
      page: 1,
      pageSize: 20,
      facets: {
        categories: [
          { category: 'crm' as const, count: 12 },
          { category: 'erp' as const, count: 8 },
        ],
        pricing: [
          { model: 'free' as const, count: 15 },
          { model: 'paid' as const, count: 5 },
        ],
      },
    };
    const parsed = MarketplaceSearchResponseSchema.parse(response);
    expect(parsed.facets?.categories).toHaveLength(2);
  });
});

describe('MarketplaceInstallRequestSchema', () => {
  it('should accept minimal install request', () => {
    const request = {
      listingId: 'listing-001',
    };
    const parsed = MarketplaceInstallRequestSchema.parse(request);
    expect(parsed.enableOnInstall).toBe(true);
  });

  it('should accept full install request with license', () => {
    const request = {
      listingId: 'listing-001',
      version: '2.0.0',
      licenseKey: 'LICENSE-KEY-12345',
      settings: { apiKey: 'sk-test-123' },
      enableOnInstall: true,
      tenantId: 'tenant-001',
    };
    const parsed = MarketplaceInstallRequestSchema.parse(request);
    expect(parsed.version).toBe('2.0.0');
    expect(parsed.licenseKey).toBe('LICENSE-KEY-12345');
  });
});

describe('MarketplaceInstallResponseSchema', () => {
  it('should accept successful install', () => {
    const response = {
      success: true,
      packageId: 'com.acme.crm',
      version: '2.0.0',
      message: 'Package installed successfully',
    };
    const parsed = MarketplaceInstallResponseSchema.parse(response);
    expect(parsed.success).toBe(true);
  });

  it('should accept failed install', () => {
    const response = {
      success: false,
      message: 'License key invalid',
    };
    const parsed = MarketplaceInstallResponseSchema.parse(response);
    expect(parsed.success).toBe(false);
  });
});

describe('ArtifactReferenceSchema', () => {
  it('should accept valid artifact reference', () => {
    const ref = {
      url: 'https://registry.objectstack.io/packages/com.acme.crm-2.0.0.tgz',
      sha256: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2',
      size: 1048576,
      uploadedAt: '2025-06-01T12:00:00Z',
    };
    const parsed = ArtifactReferenceSchema.parse(ref);
    expect(parsed.format).toBe('tgz');
    expect(parsed.size).toBe(1048576);
  });

  it('should accept zip format', () => {
    const ref = {
      url: 'https://registry.objectstack.io/packages/com.acme.crm-2.0.0.zip',
      sha256: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2',
      size: 2048576,
      format: 'zip' as const,
      uploadedAt: '2025-06-01T12:00:00Z',
    };
    const parsed = ArtifactReferenceSchema.parse(ref);
    expect(parsed.format).toBe('zip');
  });

  it('should reject invalid SHA256', () => {
    expect(() => ArtifactReferenceSchema.parse({
      url: 'https://registry.objectstack.io/pkg.tgz',
      sha256: 'invalid-hash',
      size: 1024,
      uploadedAt: '2025-06-01T12:00:00Z',
    })).toThrow();
  });

  it('should reject non-positive size', () => {
    expect(() => ArtifactReferenceSchema.parse({
      url: 'https://registry.objectstack.io/pkg.tgz',
      sha256: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2',
      size: 0,
      uploadedAt: '2025-06-01T12:00:00Z',
    })).toThrow();
  });
});

describe('ArtifactDownloadResponseSchema', () => {
  it('should accept valid download response', () => {
    const response = {
      downloadUrl: 'https://cdn.objectstack.io/artifacts/com.acme.crm-2.0.0.tgz?token=abc',
      sha256: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2',
      size: 1048576,
      format: 'tgz' as const,
      expiresAt: '2025-06-01T13:00:00Z',
    };
    const parsed = ArtifactDownloadResponseSchema.parse(response);
    expect(parsed.expiresAt).toBe('2025-06-01T13:00:00Z');
  });

  it('should accept response without expiration', () => {
    const response = {
      downloadUrl: 'https://cdn.objectstack.io/artifacts/com.acme.crm-2.0.0.tgz',
      sha256: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2',
      size: 1048576,
      format: 'tgz' as const,
    };
    const parsed = ArtifactDownloadResponseSchema.parse(response);
    expect(parsed.expiresAt).toBeUndefined();
  });
});

describe('MarketplaceListingSchema - Artifact References', () => {
  it('should accept listing with artifact references in versions', () => {
    const listing = {
      id: 'listing-001',
      packageId: 'com.acme.crm',
      publisherId: 'pub-001',
      name: 'Acme CRM',
      category: 'crm' as const,
      latestVersion: '2.0.0',
      versions: [
        {
          version: '2.0.0',
          releaseDate: '2025-06-01T00:00:00Z',
          artifact: {
            url: 'https://registry.objectstack.io/packages/com.acme.crm-2.0.0.tgz',
            sha256: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2',
            size: 1048576,
            uploadedAt: '2025-06-01T00:00:00Z',
          },
        },
      ],
    };
    const parsed = MarketplaceListingSchema.parse(listing);
    expect(parsed.versions![0].artifact?.sha256).toBe('a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2');
  });
});

describe('MarketplaceInstallRequestSchema - Artifact Reference', () => {
  it('should accept install request with artifact reference', () => {
    const request = {
      listingId: 'listing-001',
      version: '2.0.0',
      artifactRef: {
        url: 'https://registry.objectstack.io/packages/com.acme.crm-2.0.0.tgz',
        sha256: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2',
        size: 1048576,
        uploadedAt: '2025-06-01T00:00:00Z',
      },
    };
    const parsed = MarketplaceInstallRequestSchema.parse(request);
    expect(parsed.artifactRef?.url).toContain('com.acme.crm');
  });
});
