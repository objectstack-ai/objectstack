import { describe, it, expect } from 'vitest';
import {
  StorageScopeSchema,
  FileMetadataSchema,
  StorageProviderSchema,
  StorageAclSchema,
  StorageClassSchema,
  LifecycleActionSchema,
  ObjectMetadataSchema,
  PresignedUrlConfigSchema,
  MultipartUploadConfigSchema,
  AccessControlConfigSchema,
  LifecyclePolicyRuleSchema,
  LifecyclePolicyConfigSchema,
  BucketConfigSchema,
  StorageConnectionSchema,
  ObjectStorageConfigSchema,
  type StorageScope,
  type FileMetadata,
  type StorageProvider,
  type StorageAcl,
  type StorageClass,
  type ObjectMetadata,
  type PresignedUrlConfig,
  type MultipartUploadConfig,
  type AccessControlConfig,
  type LifecyclePolicyRule,
  type LifecyclePolicyConfig,
  type BucketConfig,
  type StorageConnection,
  type ObjectStorageConfig,
} from './object-storage.zod';

describe('StorageScopeSchema', () => {
  it('should accept valid storage scopes', () => {
    expect(() => StorageScopeSchema.parse('global')).not.toThrow();
    expect(() => StorageScopeSchema.parse('tenant')).not.toThrow();
    expect(() => StorageScopeSchema.parse('user')).not.toThrow();
    expect(() => StorageScopeSchema.parse('session')).not.toThrow();
    expect(() => StorageScopeSchema.parse('temp')).not.toThrow();
    expect(() => StorageScopeSchema.parse('cache')).not.toThrow();
    expect(() => StorageScopeSchema.parse('data')).not.toThrow();
    expect(() => StorageScopeSchema.parse('logs')).not.toThrow();
    expect(() => StorageScopeSchema.parse('config')).not.toThrow();
    expect(() => StorageScopeSchema.parse('public')).not.toThrow();
  });

  it('should reject invalid storage scopes', () => {
    expect(() => StorageScopeSchema.parse('invalid')).toThrow();
  });
});

describe('FileMetadataSchema', () => {
  it('should accept valid file metadata', () => {
    const metadata: FileMetadata = {
      path: '/uploads/file.txt',
      name: 'file.txt',
      size: 1024,
      mimeType: 'text/plain',
      lastModified: '2024-01-15T10:30:00.000Z',
      created: '2024-01-15T10:00:00.000Z',
      etag: '"abc123"',
    };
    
    expect(() => FileMetadataSchema.parse(metadata)).not.toThrow();
  });

  it('should accept metadata without optional fields', () => {
    const metadata: FileMetadata = {
      path: '/uploads/file.txt',
      name: 'file.txt',
      size: 1024,
      mimeType: 'text/plain',
      lastModified: '2024-01-15T10:30:00.000Z',
      created: '2024-01-15T10:00:00.000Z',
    };
    
    expect(() => FileMetadataSchema.parse(metadata)).not.toThrow();
  });
});

describe('StorageProviderSchema', () => {
  it('should accept valid storage providers', () => {
    expect(() => StorageProviderSchema.parse('s3')).not.toThrow();
    expect(() => StorageProviderSchema.parse('azure_blob')).not.toThrow();
    expect(() => StorageProviderSchema.parse('gcs')).not.toThrow();
    expect(() => StorageProviderSchema.parse('minio')).not.toThrow();
    expect(() => StorageProviderSchema.parse('r2')).not.toThrow();
  });

  it('should reject invalid storage providers', () => {
    expect(() => StorageProviderSchema.parse('unknown')).toThrow();
    expect(() => StorageProviderSchema.parse('S3')).toThrow(); // case sensitive
  });
});

describe('StorageAclSchema', () => {
  it('should accept valid ACL values', () => {
    expect(() => StorageAclSchema.parse('private')).not.toThrow();
    expect(() => StorageAclSchema.parse('public_read')).not.toThrow();
    expect(() => StorageAclSchema.parse('bucket_owner_full_control')).not.toThrow();
  });

  it('should reject invalid ACL values', () => {
    expect(() => StorageAclSchema.parse('invalid_acl')).toThrow();
  });
});

