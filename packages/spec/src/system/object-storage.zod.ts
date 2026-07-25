// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { SystemIdentifierSchema } from '../shared/identifiers.zod';

/**
 * Object Storage Protocol
 * 
 * Unified storage protocol that combines:
 * - Object storage systems (S3, Azure Blob, GCS, MinIO)
 * - Scoped storage configuration (temp, cache, data, logs, config, public)
 * - Multi-cloud storage providers
 * - Bucket/container configuration
 * - Access control and permissions
 * - Lifecycle policies for data retention
 * - Presigned URLs for secure direct access
 * - Multipart uploads for large files
 */

// ============================================================================
// Storage Scope Protocol (formerly from scoped-storage.zod.ts)
// ============================================================================

/**
 * Storage Scope Enum
 * Defines the lifecycle and persistence guarantee of the storage area.
 */
import { lazySchema } from '../shared/lazy-schema';
export const StorageScopeSchema = lazySchema(() => z.enum([
  'global',     // Global application-wide storage
  'tenant',     // Tenant-scoped storage (multi-tenant apps)
  'user',       // User-scoped storage
  'session',    // Session-scoped storage (ephemeral)
  'temp',       // Ephemeral, cleared on restart
  'cache',      // Ephemeral, survives restarts, cleared on LRU/Expiration
  'data',       // Persistent, backed up
  'logs',       // Append-only, rotated
  'config',     // Read-heavy, versioned
  'public'      // Publicly accessible static assets
]).describe('Storage scope classification'));

export type StorageScope = z.infer<typeof StorageScopeSchema>;

/**
 * File Metadata Schema
 * Standardized file attribute structure
 */
export const FileMetadataSchema = lazySchema(() => z.object({
  path: z.string().describe('File path'),
  name: z.string().describe('File name'),
  size: z.number().int().describe('File size in bytes'),
  mimeType: z.string().describe('MIME type'),
  lastModified: z.string().datetime().describe('Last modified timestamp'),
  created: z.string().datetime().describe('Creation timestamp'),
  etag: z.string().optional().describe('Entity tag'),
  // The opaque `sys_file` id (ADR-0104 D3): the value a file/image/avatar/
  // video/audio field will store as a reference. Surfaced on the upload-complete
  // response so a caller can persist it; optional because generic file-metadata
  // reads (getInfo/list) do not always carry it.
  fileId: z.string().optional().describe('Opaque sys_file id (ADR-0104 D3 file-as-reference)'),
}));

export type FileMetadata = z.infer<typeof FileMetadataSchema>;

// ============================================================================
// Enums
// ============================================================================

/**
 * Storage Provider Types
 * 
 * Supported cloud and self-hosted object storage providers.
 */
export const StorageProviderSchema = lazySchema(() => z.enum([
  's3',           // Amazon S3
  'azure_blob',   // Azure Blob Storage
  'gcs',          // Google Cloud Storage
  'minio',        // MinIO (self-hosted S3-compatible)
  'r2',           // Cloudflare R2
  'spaces',       // DigitalOcean Spaces
  'wasabi',       // Wasabi Hot Cloud Storage
  'backblaze',    // Backblaze B2
  'local',        // Local filesystem (development only)
]).describe('Storage provider type'));

export type StorageProvider = z.infer<typeof StorageProviderSchema>;

/**
 * Storage Access Control List (ACL)
 * 
 * Predefined access control configurations for objects and buckets.
 */
export const StorageAclSchema = lazySchema(() => z.enum([
  'private',                    // Owner has full control, no one else has access
  'public_read',                // Owner has full control, everyone can read
  'public_read_write',          // Owner has full control, everyone can read/write (not recommended)
  'authenticated_read',         // Owner has full control, authenticated users can read
  'bucket_owner_read',          // Object owner has full control, bucket owner can read
  'bucket_owner_full_control',  // Both object and bucket owner have full control
]).describe('Storage access control level'));

export type StorageAcl = z.infer<typeof StorageAclSchema>;

