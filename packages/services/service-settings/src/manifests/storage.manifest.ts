// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { SettingsManifest } from '@objectstack/spec/system';
import type { SettingsActionHandler } from '../settings-service.types.js';

// Mirrors the shape of `mail.manifest.ts`. The actual adapter rebuild
// + `storage/test` probe live in `@objectstack/service-storage`; this
// manifest only declares the form + acts as a safe fallback when the
// storage plugin is not present.
const manifest = {
  namespace: 'storage',
  version: 1,
  label: 'File Storage',
  icon: 'HardDrive',
  description:
    'Backend used for attachments, exports, and user uploads. ' +
    '⚠ Switching adapter does not migrate existing files — files ' +
    'uploaded under the previous adapter become unreachable through ' +
    'the new one.',
  scope: 'global',
  readPermission: 'setup.access',
  writePermission: 'setup.write',
  category: 'Infrastructure',
  order: 20,
  specifiers: [
    { type: 'group', id: 'adapter', label: 'Backend', required: false,
      description: 'Choose where uploaded files are stored.' },
    { type: 'select', key: 'adapter', label: 'Adapter', required: true, default: 'local',
      options: [
        { value: 'local', label: 'Local filesystem' },
        { value: 's3', label: 'S3 / S3-compatible' },
      ],
    },

    { type: 'group', id: 'local', label: 'Local', required: false,
      visible: "${data.adapter === 'local'}" },
    { type: 'text', key: 'local_root', label: 'Root directory', required: false,
      default: './.objectstack/data/uploads',
      description: 'Filesystem path under which files are stored. Relative paths resolve from the server CWD.',
      visible: "${data.adapter === 'local'}" },

    { type: 'group', id: 's3', label: 'S3', required: false,
      visible: "${data.adapter === 's3'}" },
    { type: 'text', key: 's3_bucket', label: 'Bucket', required: true,
      description: 'Shared host bucket. Per-project files are namespaced via the projects/<projectId>/ prefix.',
      visible: "${data.adapter === 's3'}" },
    { type: 'text', key: 's3_region', label: 'Region', required: true,
      description: 'Example: us-east-1',
      visible: "${data.adapter === 's3'}" },
    { type: 'text', key: 's3_endpoint', label: 'Endpoint', required: false,
      description: 'Custom endpoint for S3-compatible providers (R2, MinIO, Wasabi). Leave blank for AWS S3.',
      visible: "${data.adapter === 's3'}" },
    { type: 'text', key: 's3_access_key_id', label: 'Access key ID', required: true,
      visible: "${data.adapter === 's3'}" },
    { type: 'password', key: 's3_secret_access_key', label: 'Secret access key',
      required: true, encrypted: true,
      visible: "${data.adapter === 's3'}" },
    { type: 'toggle', key: 's3_force_path_style', label: 'Force path-style URLs',
      required: false, default: false,
      description: 'Enable for MinIO and most S3-compatible providers; disable for AWS S3.',
      visible: "${data.adapter === 's3'}" },

    { type: 'group', id: 'limits', label: 'Limits', required: false },
    { type: 'number', key: 'presigned_ttl', label: 'Presigned URL TTL (seconds)',
      required: false, default: 3600, min: 60, max: 604800 },
    { type: 'number', key: 'session_ttl', label: 'Upload session TTL (seconds)',
      required: false, default: 86400, min: 300, max: 604800,
      description: 'How long a chunked-upload session stays resumable.' },
    { type: 'number', key: 'max_upload_mb', label: 'Max upload size (MB)',
      required: false, default: 100, min: 1, max: 10240 },

    { type: 'action_button', id: 'test', label: 'Test connection',
      required: false, icon: 'Plug',
      handler: { kind: 'http', method: 'POST', url: '/api/settings/storage/test' } },
  ],
};

/** File Storage — local FS / S3-compatible backend configuration. */
export const storageSettingsManifest = manifest as unknown as SettingsManifest;

/**
 * Built-in fallback action handler for `storage/test`. The real
 * implementation lives in `@objectstack/service-storage` and is
 * registered by `StorageServicePlugin` on `kernel:ready` (it overrides
 * this stub via `registerAction`). This fallback only validates the
 * form so the button is still useful when the storage plugin is
 * absent (e.g. in a unit-test kernel that mounts settings only).
 */
export const storageTestActionHandler: SettingsActionHandler = async ({ values }) => {
  const adapter = String(values.adapter ?? 'local');
  if (adapter === 'local') {
    const root = values.local_root as string | undefined;
    if (!root) {
      return { ok: false, severity: 'error', message: 'Configure a root directory before testing.' };
    }
    return {
      ok: true,
      severity: 'info',
      message: `Local adapter configured (root=${root}). Mount @objectstack/service-storage to exercise live I/O.`,
    };
  }
  if (adapter === 's3') {
    const missing: string[] = [];
    if (!values.s3_bucket) missing.push('s3_bucket');
    if (!values.s3_region) missing.push('s3_region');
    if (!values.s3_access_key_id) missing.push('s3_access_key_id');
    if (!values.s3_secret_access_key) missing.push('s3_secret_access_key');
    if (missing.length) {
      return { ok: false, severity: 'error', message: `Missing required field${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}` };
    }
    return {
      ok: true,
      severity: 'info',
      message: `S3 adapter configured (bucket=${values.s3_bucket}, region=${values.s3_region}). Mount @objectstack/service-storage to exercise live I/O.`,
    };
  }
  return { ok: false, severity: 'error', message: `Unknown adapter: ${adapter}` };
};