describe('StorageClassSchema', () => {
  it('should accept valid storage classes', () => {
    expect(() => StorageClassSchema.parse('standard')).not.toThrow();
    expect(() => StorageClassSchema.parse('intelligent')).not.toThrow();
    expect(() => StorageClassSchema.parse('glacier')).not.toThrow();
    expect(() => StorageClassSchema.parse('deep_archive')).not.toThrow();
  });
});

describe('ObjectMetadataSchema', () => {
  it('should accept minimal metadata', () => {
    const metadata = ObjectMetadataSchema.parse({
      contentType: 'image/jpeg',
      contentLength: 1024000,
    });

    expect(metadata.contentType).toBe('image/jpeg');
    expect(metadata.contentLength).toBe(1024000);
  });

  it('should accept full metadata with all fields', () => {
    const metadata = ObjectMetadataSchema.parse({
      contentType: 'application/pdf',
      contentLength: 2048000,
      contentEncoding: 'gzip',
      contentDisposition: 'attachment; filename="document.pdf"',
      contentLanguage: 'en-US',
      cacheControl: 'max-age=3600',
      etag: '"abc123def456"',
      lastModified: '2024-01-01T00:00:00.000Z',
      versionId: 'v1.0',
      storageClass: 'standard',
      encryption: {
        algorithm: 'AES256',
      },
      custom: {
        uploadedBy: 'user123',
        department: 'marketing',
      },
    });

    expect(metadata.contentType).toBe('application/pdf');
    expect(metadata.custom?.uploadedBy).toBe('user123');
  });

  it('should accept encryption with KMS key', () => {
    const metadata = ObjectMetadataSchema.parse({
      contentType: 'text/plain',
      contentLength: 100,
      encryption: {
        algorithm: 'aws:kms',
        keyId: 'arn:aws:kms:us-east-1:123456789:key/abc-123',
      },
    });

    expect(metadata.encryption?.algorithm).toBe('aws:kms');
    expect(metadata.encryption?.keyId).toBeDefined();
  });

  it('should reject negative content length', () => {
    expect(() => ObjectMetadataSchema.parse({
      contentType: 'text/plain',
      contentLength: -1,
    })).toThrow();
  });
});

describe('PresignedUrlConfigSchema', () => {
  it('should accept GET operation config', () => {
    const config = PresignedUrlConfigSchema.parse({
      operation: 'get',
      expiresIn: 3600,
    });

    expect(config.operation).toBe('get');
    expect(config.expiresIn).toBe(3600);
  });

  it('should accept PUT operation with constraints', () => {
    const config = PresignedUrlConfigSchema.parse({
      operation: 'put',
      expiresIn: 900,
      contentType: 'image/jpeg',
      maxSize: 10485760,
    });

    expect(config.operation).toBe('put');
    expect(config.maxSize).toBe(10485760);
  });

  it('should accept response overrides', () => {
    const config = PresignedUrlConfigSchema.parse({
      operation: 'get',
      expiresIn: 1800,
      responseContentType: 'application/octet-stream',
      responseContentDisposition: 'attachment; filename="download.pdf"',
    });

    expect(config.responseContentType).toBe('application/octet-stream');
  });

  it('should enforce max expiration of 7 days', () => {
    expect(() => PresignedUrlConfigSchema.parse({
      operation: 'get',
      expiresIn: 604800, // 7 days - should pass
    })).not.toThrow();

    expect(() => PresignedUrlConfigSchema.parse({
      operation: 'get',
      expiresIn: 604801, // 7 days + 1 second - should fail
    })).toThrow();
  });

  it('should enforce minimum expiration', () => {
    expect(() => PresignedUrlConfigSchema.parse({
      operation: 'get',
      expiresIn: 0,
    })).toThrow();
  });
});