/**
 * Storage Class / Tier
 * 
 * Different storage tiers for cost optimization.
 * Maps to provider-specific storage classes.
 */
export const StorageClassSchema = lazySchema(() => z.enum([
  'standard',           // Standard/hot storage for frequently accessed data
  'intelligent',        // Intelligent tiering (auto-moves between hot/cool)
  'infrequent_access',  // Infrequent access/cool storage
  'glacier',            // Archive/cold storage (slower retrieval)
  'deep_archive',       // Deep archive (cheapest, slowest retrieval)
]).describe('Storage class/tier for cost optimization'));

export type StorageClass = z.infer<typeof StorageClassSchema>;

/**
 * Lifecycle Transition Action
 */
export const LifecycleActionSchema = lazySchema(() => z.enum([
  'transition',  // Move to different storage class
  'delete',      // Delete the object
  'abort',       // Abort incomplete multipart uploads
]).describe('Lifecycle policy action type'));

export type LifecycleAction = z.infer<typeof LifecycleActionSchema>;

// ============================================================================
// Configuration Schemas
// ============================================================================

/**
 * Object Metadata Schema
 * 
 * Standard and custom metadata attached to stored objects.
 * 
 * @example
 * {
 *   contentType: 'image/jpeg',
 *   contentLength: 1024000,
 *   etag: '"abc123"',
 *   lastModified: new Date('2024-01-01'),
 *   custom: {
 *     uploadedBy: 'user123',
 *     department: 'marketing'
 *   }
 * }
 */
export const ObjectMetadataSchema = lazySchema(() => z.object({
  contentType: z.string().describe('MIME type (e.g., image/jpeg, application/pdf)'),
  contentLength: z.number().min(0).describe('File size in bytes'),
  contentEncoding: z.string().optional().describe('Content encoding (e.g., gzip)'),
  contentDisposition: z.string().optional().describe('Content disposition header'),
  contentLanguage: z.string().optional().describe('Content language'),
  cacheControl: z.string().optional().describe('Cache control directives'),
  etag: z.string().optional().describe('Entity tag for versioning/caching'),
  lastModified: z.string().datetime().optional().describe('Last modification timestamp'),
  versionId: z.string().optional().describe('Object version identifier'),
  storageClass: StorageClassSchema.optional().describe('Storage class/tier'),
  encryption: z.object({
    algorithm: z.string().describe('Encryption algorithm (e.g., AES256, aws:kms)'),
    keyId: z.string().optional().describe('KMS key ID if using managed encryption'),
  }).optional().describe('Server-side encryption configuration'),
  custom: z.record(z.string(), z.string()).optional().describe('Custom user-defined metadata'),
}));

export type ObjectMetadata = z.infer<typeof ObjectMetadataSchema>;

/**
 * Presigned URL Configuration
 * 
 * Configuration for generating temporary URLs for direct access to objects.
 * Useful for secure file uploads/downloads without exposing credentials.
 * 
 * @example
 * // Generate download URL valid for 1 hour
 * {
 *   operation: 'get',
 *   expiresIn: 3600,
 *   contentType: 'image/jpeg'
 * }
 * 
 * @example
 * // Generate upload URL valid for 15 minutes with size limit
 * {
 *   operation: 'put',
 *   expiresIn: 900,
 *   contentType: 'application/pdf',
 *   maxSize: 10485760
 * }
 */
export const PresignedUrlConfigSchema = lazySchema(() => z.object({
  operation: z.enum(['get', 'put', 'delete', 'head']).describe('Allowed operation'),
  expiresIn: z.number().min(1).max(604800).describe('Expiration time in seconds (max 7 days)'),
  contentType: z.string().optional().describe('Required content type for PUT operations'),
  maxSize: z.number().min(0).optional().describe('Maximum file size in bytes for PUT operations'),
  responseContentType: z.string().optional().describe('Override content-type for GET operations'),
  responseContentDisposition: z.string().optional().describe('Override content-disposition for GET operations'),
}));

