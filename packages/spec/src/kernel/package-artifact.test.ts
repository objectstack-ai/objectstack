import { describe, it, expect } from 'vitest';
import {
  MetadataCategoryEnum,
  ArtifactFileEntrySchema,
  ArtifactChecksumSchema,
  ArtifactSignatureSchema,
  PackageArtifactSchema,
} from './package-artifact.zod';

describe('MetadataCategoryEnum', () => {
  it('should accept all valid metadata categories', () => {
    const categories = [
      'objects', 'views', 'pages', 'flows', 'dashboards',
      'permissions', 'agents', 'reports', 'actions',
      'translations', 'themes', 'datasets', 'apis',
      'triggers', 'workflows',
    ];
    categories.forEach(cat => {
      expect(() => MetadataCategoryEnum.parse(cat)).not.toThrow();
    });
  });

  it('should reject invalid categories', () => {
    expect(() => MetadataCategoryEnum.parse('invalid')).toThrow();
    expect(() => MetadataCategoryEnum.parse('')).toThrow();
  });
});

describe('ArtifactFileEntrySchema', () => {
  it('should accept valid file entry', () => {
    const entry = {
      path: 'metadata/objects/account.object.json',
      size: 1024,
      category: 'objects' as const,
    };
    const parsed = ArtifactFileEntrySchema.parse(entry);
    expect(parsed.path).toBe('metadata/objects/account.object.json');
    expect(parsed.size).toBe(1024);
    expect(parsed.category).toBe('objects');
  });

  it('should accept file entry without category', () => {
    const entry = {
      path: 'manifest.json',
      size: 512,
    };
    const parsed = ArtifactFileEntrySchema.parse(entry);
    expect(parsed.category).toBeUndefined();
  });

  it('should reject negative file size', () => {
    expect(() => ArtifactFileEntrySchema.parse({
      path: 'test.json',
      size: -1,
    })).toThrow();
  });
});

describe('ArtifactChecksumSchema', () => {
  it('should accept valid checksum map', () => {
    const checksums = {
      files: {
        'manifest.json': 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
        'metadata/objects/account.object.json': 'd4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5',
      },
    };
    const parsed = ArtifactChecksumSchema.parse(checksums);
    expect(parsed.algorithm).toBe('sha256');
    expect(Object.keys(parsed.files)).toHaveLength(2);
  });

  it('should accept explicit algorithm', () => {
    const checksums = {
      algorithm: 'sha512' as const,
      files: {
        'manifest.json': 'abcdef0123456789',
      },
    };
    const parsed = ArtifactChecksumSchema.parse(checksums);
    expect(parsed.algorithm).toBe('sha512');
  });

  it('should reject invalid hash values', () => {
    expect(() => ArtifactChecksumSchema.parse({
      files: {
        'manifest.json': 'INVALID-HASH-WITH-UPPERCASE',
      },
    })).toThrow();
  });
});

describe('ArtifactSignatureSchema', () => {
  it('should accept valid signature', () => {
    const signature = {
      publicKeyRef: 'https://keys.objectstack.io/publishers/acme/public.pem',
      signature: 'base64encodedSignatureValue==',
      signedAt: '2025-06-01T12:00:00Z',
      signedBy: 'pub-acme-001',
    };
    const parsed = ArtifactSignatureSchema.parse(signature);
    expect(parsed.algorithm).toBe('RSA-SHA256');
    expect(parsed.signedBy).toBe('pub-acme-001');
  });

  it('should accept signature with explicit algorithm', () => {
    const signature = {
      algorithm: 'ECDSA-SHA256' as const,
      publicKeyRef: 'fingerprint:SHA256:abc123',
      signature: 'ecdsaSignatureValue==',
    };
    const parsed = ArtifactSignatureSchema.parse(signature);
    expect(parsed.algorithm).toBe('ECDSA-SHA256');
  });

  it('should accept minimal signature (no optional fields)', () => {
    const signature = {
      publicKeyRef: 'https://keys.objectstack.io/pub.pem',
      signature: 'signatureValue==',
    };
    expect(() => ArtifactSignatureSchema.parse(signature)).not.toThrow();
  });
});

describe('PackageArtifactSchema', () => {
  it('should accept minimal artifact', () => {
    const artifact = {
      packageId: 'com.acme.crm',
      version: '1.0.0',
      builtAt: '2025-06-01T12:00:00Z',
    };
    const parsed = PackageArtifactSchema.parse(artifact);
    expect(parsed.formatVersion).toBe('1.0');
    expect(parsed.format).toBe('tgz');
    expect(parsed.packageId).toBe('com.acme.crm');
  });

  it('should accept complete artifact', () => {
    const artifact = {
      formatVersion: '1.0',
      packageId: 'com.acme.crm',
      version: '2.1.0',
      format: 'tgz' as const,
      size: 1048576,
      builtAt: '2025-06-01T12:00:00Z',
      builtWith: 'os-cli@3.2.0',
      files: [
        { path: 'manifest.json', size: 512 },
        { path: 'metadata/objects/account.object.json', size: 2048, category: 'objects' as const },
        { path: 'metadata/views/account-list.view.json', size: 1024, category: 'views' as const },
        { path: 'assets/icon.svg', size: 4096 },
        { path: 'data/seed.json', size: 8192 },
        { path: 'locales/en.json', size: 256 },
      ],
      // Was `as const[]` — which TypeScript reads as "array of the type named
      // `const`", i.e. TS2304 "Cannot find name 'const'". A typo that survived
      // because esbuild strips the annotation without resolving it (#5286).
      metadataCategories: ['objects', 'views'],
      checksums: {
        algorithm: 'sha256' as const,
        files: {
          'manifest.json': 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
          'metadata/objects/account.object.json': 'd4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5',
        },
      },
      signature: {
        algorithm: 'RSA-SHA256' as const,
        publicKeyRef: 'https://keys.objectstack.io/publishers/acme/public.pem',
        signature: 'base64encodedSignatureValue==',
        signedAt: '2025-06-01T12:00:00Z',
        signedBy: 'pub-acme-001',
      },
    };
    const parsed = PackageArtifactSchema.parse(artifact);
    expect(parsed.files).toHaveLength(6);
    expect(parsed.checksums?.algorithm).toBe('sha256');
    expect(parsed.signature?.algorithm).toBe('RSA-SHA256');
  });

  it('should accept zip format', () => {
    const artifact = {
      packageId: 'com.acme.crm',
      version: '1.0.0',
      format: 'zip' as const,
      builtAt: '2025-06-01T12:00:00Z',
    };
    const parsed = PackageArtifactSchema.parse(artifact);
    expect(parsed.format).toBe('zip');
  });

  it('should reject missing required fields', () => {
    expect(() => PackageArtifactSchema.parse({})).toThrow();
    expect(() => PackageArtifactSchema.parse({ packageId: 'test' })).toThrow();
    expect(() => PackageArtifactSchema.parse({ packageId: 'test', version: '1.0.0' })).toThrow();
  });

  it('should reject invalid format version', () => {
    expect(() => PackageArtifactSchema.parse({
      formatVersion: 'invalid',
      packageId: 'com.acme.crm',
      version: '1.0.0',
      builtAt: '2025-06-01T12:00:00Z',
    })).toThrow();
  });

  it('should reject non-positive size', () => {
    expect(() => PackageArtifactSchema.parse({
      packageId: 'com.acme.crm',
      version: '1.0.0',
      size: 0,
      builtAt: '2025-06-01T12:00:00Z',
    })).toThrow();
  });
});
