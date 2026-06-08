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

    auth: {
      title: 'Authentication',
      description: 'Sign-in, registration, and built-in auth feature controls.',
      groups: {
        email_password: {
          title: 'Email and password',
          description: 'Control local email/password sign-in and self-service registration.',
        },
        social: {
          title: 'Social sign-in',
          description:
            'Configure the built-in Google sign-in provider. Deployment env vars still win.',
        },
      },
      keys: {
        email_password_enabled: { label: 'Enable email/password login' },
        signup_enabled: { label: 'Allow self-service registration' },
        require_email_verification: { label: 'Require email verification' },
        google_enabled: {
          label: 'Enable Google login',
          help: 'Requires a Google OAuth client ID and secret from Google Cloud Console.',
        },
        google_client_id: {
          label: 'Google client ID',
          help: 'OAuth client ID from Google Cloud Console. GOOGLE_CLIENT_ID can also be set on the server.',
        },
        google_client_secret: {
          label: 'Google client secret',
          help: 'Stored encrypted at rest. GOOGLE_CLIENT_SECRET can also be set on the server.',
        },
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
          help: 'Shared host bucket. Per-environment files are namespaced via the projects/<environmentId>/ prefix.' },
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

    ai: {
      title: 'AI & Embedder',
      description:
        'LLM provider, model, credentials, and embedder configuration used by ' +
        'the platform AI and knowledge services.',
      groups: {
        provider: { title: 'Provider',
          description: 'Choose the LLM backend. Memory mode echoes input — useful for tests but never for production.' },
        gateway: { title: 'Vercel AI Gateway',
          description: 'Multi-provider router. The model spec follows `provider/model`, e.g. `openai/gpt-4o`.' },
        openai: { title: 'OpenAI' },
        anthropic: { title: 'Anthropic' },
        google: { title: 'Google' },
        defaults: { title: 'Generation defaults',
          description: 'Applied when an agent or chat request does not specify its own value.' },
        observability: { title: 'Observability' },
        embedder: { title: 'Embedder',
          description:
            'Text → vector provider used by knowledge sources and RAG. ' +
            'Independent from the chat provider above.' },
      },
      keys: {
        provider: {
          label: 'Provider',
          options: {
            memory: 'Memory (echo — testing only)',
            gateway: 'Vercel AI Gateway',
            openai: 'OpenAI',
            anthropic: 'Anthropic',
            google: 'Google Generative AI',
          },
        },
        gateway_model: { label: 'Gateway model',
          help: 'Forwarded as AI_GATEWAY_MODEL. Example: openai/gpt-4o' },
        gateway_api_key: { label: 'Gateway API key',
          help: 'Optional — required only if the gateway enforces auth.' },
        openai_api_key: { label: 'OpenAI API key',
          help: 'Forwarded as OPENAI_API_KEY. Stored encrypted at rest.' },
        openai_model: { label: 'Model',
          help: 'Default model id. Per-agent overrides take precedence.' },
        openai_base_url: { label: 'Base URL',
          help: 'Override for Azure OpenAI or self-hosted gateways. Leave blank for api.openai.com.' },
        anthropic_api_key: { label: 'Anthropic API key',
          help: 'Forwarded as ANTHROPIC_API_KEY. Stored encrypted at rest.' },
        anthropic_model: { label: 'Model' },
        google_api_key: { label: 'Google API key',
          help: 'Forwarded as GOOGLE_GENERATIVE_AI_API_KEY. Stored encrypted at rest.' },
        google_model: { label: 'Model' },
        temperature: { label: 'Temperature',
          help: '0 = deterministic, 2 = highly creative.' },
        max_tokens: { label: 'Max output tokens',
          help: 'Hard cap on tokens generated per response.' },
        request_timeout_ms: { label: 'Request timeout (ms)' },
        trace_enabled: { label: 'Record traces',
          help: 'Persist prompt/response traces to sys_ai_trace for debugging and replay.' },
        log_prompts: { label: 'Log full prompts',
          help: 'Include rendered prompts (not just metadata) in trace rows. ⚠ May leak PII — disable in regulated environments.' },
        embedder_provider: {
          label: 'Provider',
          options: {
            none: 'Disabled (no embeddings)',
            openai: 'OpenAI',
            azure: 'Azure OpenAI',
            dashscope: '阿里通义 DashScope',
            zhipu: '智谱 BigModel',
            siliconflow: '硅基流动 SiliconFlow',
            doubao: '火山引擎 Doubao',
            minimax: 'MiniMax',
            ollama: 'Ollama (local)',
            custom: 'Custom (OpenAI-compatible)',
          },
        },
        embedder_api_key: { label: 'Embedder API key',
          help: 'Bearer token sent as Authorization header. For Ollama any non-empty value works.' },
        embedder_model: { label: 'Model',
          help: 'Examples — OpenAI: text-embedding-3-small · 阿里通义: text-embedding-v3 · 智谱: embedding-3 · 硅基流动: BAAI/bge-m3 · Ollama: bge-m3' },
        embedder_base_url: { label: 'Base URL',
          help: 'Endpoint root (without /embeddings). Auto-filled from preset; override for proxies or self-hosted gateways.' },
        embedder_dimensions: { label: 'Dimensions',
          help: 'Override output dimensionality (Matryoshka models only). Leave blank to use the model default.' },
        embedder_batch_size: { label: 'Batch size',
          help: 'Chunks per embed() call. Reduce if hitting provider rate / size limits.' },
      },
      actions: {
        test: { label: 'Test connection' },
        test_embedder: { label: 'Test embedder' },
      },
    },

    knowledge: {
      title: 'Knowledge',
      description:
        'Vector-store backend for RAG / knowledge sources. ' +
        '⚠ Switching adapter does NOT migrate existing indices.',
      groups: {
        adapter: { title: 'Backend',
          description: 'Choose where document chunks and their vectors are stored.' },
        turso: { title: 'Turso / libSQL',
          description: 'Works against managed Turso, local file, or in-memory.' },
        ragflow: { title: 'RAGFlow',
          description: 'External RAGFlow deployment. See https://ragflow.io for self-host instructions.' },
        indexing: { title: 'Indexing defaults',
          description: 'Per-source values on KnowledgeSource.adapterConfig take precedence.' },
        permissions: { title: 'Permissions' },
      },
      keys: {
        adapter: {
          label: 'Adapter',
          options: {
            memory: 'In-memory (dev / test only)',
            turso: 'Turso / libSQL (cloud or local)',
            ragflow: 'RAGFlow (external)',
          },
        },
        turso_url: { label: 'Connection URL',
          help: 'Examples: libsql://your-tenant.turso.io · file:./.objectstack/knowledge.db · :memory:' },
        turso_auth_token: { label: 'Auth token',
          help: 'Only required for managed Turso URLs.' },
        ragflow_base_url: { label: 'Base URL', help: 'Example: http://localhost:9380' },
        ragflow_api_key: { label: 'API key' },
        ragflow_default_dataset: { label: 'Default dataset id',
          help: 'Used when a KnowledgeSource does not specify its own RAGFlow dataset.' },
        chunk_target: { label: 'Target chunk size (chars)',
          help: 'Soft cap on chunk size before token-aware splitting kicks in.' },
        chunk_overlap: { label: 'Chunk overlap (chars)',
          help: 'Characters retained from the previous chunk so context survives the boundary.' },
        over_fetch: { label: 'Over-fetch multiplier',
          help: 'Internal topK × overFetch candidates fetched so JS-side metadata filtering still has rows.' },
        enforce_rls: { label: 'Enforce RLS on search',
          help: 'Re-check every hit against the caller\'s record-level permissions. ⚠ Disabling skips the platform\'s unique safeguard.' },
      },
      actions: {
        test: { label: 'Test connection' },
      },
    },
  },
};