export type PresignedUrlConfig = z.infer<typeof PresignedUrlConfigSchema>;

/**
 * Multipart Upload Configuration
 * 
 * Configuration for chunked uploads of large files.
 * Enables resumable uploads and parallel transfer.
 * 
 * @example
 * // Enable multipart for files > 100MB with 10MB chunks
 * {
 *   enabled: true,
 *   partSize: 10485760,
 *   maxParts: 10000,
 *   threshold: 104857600,
 *   maxConcurrent: 4
 * }
 */
export const MultipartUploadConfigSchema = lazySchema(() => z.object({
  enabled: z.boolean().default(true).describe('Enable multipart uploads'),
  partSize: z.number().min(5 * 1024 * 1024).max(5 * 1024 * 1024 * 1024).default(10 * 1024 * 1024).describe('Part size in bytes (min 5MB, max 5GB)'),
  maxParts: z.number().min(1).max(10000).default(10000).describe('Maximum number of parts (max 10,000)'),
  threshold: z.number().min(0).default(100 * 1024 * 1024).describe('File size threshold to trigger multipart upload (bytes)'),
  maxConcurrent: z.number().min(1).max(100).default(4).describe('Maximum concurrent part uploads'),
  abortIncompleteAfterDays: z.number().min(1).optional().describe('Auto-abort incomplete uploads after N days'),
}));

export type MultipartUploadConfig = z.infer<typeof MultipartUploadConfigSchema>;

/**
 * Access Control Configuration
 * 
 * Fine-grained access control for buckets and objects.
 * 
 * @example
 * {
 *   acl: 'private',
 *   allowedOrigins: ['https://app.example.com'],
 *   allowedMethods: ['GET', 'PUT'],
 *   corsEnabled: true,
 *   publicAccess: {
 *     allowPublicRead: false,
 *     allowPublicWrite: false
 *   }
 * }
 */
export const AccessControlConfigSchema = lazySchema(() => z.object({
  acl: StorageAclSchema.default('private').describe('Default access control level'),
  allowedOrigins: z.array(z.string()).optional().describe('CORS allowed origins'),
  allowedMethods: z.array(z.enum(['GET', 'PUT', 'POST', 'DELETE', 'HEAD'])).optional().describe('CORS allowed HTTP methods'),
  allowedHeaders: z.array(z.string()).optional().describe('CORS allowed headers'),
  exposeHeaders: z.array(z.string()).optional().describe('CORS exposed headers'),
  maxAge: z.number().min(0).optional().describe('CORS preflight cache duration in seconds'),
  corsEnabled: z.boolean().default(false).describe('Enable CORS configuration'),
  publicAccess: z.object({
    allowPublicRead: z.boolean().default(false).describe('Allow public read access'),
    allowPublicWrite: z.boolean().default(false).describe('Allow public write access'),
    allowPublicList: z.boolean().default(false).describe('Allow public bucket listing'),
  }).optional().describe('Public access control'),
  allowedIps: z.array(z.string()).optional().describe('Allowed IP addresses/CIDR blocks'),
  blockedIps: z.array(z.string()).optional().describe('Blocked IP addresses/CIDR blocks'),
}));

export type AccessControlConfig = z.infer<typeof AccessControlConfigSchema>;

/**
 * Lifecycle Policy Rule
 * 
 * Individual rule for automatic object lifecycle management.
 * 
 * @example
 * // Transition to infrequent access after 30 days
 * {
 *   id: 'move_to_ia',
 *   enabled: true,
 *   action: 'transition',
 *   daysAfterCreation: 30,
 *   targetStorageClass: 'infrequent_access'
 * }
 * 
 * @example
 * // Delete objects after 365 days
 * {
 *   id: 'delete_old',
 *   enabled: true,
 *   action: 'delete',
 *   daysAfterCreation: 365
 * }
 */