describe('MultipartUploadConfigSchema', () => {
  it('should accept default config', () => {
    const config = MultipartUploadConfigSchema.parse({});

    expect(config.enabled).toBe(true);
    expect(config.partSize).toBe(10 * 1024 * 1024); // 10MB
    expect(config.maxParts).toBe(10000);
    expect(config.threshold).toBe(100 * 1024 * 1024); // 100MB
    expect(config.maxConcurrent).toBe(4);
  });

  it('should accept custom config', () => {
    const config = MultipartUploadConfigSchema.parse({
      enabled: true,
      partSize: 5 * 1024 * 1024,
      maxParts: 5000,
      threshold: 50 * 1024 * 1024,
      maxConcurrent: 8,
      abortIncompleteAfterDays: 7,
    });

    expect(config.partSize).toBe(5 * 1024 * 1024);
    expect(config.abortIncompleteAfterDays).toBe(7);
  });

  it('should enforce minimum part size of 5MB', () => {
    expect(() => MultipartUploadConfigSchema.parse({
      partSize: 5 * 1024 * 1024, // 5MB - should pass
    })).not.toThrow();

    expect(() => MultipartUploadConfigSchema.parse({
      partSize: 5 * 1024 * 1024 - 1, // Just under 5MB - should fail
    })).toThrow();
  });

  it('should enforce maximum part size of 5GB', () => {
    expect(() => MultipartUploadConfigSchema.parse({
      partSize: 5 * 1024 * 1024 * 1024, // 5GB - should pass
    })).not.toThrow();

    expect(() => MultipartUploadConfigSchema.parse({
      partSize: 5 * 1024 * 1024 * 1024 + 1, // Just over 5GB - should fail
    })).toThrow();
  });

  it('should enforce max parts limit of 10000', () => {
    expect(() => MultipartUploadConfigSchema.parse({
      maxParts: 10001,
    })).toThrow();
  });
});

