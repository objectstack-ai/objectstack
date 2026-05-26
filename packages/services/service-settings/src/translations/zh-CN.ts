// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { TranslationData } from '@objectstack/spec/system';

/**
 * 简体中文 (zh-CN) — built-in settings manifest translations.
 */
export const zhCN: TranslationData = {
  settingsCommon: {
    sourceLabels: {
      env: '环境变量',
      global: '全局',
      tenant: '租户',
      user: '用户',
      default: '默认',
    },
  },
  settings: {
    mail: {
      title: '邮件投递',
      description: 'SMTP 与事务性邮件服务商配置。',
      groups: {
        provider: { title: '服务商', description: '选择此工作区如何发送邮件。' },
        smtp: { title: 'SMTP' },
        api_key: { title: 'API 密钥' },
        from_address: { title: '发件地址' },
      },
      keys: {
        provider: {
          label: '服务商',
          options: {
            smtp: 'SMTP',
            sendgrid: 'SendGrid',
            ses: 'Amazon SES',
            postmark: 'Postmark',
          },
        },
        smtp_host: { label: '主机', help: '示例:smtp.example.com' },
        smtp_port: { label: '端口' },
        smtp_secure: { label: '启用 TLS' },
        smtp_user: { label: '用户名' },
        smtp_password: { label: '密码' },
        api_key: { label: 'API 密钥' },
        from_email: { label: '发件地址', help: '示例:no-reply@example.com' },
        from_name: { label: '发件人名称' },
      },
      actions: {
        test: { label: '发送测试邮件' },
      },
    },

    branding: {
      title: '品牌',
      description: '工作区名称、Logo 与主题色。',
      groups: {
        identity: { title: '身份' },
        appearance: { title: '外观' },
      },
      keys: {
        workspace_name: { label: '工作区名称' },
        support_email: { label: '客服邮箱', help: '示例:support@example.com' },
        theme_mode: {
          label: '默认主题',
          options: { light: '浅色', dark: '深色', system: '跟随系统' },
        },
        accent_color: { label: '主题色' },
        logo_url: { label: 'Logo 链接', help: '示例:https://…/logo.svg' },
      },
    },

    feature_flags: {
      title: '功能开关',
      description: '为当前工作区开启实验性与测试功能。',
      groups: {
        productivity: { title: '生产力' },
        collaboration: { title: '协作' },
      },
      keys: {
        ai_enabled: {
          label: 'AI 助手',
          help: '启用应用内 AI 助手面板。',
        },
        kanban_swimlanes: { label: '看板泳道' },
        realtime_cursors: { label: '实时光标' },
        inline_comments: { label: '行内评论' },
      },
    },

    storage: {
      title: '文件存储',
      description:
        '附件、导出文件与用户上传所使用的存储后端。' +
        '⚠ 切换适配器不会迁移已有文件 —— 通过旧适配器上传的文件，在新适配器中将不可访问。',
      groups: {
        adapter: { title: '存储后端', description: '选择上传文件的存放位置。' },
        local: { title: '本地' },
        s3: { title: 'S3' },
        limits: { title: '限制' },
      },
      keys: {
        adapter: {
          label: '适配器',
          options: { local: '本地文件系统', s3: 'S3 / S3 兼容' },
        },
        local_root: { label: '根目录',
          help: '文件存放的文件系统路径。相对路径相对于服务进程的工作目录。' },
        s3_bucket: { label: 'Bucket',
          help: '共享主机 Bucket。各项目的文件通过 projects/<environmentId>/ 前缀进行隔离。' },
        s3_region: { label: '区域', help: '示例:us-east-1' },
        s3_endpoint: { label: 'Endpoint',
          help: 'S3 兼容服务(R2、MinIO、Wasabi)的自定义 Endpoint;AWS S3 请留空。' },
        s3_access_key_id: { label: 'Access Key ID' },
        s3_secret_access_key: { label: 'Secret Access Key' },
        s3_force_path_style: { label: '强制路径风格 URL',
          help: 'MinIO 与大多数 S3 兼容服务请开启;AWS S3 请关闭。' },
        presigned_ttl: { label: '预签名 URL 有效期(秒)' },
        session_ttl: { label: '分片上传会话有效期(秒)',
          help: '分片上传会话保持可续传的时长。' },
        max_upload_mb: { label: '单文件最大上传(MB)' },
      },
      actions: {
        test: { label: '测试连接' },
      },
    },

    ai: {
      title: 'AI 与 Embedder',
      description: '平台 AI 与知识库服务使用的 LLM 提供商、模型、凭据与向量化配置。',
      groups: {
        provider: { title: '提供商', description: '选择 LLM 后端。Memory 模式仅原样回显输入,仅用于测试,严禁用于生产。' },
        gateway: { title: 'Vercel AI Gateway', description: '多提供商路由器。模型规格遵循 `provider/model` 格式,例如 `openai/gpt-4o`。' },
        openai: { title: 'OpenAI' },
        anthropic: { title: 'Anthropic' },
        google: { title: 'Google' },
        defaults: { title: '生成默认值', description: '当 Agent 或聊天请求未指定时使用。' },
        observability: { title: '可观测性' },
        embedder: { title: 'Embedder', description: '知识库和 RAG 使用的文本→向量提供商,与上方聊天提供商相互独立。' },
      },
      keys: {
        provider: {
          label: '提供商',
          options: {
            memory: 'Memory(回显 — 仅测试)',
            gateway: 'Vercel AI Gateway',
            openai: 'OpenAI',
            anthropic: 'Anthropic',
            google: 'Google Generative AI',
          },
        },
        gateway_model: { label: 'Gateway 模型', help: '作为 AI_GATEWAY_MODEL 转发。示例:openai/gpt-4o' },
        gateway_api_key: { label: 'Gateway API Key', help: '可选 —— 仅当 Gateway 强制鉴权时需要。' },
        openai_api_key: { label: 'OpenAI API Key', help: '作为 OPENAI_API_KEY 转发,加密存储。' },
        openai_model: { label: '模型', help: '默认模型 ID。Agent 级覆盖优先生效。' },
        openai_base_url: { label: 'Base URL', help: '用于 Azure OpenAI 或自建网关。留空走 api.openai.com。' },
        anthropic_api_key: { label: 'Anthropic API Key', help: '作为 ANTHROPIC_API_KEY 转发,加密存储。' },
        anthropic_model: { label: '模型' },
        google_api_key: { label: 'Google API Key', help: '作为 GOOGLE_GENERATIVE_AI_API_KEY 转发,加密存储。' },
        google_model: { label: '模型' },
        temperature: { label: '温度', help: '0 = 确定性,2 = 高度发散。' },
        max_tokens: { label: '最大输出 tokens', help: '单次响应生成的硬上限。' },
        request_timeout_ms: { label: '请求超时(毫秒)' },
        trace_enabled: { label: '记录 Trace', help: '将 prompt/response 落入 sys_ai_trace,便于调试与回放。' },
        log_prompts: { label: '记录完整 Prompt', help: '在 trace 行中包含完整 prompt 而非仅元数据。⚠ 可能泄露 PII,合规场景请关闭。' },
        embedder_provider: {
          label: '提供商',
          options: {
            none: '禁用(不做向量化)',
            openai: 'OpenAI',
            azure: 'Azure OpenAI',
            dashscope: '阿里通义 DashScope',
            zhipu: '智谱 BigModel',
            siliconflow: '硅基流动 SiliconFlow',
            doubao: '火山引擎 Doubao',
            minimax: 'MiniMax',
            ollama: 'Ollama(本地)',
            custom: '自定义(OpenAI 兼容)',
          },
        },
        embedder_api_key: { label: 'Embedder API Key', help: '作为 Authorization Bearer 发送。Ollama 任意非空值均可。' },
        embedder_model: { label: '模型', help: '示例 — OpenAI: text-embedding-3-small · 阿里通义: text-embedding-v3 · 智谱: embedding-3 · 硅基流动: BAAI/bge-m3 · Ollama: bge-m3' },
        embedder_base_url: { label: 'Base URL', help: '端点根路径(不含 /embeddings)。预设会自动填充,可覆盖为代理或自建网关。' },
        embedder_dimensions: { label: '维度', help: '覆盖输出维度(仅 Matryoshka 模型支持)。留空使用模型默认值。' },
        embedder_batch_size: { label: '批量大小', help: '单次 embed() 调用的 chunk 数。命中速率/大小限制时调小。' },
      },
      actions: {
        test: { label: '测试连接' },
        test_embedder: { label: '测试 Embedder' },
      },
    },

    knowledge: {
      title: '知识库',
      description: 'RAG / 知识源使用的向量存储后端。⚠ 切换适配器不会迁移已有索引。',
      groups: {
        adapter: { title: '后端', description: '选择文档分块及其向量的存储位置。' },
        turso: { title: 'Turso / libSQL', description: '支持托管 Turso、本地文件、内存三种模式。' },
        ragflow: { title: 'RAGFlow', description: '外部 RAGFlow 部署。自部署文档见 https://ragflow.io 。' },
        indexing: { title: '索引默认值', description: 'KnowledgeSource.adapterConfig 上的逐源覆盖优先生效。' },
        permissions: { title: '权限' },
      },
      keys: {
        adapter: {
          label: '适配器',
          options: {
            memory: '内存(仅开发/测试)',
            turso: 'Turso / libSQL(云端或本地)',
            ragflow: 'RAGFlow(外部)',
          },
        },
        turso_url: { label: '连接 URL', help: '示例:libsql://your-tenant.turso.io · file:./.objectstack/knowledge.db · :memory:' },
        turso_auth_token: { label: 'Auth Token', help: '仅托管 Turso URL 需要。' },
        ragflow_base_url: { label: 'Base URL', help: '示例:http://localhost:9380' },
        ragflow_api_key: { label: 'API Key' },
        ragflow_default_dataset: { label: '默认 Dataset ID', help: 'KnowledgeSource 未指定时使用。' },
        chunk_target: { label: '目标 chunk 大小(字符)', help: '在按 token 切分之前的软上限。' },
        chunk_overlap: { label: 'Chunk 重叠(字符)', help: '保留上一个 chunk 末尾的字符,以保证跨界上下文。' },
        over_fetch: { label: '过取倍数', help: '内部按 topK × overFetch 拉取候选,以便 JS 端元数据过滤仍有行可返回。' },
        enforce_rls: { label: '搜索时强制 RLS', help: '对每条命中通过 IDataEngine 再次校验调用方的行级权限。⚠ 关闭将跳过平台对向量存储数据外泄的独有防护。' },
      },
      actions: {
        test: { label: '测试连接' },
      },
    },
  },
};
