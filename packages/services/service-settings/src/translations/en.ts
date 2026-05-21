// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { TranslationData } from '@objectstack/spec/system';

/**
 * English (en) — built-in settings manifest translations.
 *
 * Mirrors literals in `manifests/{mail,branding,feature-flags,storage}.manifest.ts`.
 * Keeping them explicit here lets the resolver chain (locale → fallback → literal)
 * always have at least an English entry to fall back to.
 */
export const en: TranslationData = {
  settingsCommon: {
    sourceLabels: {
      env: 'Env',
      global: 'Global',
      tenant: 'Tenant',
      user: 'User',
      default: 'Default',
    },
  },
  settings: {
    mail: {
      title: 'Mail Delivery',
      description: 'SMTP and transactional email provider configuration.',
      groups: {
        provider: { title: 'Provider', description: 'Choose how this workspace sends outbound email.' },
        smtp: { title: 'SMTP' },
        api_key: { title: 'API key' },
        from_address: { title: 'From address' },
      },
      keys: {
        provider: {
          label: 'Provider',
          options: {
            smtp: 'SMTP',
            sendgrid: 'SendGrid',
            ses: 'Amazon SES',
            postmark: 'Postmark',
          },
        },
        smtp_host: { label: 'Host', help: 'Example: smtp.example.com' },
        smtp_port: { label: 'Port' },
        smtp_secure: { label: 'Use TLS' },
        smtp_user: { label: 'Username' },
        smtp_password: { label: 'Password' },
        api_key: { label: 'API key' },
        from_email: { label: 'From email', help: 'Example: no-reply@example.com' },
        from_name: { label: 'From name' },
      },
      actions: {
        test: { label: 'Send test email' },
      },
    },

    branding: {
      title: 'Branding',
      description: 'Workspace name, logo, and accent colour.',
      groups: {
        identity: { title: 'Identity' },
        appearance: { title: 'Appearance' },
      },
      keys: {
        workspace_name: { label: 'Workspace name' },
        support_email: { label: 'Support email', help: 'Example: support@example.com' },
        theme_mode: {
          label: 'Default theme',
          options: { light: 'Light', dark: 'Dark', system: 'Match system' },
        },
        accent_color: { label: 'Accent colour' },
        logo_url: { label: 'Logo URL', help: 'Example: https://…/logo.svg' },
      },
    },

    feature_flags: {
      title: 'Feature Flags',
      description: 'Toggle experimental and beta features for this workspace.',
      groups: {
        productivity: { title: 'Productivity' },
        collaboration: { title: 'Collaboration' },
      },
      keys: {
        ai_enabled: {
          label: 'AI Assistant',
          help: 'Enables the in-app AI assistant panel.',
        },
        kanban_swimlanes: { label: 'Kanban swimlanes' },
        realtime_cursors: { label: 'Realtime cursors' },
        inline_comments: { label: 'Inline comments' },
      },
    },

    storage: {
      title: 'File Storage',
      description:
        'Backend used for attachments, exports, and user uploads. ' +
        '⚠ Switching adapter does not migrate existing files — files ' +
        'uploaded under the previous adapter become unreachable through ' +
        'the new one.',
      groups: {
        adapter: { title: 'Backend', description: 'Choose where uploaded files are stored.' },
        local: { title: 'Local' },
        s3: { title: 'S3' },
        limits: { title: 'Limits' },
      },
      keys: {
        adapter: {
          label: 'Adapter',
          options: { local: 'Local filesystem', s3: 'S3 / S3-compatible' },
        },
        local_root: { label: 'Root directory',
          help: 'Filesystem path under which files are stored. Relative paths resolve from the server CWD.' },
        s3_bucket: { label: 'Bucket',
          help: 'Shared host bucket. Per-project files are namespaced via the projects/<projectId>/ prefix.' },
        s3_region: { label: 'Region', help: 'Example: us-east-1' },
        s3_endpoint: { label: 'Endpoint',
          help: 'Custom endpoint for S3-compatible providers (R2, MinIO, Wasabi). Leave blank for AWS S3.' },
        s3_access_key_id: { label: 'Access key ID' },
        s3_secret_access_key: { label: 'Secret access key' },
        s3_force_path_style: { label: 'Force path-style URLs',
          help: 'Enable for MinIO and most S3-compatible providers; disable for AWS S3.' },
        presigned_ttl: { label: 'Presigned URL TTL (seconds)' },
        session_ttl: { label: 'Upload session TTL (seconds)',
          help: 'How long a chunked-upload session stays resumable.' },
        max_upload_mb: { label: 'Max upload size (MB)' },
      },
      actions: {
        test: { label: 'Test connection' },
      },
    },
  },
};