describe('AccessControlConfigSchema', () => {
  it('should accept default config', () => {
    const config = AccessControlConfigSchema.parse({});

    expect(config.acl).toBe('private');
    expect(config.corsEnabled).toBe(false);
  });

  it('should accept CORS configuration', () => {
    const config = AccessControlConfigSchema.parse({
      acl: 'private',
      corsEnabled: true,
      allowedOrigins: ['https://app.example.com', 'https://www.example.com'],
      allowedMethods: ['GET', 'PUT', 'POST'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      exposeHeaders: ['ETag', 'Content-Length'],
      maxAgeSeconds: 3600,
    });

    expect(config.corsEnabled).toBe(true);
    expect(config.allowedOrigins).toHaveLength(2);
    expect(config.maxAgeSeconds).toBe(3600);
  });

  it('should accept public access configuration', () => {
    const config = AccessControlConfigSchema.parse({
      acl: 'public_read',
      publicAccess: {
        allowPublicRead: true,
        allowPublicWrite: false,
        allowPublicList: false,
      },
    });

    expect(config.publicAccess?.allowPublicRead).toBe(true);
    expect(config.publicAccess?.allowPublicWrite).toBe(false);
  });

  it('should accept IP allow/block lists', () => {
    const config = AccessControlConfigSchema.parse({
      allowedIps: ['192.168.1.0/24', '10.0.0.1'],
      blockedIps: ['1.2.3.4'],
    });

    expect(config.allowedIps).toHaveLength(2);
    expect(config.blockedIps).toHaveLength(1);
  });
});

describe('LifecyclePolicyRuleSchema', () => {
  it('should accept transition rule', () => {
    const rule = LifecyclePolicyRuleSchema.parse({
      id: 'move_to_glacier',
      enabled: true,
      action: 'transition',
      daysAfterCreation: 30,
      targetStorageClass: 'glacier',
    });

    expect(rule.action).toBe('transition');
    expect(rule.targetStorageClass).toBe('glacier');
  });

  it('should accept delete rule', () => {
    const rule = LifecyclePolicyRuleSchema.parse({
      id: 'delete_old_files',
      enabled: true,
      action: 'delete',
      daysAfterCreation: 365,
    });

    expect(rule.action).toBe('delete');
    expect(rule.daysAfterCreation).toBe(365);
  });

  it('should accept rule with prefix filter', () => {
    const rule = LifecyclePolicyRuleSchema.parse({
      id: 'archive_temp',
      enabled: true,
      action: 'delete',
      prefix: 'temp/',
      daysAfterCreation: 7,
    });

    expect(rule.prefix).toBe('temp/');
  });

  it('should accept rule with tag filters', () => {
    const rule = LifecyclePolicyRuleSchema.parse({
      id: 'archive_tagged',
      enabled: true,
      action: 'transition',
      tags: { status: 'archived', year: '2023' },
      daysAfterCreation: 90,
      targetStorageClass: 'glacier',
    });

    expect(rule.tags?.status).toBe('archived');
  });

  it('should validate rule ID format (snake_case)', () => {
    expect(() => LifecyclePolicyRuleSchema.parse({
      id: 'valid_rule_name',
      enabled: true,
      action: 'delete',
      daysAfterCreation: 30,
    })).not.toThrow();

    expect(() => LifecyclePolicyRuleSchema.parse({
      id: 'Invalid-Rule',
      enabled: true,
      action: 'delete',
      daysAfterCreation: 30,
    })).toThrow();
  });

  it('should require targetStorageClass when action is transition', () => {
    expect(() => LifecyclePolicyRuleSchema.parse({
      id: 'move_to_glacier',
      enabled: true,
      action: 'transition',
      daysAfterCreation: 30,
      // missing targetStorageClass
    })).toThrow();
    
    // Verify the specific error message
    try {
      LifecyclePolicyRuleSchema.parse({
        id: 'move_to_glacier',
        enabled: true,
        action: 'transition',
        daysAfterCreation: 30,
      });
    } catch (error: any) {
      expect(error.issues[0].message).toContain('targetStorageClass is required');
    }
  });

  it('should accept transition rule with targetStorageClass', () => {
    const rule = LifecyclePolicyRuleSchema.parse({
      id: 'move_to_glacier',
      enabled: true,
      action: 'transition',
      daysAfterCreation: 30,
      targetStorageClass: 'glacier',
    });
    
    expect(rule.action).toBe('transition');
    expect(rule.targetStorageClass).toBe('glacier');
  });

  it('should allow delete action without targetStorageClass', () => {
    const rule = LifecyclePolicyRuleSchema.parse({
      id: 'delete_old',
      enabled: true,
      action: 'delete',
      daysAfterCreation: 365,
    });
    
    expect(rule.action).toBe('delete');
    expect(rule.targetStorageClass).toBeUndefined();
  });
});

describe('LifecyclePolicyConfigSchema', () => {
  it('should accept default config', () => {
    const config = LifecyclePolicyConfigSchema.parse({});

    expect(config.enabled).toBe(false);
    expect(config.rules).toHaveLength(0);
  });

  it('should accept policy with multiple rules', () => {
    const config = LifecyclePolicyConfigSchema.parse({
      enabled: true,
      rules: [
        {
          id: 'archive_old',
          enabled: true,
          action: 'transition',
          daysAfterCreation: 90,
          targetStorageClass: 'glacier',
        },
        {
          id: 'delete_temp',
          enabled: true,
          action: 'delete',
          prefix: 'temp/',
          daysAfterCreation: 7,
        },
      ],
    });

    expect(config.enabled).toBe(true);
    expect(config.rules).toHaveLength(2);
  });
});

describe('BucketConfigSchema', () => {
  it('should accept minimal bucket config', () => {
    const bucket = BucketConfigSchema.parse({
      name: 'user_uploads',
      label: 'User Uploads',
      bucketName: 'my-app-uploads',
      provider: 's3',
    });

    expect(bucket.name).toBe('user_uploads');
    expect(bucket.provider).toBe('s3');
    expect(bucket.enabled).toBe(true); // default
    expect(bucket.versioning).toBe(false); // default
    expect(bucket.pathStyle).toBe(false); // default
  });

  it('should accept full bucket config with all features', () => {
    const bucket = BucketConfigSchema.parse({
      name: 'production_files',
      label: 'Production Files',
      bucketName: 'prod-files',
      region: 'us-east-1',
      provider: 's3',
      endpoint: 'https://s3.amazonaws.com',
      pathStyle: false,
      versioning: true,
      encryption: {
        enabled: true,
        algorithm: 'aws:kms',
        kmsKeyId: 'arn:aws:kms:us-east-1:123456789:key/abc',
      },
      accessControl: {
        acl: 'private',
        corsEnabled: true,
        allowedOrigins: ['https://app.example.com'],
        allowedMethods: ['GET', 'PUT'],
      },
      lifecyclePolicy: {
        enabled: true,
        rules: [
          {
            id: 'archive_old',
            enabled: true,
            action: 'transition',
            daysAfterCreation: 90,
            targetStorageClass: 'glacier',
          },
        ],
      },
      multipartConfig: {
        enabled: true,
        threshold: 100 * 1024 * 1024,
      },
      tags: {
        environment: 'production',
        team: 'engineering',
      },
      description: 'Production file storage',
      enabled: true,
    });

    expect(bucket.versioning).toBe(true);
    expect(bucket.encryption?.enabled).toBe(true);
    expect(bucket.lifecyclePolicy?.enabled).toBe(true);
  });

  it('should validate bucket name format (snake_case)', () => {
    expect(() => BucketConfigSchema.parse({
      name: 'valid_bucket_name',
      label: 'Valid Bucket',
      bucketName: 'actual-bucket',
      provider: 's3',
    })).not.toThrow();

    expect(() => BucketConfigSchema.parse({
      name: 'Invalid-Bucket',
      label: 'Invalid Bucket',
      bucketName: 'actual-bucket',
      provider: 's3',
    })).toThrow();
  });

  it('should accept MinIO bucket with path-style URLs', () => {
    const bucket = BucketConfigSchema.parse({
      name: 'minio_bucket',
      label: 'MinIO Bucket',
      bucketName: 'dev-files',
      provider: 'minio',
      endpoint: 'http://localhost:9000',
      pathStyle: true,
    });

    expect(bucket.provider).toBe('minio');
    expect(bucket.pathStyle).toBe(true);
  });
});

describe('StorageConnectionSchema', () => {
  it('should accept AWS S3 credentials', () => {
    const connection = StorageConnectionSchema.parse({
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      region: 'us-east-1',
    });

    expect(connection.accessKeyId).toBeDefined();
    expect(connection.region).toBe('us-east-1');
  });

  it('should accept AWS temporary credentials', () => {
    const connection = StorageConnectionSchema.parse({
      accessKeyId: 'ASIATEMP',
      secretAccessKey: 'tempSecret',
      sessionToken: 'FwoGZXIvYXdz...',
      region: 'us-west-2',
    });

    expect(connection.sessionToken).toBeDefined();
  });

  it('should accept Azure credentials', () => {
    const connection = StorageConnectionSchema.parse({
      accountName: 'mystorageaccount',
      accountKey: 'base64encodedkey==',
      endpoint: 'https://mystorageaccount.blob.core.windows.net',
    });

    expect(connection.accountName).toBe('mystorageaccount');
  });

  it('should accept Azure SAS token', () => {
    const connection = StorageConnectionSchema.parse({
      accountName: 'mystorageaccount',
      sasToken: 'sv=2021-01-01&ss=b&...',
    });

    expect(connection.sasToken).toBeDefined();
  });

  it('should accept GCP credentials', () => {
    const connection = StorageConnectionSchema.parse({
      environmentId: 'my-gcp-project',
      credentials: '{"type":"service_account","environment_id":"my-project",...}',
    });

    expect(connection.environmentId).toBe('my-gcp-project');
  });

  it('should accept custom endpoint with SSL settings', () => {
    const connection = StorageConnectionSchema.parse({
      endpoint: 'https://custom.storage.example.com',
      useSSL: true,
      timeoutMs: 30000,
    });

    expect(connection.useSSL).toBe(true);
    expect(connection.timeoutMs).toBe(30000);
  });

  it('should default useSSL to true', () => {
    const connection = StorageConnectionSchema.parse({
      accessKeyId: 'key',
      secretAccessKey: 'secret',
    });

    expect(connection.useSSL).toBe(true);
  });
});

describe('ObjectStorageConfigSchema', () => {
  it('should accept minimal storage config', () => {
    const storage = ObjectStorageConfigSchema.parse({
      name: 'main_storage',
      label: 'Main Storage',
      provider: 's3',
      connection: {
        accessKeyId: 'key',
        secretAccessKey: 'secret',
        region: 'us-east-1',
      },
    });

    expect(storage.name).toBe('main_storage');
    expect(storage.provider).toBe('s3');
    expect(storage.enabled).toBe(true); // default
    expect(storage.buckets).toHaveLength(0); // default
    expect(storage.scope).toBe('global'); // default
  });

  it('should accept storage config with scope', () => {
    const storage = ObjectStorageConfigSchema.parse({
      name: 'tenant_storage',
      label: 'Tenant Storage',
      provider: 's3',
      scope: 'tenant',
      connection: {
        accessKeyId: 'key',
        secretAccessKey: 'secret',
      },
    });

    expect(storage.scope).toBe('tenant');
  });

  it('should accept storage config with location and quota', () => {
    const storage = ObjectStorageConfigSchema.parse({
      name: 'local_storage',
      label: 'Local Storage',
      provider: 'local',
      scope: 'temp',
      connection: {},
      location: '/var/tmp/storage',
      quota: 10737418240, // 10GB
    });

    expect(storage.location).toBe('/var/tmp/storage');
    expect(storage.quota).toBe(10737418240);
  });

  it('should accept storage config with options', () => {
    const storage = ObjectStorageConfigSchema.parse({
      name: 'custom_storage',
      label: 'Custom Storage',
      provider: 'minio',
      connection: {},
      options: {
        endpoint: 'http://localhost:9000',
        pathStyle: true,
      },
    });

    expect(storage.options?.endpoint).toBe('http://localhost:9000');
    expect(storage.options?.pathStyle).toBe(true);
  });

  it('should accept full storage config with buckets', () => {
    const storage = ObjectStorageConfigSchema.parse({
      name: 'production_storage',
      label: 'Production Storage',
      provider: 's3',
      connection: {
        accessKeyId: '${AWS_ACCESS_KEY_ID}',
        secretAccessKey: '${AWS_SECRET_ACCESS_KEY}',
        region: 'us-east-1',
      },
      buckets: [
        {
          name: 'user_uploads',
          label: 'User Uploads',
          bucketName: 'prod-uploads',
          provider: 's3',
          region: 'us-east-1',
        },
        {
          name: 'media_files',
          label: 'Media Files',
          bucketName: 'prod-media',
          provider: 's3',
          region: 'us-east-1',
        },
      ],
      defaultBucket: 'user_uploads',
      enabled: true,
      description: 'Production S3 storage',
    });

    expect(storage.buckets).toHaveLength(2);
    expect(storage.defaultBucket).toBe('user_uploads');
  });

  it('should validate storage name format (snake_case)', () => {
    expect(() => ObjectStorageConfigSchema.parse({
      name: 'valid_storage_name',
      label: 'Valid Storage',
      provider: 's3',
      connection: {},
    })).not.toThrow();

    expect(() => ObjectStorageConfigSchema.parse({
      name: 'Invalid-Storage',
      label: 'Invalid Storage',
      provider: 's3',
      connection: {},
    })).toThrow();
  });

  it('should accept MinIO configuration', () => {
    const storage = ObjectStorageConfigSchema.parse({
      name: 'minio_local',
      label: 'MinIO Local',
      provider: 'minio',
      connection: {
        accessKeyId: 'minioadmin',
        secretAccessKey: 'minioadmin',
        endpoint: 'http://localhost:9000',
        useSSL: false,
      },
      buckets: [
        {
          name: 'dev_files',
          label: 'Development Files',
          bucketName: 'dev',
          provider: 'minio',
          endpoint: 'http://localhost:9000',
          pathStyle: true,
        },
      ],
    });

    expect(storage.provider).toBe('minio');
    expect(storage.connection.useSSL).toBe(false);
  });

  it('should accept Azure Blob Storage configuration', () => {
    const storage = ObjectStorageConfigSchema.parse({
      name: 'azure_storage',
      label: 'Azure Storage',
      provider: 'azure_blob',
      connection: {
        accountName: 'myaccount',
        accountKey: '${AZURE_STORAGE_KEY}',
      },
      buckets: [
        {
          name: 'backup_container',
          label: 'Backups',
          bucketName: 'backups',
          provider: 'azure_blob',
          region: 'eastus',
        },
      ],
    });

    expect(storage.provider).toBe('azure_blob');
  });

  it('should accept GCS configuration', () => {
    const storage = ObjectStorageConfigSchema.parse({
      name: 'gcs_storage',
      label: 'Google Cloud Storage',
      provider: 'gcs',
      connection: {
        environmentId: 'my-project',
        credentials: '${GCP_CREDENTIALS_JSON}',
      },
      buckets: [
        {
          name: 'analytics_data',
          label: 'Analytics Data',
          bucketName: 'analytics',
          provider: 'gcs',
          region: 'us-central1',
        },
      ],
    });

    expect(storage.provider).toBe('gcs');
  });

  it('should accept disabled storage config', () => {
    const storage = ObjectStorageConfigSchema.parse({
      name: 'disabled_storage',
      label: 'Disabled Storage',
      provider: 's3',
      connection: {},
      enabled: false,
    });

    expect(storage.enabled).toBe(false);
  });
});

// #15679 (stack card 4/6 of #14478) — ruling B. Both old spellings are
// `retiredKey()` tombstones; asserted on the issue CODE and the prescription,
// never on a bare `toThrow()`.
//
// ⚠️ `AccessControlConfig.maxAge` is a RENAME and its twin
// `shared/CorsConfig.maxAge` is a DECLARED `externalVocabulary` mirror that keeps
// its bare name. The asymmetry is deliberate: every bucket-CORS standard spells
// the field with its unit (S3 `MaxAgeSeconds`, GCS `maxAgeSeconds`, Azure
// `MaxAgeInSeconds`), while the Fetch header `Access-Control-Max-Age` that the
// twin mirrors carries no unit token. No gate can catch the twin being renamed
// along with this one — the marker exempts it either way — so a find-and-replace
// that harmonised the two would land silently. The pin below is the only guard.
describe('object-storage durations carry their unit (#15679)', () => {
  it('REFUSES the retired `AccessControlConfig.maxAge` with the rename in the message', () => {
    const result = AccessControlConfigSchema.safeParse({ corsEnabled: true, maxAge: 3600 });
    expect(result.success).toBe(false);
    const issue = result.error!.issues.find((i) => i.path.join('.') === 'maxAge');
    expect(issue).toBeDefined();
    expect(issue!.code).not.toBe('unrecognized_keys');
    expect(issue!.message).toContain('`AccessControlConfig.maxAge` was renamed to `maxAgeSeconds`');
  });

  it('REFUSES the retired `StorageConnection.timeout` with the rename in the message', () => {
    const result = StorageConnectionSchema.safeParse({ endpoint: 'https://s.example.com', timeout: 30000 });
    expect(result.success).toBe(false);
    const issue = result.error!.issues.find((i) => i.path.join('.') === 'timeout');
    expect(issue).toBeDefined();
    expect(issue!.code).not.toBe('unrecognized_keys');
    expect(issue!.message).toContain('`StorageConnection.timeout` was renamed to `timeoutMs`');
  });

  it('accepts both renamed keys at the same magnitude', () => {
    expect(AccessControlConfigSchema.parse({ corsEnabled: true, maxAgeSeconds: 3600 }).maxAgeSeconds).toBe(3600);
    expect(StorageConnectionSchema.parse({ endpoint: 'https://s.example.com', timeoutMs: 30000 }).timeoutMs).toBe(30000);
  });

  it('leaves `FileMetadata.size` alone — it is bytes, not a duration', () => {
    const parsed = FileMetadataSchema.parse({
      path: '/uploads/file.txt',
      name: 'file.txt',
      size: 1024,
      mimeType: 'text/plain',
      lastModified: '2024-01-15T10:30:00.000Z',
      created: '2024-01-15T10:00:00.000Z',
    });
    expect(parsed.size).toBe(1024);
  });
});