export const LifecyclePolicyRuleSchema = lazySchema(() => z.object({
  id: SystemIdentifierSchema.describe('Rule identifier'),
  enabled: z.boolean().default(true).describe('Enable this rule'),
  action: LifecycleActionSchema.describe('Action to perform'),
  prefix: z.string().optional().describe('Object key prefix filter (e.g., "uploads/")'),
  tags: z.record(z.string(), z.string()).optional().describe('Object tag filters'),
  daysAfterCreation: z.number().min(0).optional().describe('Days after object creation'),
  daysAfterModification: z.number().min(0).optional().describe('Days after last modification'),
  targetStorageClass: StorageClassSchema.optional().describe('Target storage class for transition action'),
}).refine((data) => {
  // Validate that transition action has targetStorageClass
  if (data.action === 'transition' && !data.targetStorageClass) {
    return false;
  }
  return true;
}, {
  message: 'targetStorageClass is required when action is "transition"',
}));

export type LifecyclePolicyRule = z.infer<typeof LifecyclePolicyRuleSchema>;

/**
 * Lifecycle Policy Configuration
 * 
 * Collection of lifecycle rules for automatic data management.
 * 
 * @example
 * {
 *   enabled: true,
 *   rules: [
 *     {
 *       id: 'archive_old_files',
 *       enabled: true,
 *       action: 'transition',
 *       daysAfterCreation: 90,
 *       targetStorageClass: 'glacier'
 *     },
 *     {
 *       id: 'delete_temp_files',
 *       enabled: true,
 *       action: 'delete',
 *       prefix: 'temp/',
 *       daysAfterCreation: 7
 *     }
 *   ]
 * }
 */
export const LifecyclePolicyConfigSchema = lazySchema(() => z.object({
  enabled: z.boolean().default(false).describe('Enable lifecycle policies'),
  rules: z.array(LifecyclePolicyRuleSchema).default([]).describe('Lifecycle rules'),
}));

export type LifecyclePolicyConfig = z.infer<typeof LifecyclePolicyConfigSchema>;

/**
 * Bucket Configuration Schema
 * 
 * Comprehensive configuration for a storage bucket/container.
 * 
 * @example
 * {
 *   name: 'user_uploads',
 *   label: 'User Uploads',
 *   bucketName: 'my-app-uploads',
 *   region: 'us-east-1',
 *   provider: 's3',
 *   versioning: true,
 *   accessControl: {
 *     acl: 'private',
 *     corsEnabled: true,
 *     allowedOrigins: ['https://app.example.com']
 *   },
 *   multipartConfig: {
 *     enabled: true,
 *     threshold: 104857600
 *   }
 * }
 */
export const BucketConfigSchema = lazySchema(() => z.object({
  name: SystemIdentifierSchema.describe('Bucket identifier in ObjectStack (snake_case)'),
  label: z.string().describe('Display label'),
  bucketName: z.string().describe('Actual bucket/container name in storage provider'),
  region: z.string().optional().describe('Storage region (e.g., us-east-1, westus)'),
  provider: StorageProviderSchema.describe('Storage provider'),
  endpoint: z.string().optional().describe('Custom endpoint URL (for S3-compatible providers)'),
  pathStyle: z.boolean().default(false).describe('Use path-style URLs (for S3-compatible providers)'),
  
  versioning: z.boolean().default(false).describe('Enable object versioning'),
  encryption: z.object({
    enabled: z.boolean().default(false).describe('Enable server-side encryption'),
    algorithm: z.enum(['AES256', 'aws:kms', 'azure:kms', 'gcp:kms']).default('AES256').describe('Encryption algorithm'),
    kmsKeyId: z.string().optional().describe('KMS key ID for managed encryption'),
  }).optional().describe('Server-side encryption configuration'),
  
  accessControl: AccessControlConfigSchema.optional().describe('Access control configuration'),
  lifecyclePolicy: LifecyclePolicyConfigSchema.optional().describe('Lifecycle policy configuration'),
  multipartConfig: MultipartUploadConfigSchema.optional().describe('Multipart upload configuration'),
  
  tags: z.record(z.string(), z.string()).optional().describe('Bucket tags for organization'),
  description: z.string().optional().describe('Bucket description'),
  enabled: z.boolean().default(true).describe('Enable this bucket'),
}));

export type BucketConfig = z.infer<typeof BucketConfigSchema>;

/**
 * Storage Connection Configuration
 * 
 * Provider-specific connection credentials and settings.
 * 
 * @example S3
 * {
 *   accessKeyId: '${AWS_ACCESS_KEY_ID}',
 *   secretAccessKey: '${AWS_SECRET_ACCESS_KEY}',
 *   sessionToken: '${AWS_SESSION_TOKEN}',
 *   region: 'us-east-1'
 * }
 * 
 * @example Azure
 * {
 *   accountName: 'mystorageaccount',
 *   accountKey: '${AZURE_STORAGE_KEY}',
 *   endpoint: 'https://mystorageaccount.blob.core.windows.net'
 * }
 */
export const StorageConnectionSchema = lazySchema(() => z.object({
  // AWS S3 / MinIO
  accessKeyId: z.string().optional().describe('AWS access key ID or MinIO access key'),
  secretAccessKey: z.string().optional().describe('AWS secret access key or MinIO secret key'),
  sessionToken: z.string().optional().describe('AWS session token for temporary credentials'),
  
  // Azure Blob Storage
  accountName: z.string().optional().describe('Azure storage account name'),
  accountKey: z.string().optional().describe('Azure storage account key'),
  sasToken: z.string().optional().describe('Azure SAS token'),
  
  // Google Cloud Storage
  environmentId: z.string().optional().describe('GCP project ID'),
  credentials: z.string().optional().describe('GCP service account credentials JSON'),
  
  // Common
  endpoint: z.string().optional().describe('Custom endpoint URL'),
  region: z.string().optional().describe('Default region'),
  useSSL: z.boolean().default(true).describe('Use SSL/TLS for connections'),
  timeout: z.number().min(0).optional().describe('Connection timeout in milliseconds'),
}));

export type StorageConnection = z.infer<typeof StorageConnectionSchema>;

/**
 * Object Storage Configuration
 * 
 * Complete object storage system configuration.
 * 
 * @example
 * {
 *   name: 'production_storage',
 *   label: 'Production File Storage',
 *   provider: 's3',
 *   scope: 'global',
 *   connection: {
 *     accessKeyId: '${AWS_ACCESS_KEY_ID}',
 *     secretAccessKey: '${AWS_SECRET_ACCESS_KEY}',
 *     region: 'us-east-1'
 *   },
 *   buckets: [
 *     {
 *       name: 'user_uploads',
 *       label: 'User Uploads',
 *       bucketName: 'prod-uploads',
 *       provider: 's3',
 *       region: 'us-east-1'
 *     }
 *   ],
 *   defaultBucket: 'user_uploads'
 * }
 */
export const ObjectStorageConfigSchema = lazySchema(() => z.object({
  name: SystemIdentifierSchema.describe('Storage configuration identifier'),
  label: z.string().describe('Display label'),
  provider: StorageProviderSchema.describe('Primary storage provider'),
  
  /**
   * Storage scope
   * Defines the lifecycle and access pattern for this storage
   */
  scope: StorageScopeSchema.optional().default('global').describe('Storage scope'),
  
  connection: StorageConnectionSchema.describe('Connection credentials'),
  buckets: z.array(BucketConfigSchema).default([]).describe('Configured buckets'),
  defaultBucket: z.string().optional().describe('Default bucket name for operations'),
  
  /**
   * Base path or location
   * For local/scoped storage configurations
   */
  location: z.string().optional().describe('Root path (local) or base location'),
  
  /**
   * Storage quota in bytes
   */
  quota: z.number().int().positive().optional().describe('Max size in bytes'),
  
  /**
   * Provider-specific options
   */
  options: z.record(z.string(), z.unknown()).optional().describe('Provider-specific configuration options'),
  
  enabled: z.boolean().default(true).describe('Enable this storage configuration'),
  description: z.string().optional().describe('Configuration description'),
}));

export type ObjectStorageConfig = z.infer<typeof ObjectStorageConfigSchema>;

// ============================================================================
// Helper Examples
// ============================================================================

/**
 * Example: AWS S3 Configuration
 */
export const s3StorageExample = ObjectStorageConfigSchema.parse({
  name: 'aws_s3_storage',
  label: 'AWS S3 Production Storage',
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
      bucketName: 'my-app-user-uploads',
      region: 'us-east-1',
      provider: 's3',
      versioning: true,
      encryption: {
        enabled: true,
        algorithm: 'aws:kms',
        kmsKeyId: '${AWS_KMS_KEY_ID}',
      },
      accessControl: {
        acl: 'private',
        corsEnabled: true,
        allowedOrigins: ['https://app.example.com'],
        allowedMethods: ['GET', 'PUT', 'POST'],
      },
      lifecyclePolicy: {
        enabled: true,
        rules: [
          {
            id: 'archive_old_uploads',
            enabled: true,
            action: 'transition',
            daysAfterCreation: 90,
            targetStorageClass: 'glacier',
          },
        ],
      },
      multipartConfig: {
        enabled: true,
        partSize: 10 * 1024 * 1024,
        threshold: 100 * 1024 * 1024,
        maxConcurrent: 4,
      },
    },
  ],
  defaultBucket: 'user_uploads',
  enabled: true,
});

/**
 * Example: MinIO Configuration
 */
export const minioStorageExample = ObjectStorageConfigSchema.parse({
  name: 'minio_local',
  label: 'MinIO Local Storage',
  provider: 'minio',
  connection: {
    accessKeyId: 'minioadmin',
    secretAccessKey: 'minioadmin',
    endpoint: 'http://localhost:9000',
    useSSL: false,
  },
  buckets: [
    {
      name: 'development_files',
      label: 'Development Files',
      bucketName: 'dev-files',
      provider: 'minio',
      endpoint: 'http://localhost:9000',
      pathStyle: true,
      accessControl: {
        acl: 'private',
      },
    },
  ],
  defaultBucket: 'development_files',
  enabled: true,
});

/**
 * Example: Azure Blob Storage Configuration
 */
export const azureBlobStorageExample = ObjectStorageConfigSchema.parse({
  name: 'azure_blob_storage',
  label: 'Azure Blob Storage',
  provider: 'azure_blob',
  connection: {
    accountName: 'mystorageaccount',
    accountKey: '${AZURE_STORAGE_KEY}',
    endpoint: 'https://mystorageaccount.blob.core.windows.net',
  },
  buckets: [
    {
      name: 'media_files',
      label: 'Media Files',
      bucketName: 'media',
      provider: 'azure_blob',
      region: 'eastus',
      accessControl: {
        acl: 'public_read',
        publicAccess: {
          allowPublicRead: true,
          allowPublicWrite: false,
          allowPublicList: false,
        },
      },
    },
  ],
  defaultBucket: 'media_files',
  enabled: true,
});

/**
 * Example: Google Cloud Storage Configuration
 */
export const gcsStorageExample = ObjectStorageConfigSchema.parse({
  name: 'gcs_storage',
  label: 'Google Cloud Storage',
  provider: 'gcs',
  connection: {
    environmentId: 'my-gcp-project',
    credentials: '${GCP_SERVICE_ACCOUNT_JSON}',
  },
  buckets: [
    {
      name: 'backup_storage',
      label: 'Backup Storage',
      bucketName: 'my-app-backups',
      region: 'us-central1',
      provider: 'gcs',
      lifecyclePolicy: {
        enabled: true,
        rules: [
          {
            id: 'delete_old_backups',
            enabled: true,
            action: 'delete',
            daysAfterCreation: 30,
          },
        ],
      },
    },
  ],
  defaultBucket: 'backup_storage',
  enabled: true,
});
