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
        delivery: { title: '投递方式', description: '邮件以何种方式交给服务商。' },
      },
      keys: {
        provider: {
          label: '服务商',
          help: '此处只列出本服务器真正能投递的服务商。SendGrid 与 Amazon SES 通过 SMTP 配置。',
          options: {
            smtp: 'SMTP',
            resend: 'Resend',
            postmark: 'Postmark',
            log: '不发送(仅记录日志,不真正投递)',
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
        queue_delivery: {
          label: '持久化队列投递',
          help: '把每封邮件交给任务队列而不是内联发送:投递失败由 worker 按退避重试,进程重启也不会丢失。'
            + '需要挂载具备持久化适配器的队列能力。「发送测试邮件」始终走内联发送。',
        },
      },
      actions: {
        test: { label: '发送测试邮件' },
      },
    },

    sms: {
      title: '短信投递',
      description: '用于 OTP 登录、邀请与通知的短信服务商配置。',
      groups: {
        provider: { title: '服务商', description: '选择此工作区如何发送外发短信。' },
        aliyun: { title: '阿里云短信' },
        twilio: { title: 'Twilio' },
        limits: { title: '发送额度', description: '限制本部署的外发短信量。短信是付费通道,每一条都产生真实费用。' },
      },
      keys: {
        provider: {
          label: '服务商',
          options: {
            log: '无(仅记录日志 — 不真实发送)',
            aliyun: '阿里云短信',
            twilio: 'Twilio',
          },
        },
        aliyun_access_key_id: { label: 'AccessKey ID' },
        aliyun_access_key_secret: { label: 'AccessKey Secret' },
        aliyun_sign_name: { label: '短信签名' },
        aliyun_template_code: {
          label: '默认短信模板',
          help: '当发送未指定模板时使用。含单个 ${content} 变量的通用模板可用于发送通用通知短信。',
        },
        twilio_account_sid: { label: 'Account SID' },
        twilio_auth_token: { label: 'Auth Token' },
        twilio_from_number: {
          label: '发信号码',
          help: 'E.164 格式的发信方,例如 +15005550006。此项与 Messaging Service SID 二选一。',
        },
        twilio_messaging_service_sid: { label: 'Messaging Service SID' },
        daily_quota: {
          label: '每日发送上限',
          help: '本部署每个 UTC 自然日最多可发送的短信条数,涵盖 OTP 登录、邀请与通知。0 表示不限。超出上限的发送将被拒绝,直到 00:00 UTC。',
        },
      },
      actions: {
        test: { label: '发送测试短信' },
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

    company: {
      title: '公司',
      description: '法律实体信息——注册名称、地址、税号及主要联系人。',
      groups: {
        identity: { title: '主体信息' },
        address: { title: '注册地址' },
        contact: { title: '联系方式' },
      },
      keys: {
        legal_name: { label: '法定名称', help: '注册的法定名称(可能与工作区名称不同)。' },
        registration_number: { label: '注册号', help: '公司注册/工商登记号(如 EIN、统一社会信用代码)。' },
        tax_id: { label: '税号 / VAT', help: '发票上显示的税务标识(如 VAT、GST、ABN)。' },
        address_line1: { label: '地址行 1' },
        address_line2: { label: '地址行 2' },
        city: { label: '城市' },
        state: { label: '省/州' },
        postal_code: { label: '邮政编码' },
        country: { label: '国家/地区', help: 'ISO 3166-1 二位代码(如 US、GB、CN)。' },
        phone: { label: '电话', help: '建议 E.164 格式,如 +86 21 5555 0100。' },
        website: { label: '网站', help: '示例:https://example.com' },
        primary_contact_name: { label: '主要联系人' },
        primary_contact_email: { label: '主要联系人邮箱', help: '示例:ops@example.com' },
      },
    },

    localization: {
      title: '本地化',
      description: '默认时区、语言、货币及日期/数字格式。',
      groups: {
        region: { title: '区域' },
        formats: { title: '格式' },
        finance: { title: '财务' },
      },
      keys: {
        timezone: {
          label: '默认时区',
          help: '用于 today()/daysFromNow、分析日期分桶和 datetime 渲染的 IANA 时区。',
          options: {
            UTC: 'UTC',
            'America/Los_Angeles': '(UTC−08/−07) 洛杉矶',
            'America/Denver': '(UTC−07/−06) 丹佛',
            'America/Chicago': '(UTC−06/−05) 芝加哥',
            'America/New_York': '(UTC−05/−04) 纽约',
            'America/Sao_Paulo': '(UTC−03) 圣保罗',
            'Europe/London': '(UTC±00/+01) 伦敦',
            'Europe/Paris': '(UTC+01/+02) 巴黎',
            'Europe/Berlin': '(UTC+01/+02) 柏林',
            'Europe/Moscow': '(UTC+03) 莫斯科',
            'Asia/Dubai': '(UTC+04) 迪拜',
            'Asia/Kolkata': '(UTC+05:30) 加尔各答',
            'Asia/Singapore': '(UTC+08) 新加坡',
            'Asia/Shanghai': '(UTC+08) 上海',
            'Asia/Tokyo': '(UTC+09) 东京',
            'Australia/Sydney': '(UTC+10/+11) 悉尼',
            'Pacific/Auckland': '(UTC+12/+13) 奥克兰',
          },
        },
        locale: {
          label: '默认语言',
          help: '用于消息文案和数字/日期格式的 BCP-47 语言。',
          options: {
            'en-US': '英语(美国)',
            'zh-CN': '简体中文',
            'ja-JP': '日语',
            'es-ES': '西班牙语(西班牙)',
          },
        },
        default_country: { label: '默认国家/地区', help: 'ISO 3166-1 二位代码(如 US、GB、CN)。' },
        date_format: {
          label: '日期格式',
          options: {
            'YYYY-MM-DD': '2026-06-17(ISO)',
            'MM/DD/YYYY': '06/17/2026(美国)',
            'DD/MM/YYYY': '17/06/2026(欧洲)',
            'DD.MM.YYYY': '17.06.2026',
            'DD-MMM-YYYY': '17-Jun-2026',
          },
        },
        time_format: { label: '时间格式', options: { '24h': '24 小时制(14:30)', '12h': '12 小时制(2:30 PM)' } },
        number_format: {
          label: '数字格式',
          help: '用于显示数字的千分位与小数分隔符。',
          options: {
            '1,234.56': '1,234.56(逗号 / 句点)',
            '1.234,56': '1.234,56(句点 / 逗号)',
            '1 234,56': '1 234,56(空格 / 逗号)',
            '1,23,456.78': '1,23,456.78(印度)',
          },
        },
        first_day_of_week: { label: '每周起始日', help: '用作周度分析分桶与日历网格的起始基准。', options: { monday: '周一(ISO)', sunday: '周日', saturday: '周六' } },
        currency: {
          label: '默认货币',
          help: '当货币字段未指定币种时套用的 ISO 4217 代码。',
          options: {
            USD: 'USD — 美元',
            EUR: 'EUR — 欧元',
            GBP: 'GBP — 英镑',
            JPY: 'JPY — 日元',
            CNY: 'CNY — 人民币',
            INR: 'INR — 印度卢比',
            AUD: 'AUD — 澳大利亚元',
            CAD: 'CAD — 加拿大元',
            BRL: 'BRL — 巴西雷亚尔',
          },
        },
        fiscal_year_start: {
          label: '财年起始月',
          help: '财年的起始月份——决定报表中的"本季度/本财年"。',
          options: {
            january: '一月',
            february: '二月',
            march: '三月',
            april: '四月',
            may: '五月',
            june: '六月',
            july: '七月',
            august: '八月',
            september: '九月',
            october: '十月',
            november: '十一月',
            december: '十二月',
          },
        },
      },
    },

    auth: {
      title: '认证',
      description: '登录、注册以及内置认证功能的控制项。',
      groups: {
        email_password: {
          title: '邮箱与密码',
          description: '控制本地邮箱/密码登录与自助注册。',
        },
        membership: {
          title: '成员归属',
          description: '新建用户加入什么。与上方的自助注册成对配置。',
        },
        audience: {
          title: '注册受众',
          description: '谁可以成为本环境应用的用户。除「仅限邀请」外的口径会强制开启邮箱验证。邀请、管理员创建、SCIM 开通和企业 SSO 在任何口径下都可进入。',
        },
        password_policy: {
          title: '密码策略',
          description: '由认证提供商在注册和重置密码时强制的长度限制。',
        },
        anti_abuse: {
          title: '防滥用',
          description: '暴力破解防护:按身份的账户锁定,以及按 IP 对认证端点的限流。',
        },
        multi_factor: {
          title: '多因素',
          description: '要求成员使用身份验证器应用(TOTP)保护账户。',
        },
        sessions: {
          title: '会话',
          description: '登录会话的有效时长。',
        },
        network: {
          title: '网络',
          description: '限制用户可以从哪里登录。',
        },
        social: {
          title: '社交登录',
          description: '配置内置的 Google 登录提供商。部署环境变量仍优先生效。',
        },
      },
      keys: {
        email_password_enabled: { label: '启用邮箱/密码登录' },
        signup_enabled: { label: '允许自助注册' },
        require_email_verification: { label: '要求邮箱验证' },
        membership_policy: {
          label: '新用户的成员归属',
          help: '「自动加入」会把每个新用户绑定到本部署的默认组织；「仅限邀请」只在用户显式行动后才授予成员身份——自行创建工作区、接受邀请、被管理员添加，或由 SSO 即时开通。',
          options: {
            auto: '自动加入默认组织',
            'invite-only': '仅限邀请——绝不自动加入',
          },
        },
        audience_posture: {
          label: '自助注册受众',
          help: '「仅限邀请」关闭自助注册:用户只能通过运营侧行为进入——邀请、管理员创建/导入、SCIM 开通或企业 SSO。「邮箱域名」仅向下方允许列表中的域名开放;「开放」允许任何人自助注册。除「仅限邀请」外的口径会强制开启邮箱验证,并要求配置下方的自助注册权限集。',
          options: {
            invite_only: '仅限邀请——不开放自助注册(默认)',
            email_domain: '仅允许列表中的邮箱域名',
            open: '开放——任何人都可自助注册',
          },
        },
        audience_allowed_email_domains: {
          label: '允许的邮箱域名',
          help: '裸域名,每行一个或用逗号分隔(如 acme.com)。精确且不区分大小写匹配;子域名需单独列出;不支持通配符。',
        },
        audience_self_registration_permission_set: {
          label: '自助注册权限集',
          help: '每个自助注册用户获得的 sys_permission_set 名称(可显式声明 member_default;admin_full_access 会被拒绝)。',
        },
        password_min_length: { label: '密码最小长度' },
        password_max_length: { label: '密码最大长度', help: '防止超长密码哈希导致的拒绝服务。' },
        password_reject_breached: {
          label: '拒绝已泄露的密码',
          help: '通过 Have I Been Pwned 拦截出现在公开泄露库中的密码(k-匿名区间校验,绝不发送完整密码)。',
        },
        password_require_complexity: {
          label: '要求复杂密码',
          help: '在注册及修改/重置密码时,要求密码混合多种字符类别(大写、小写、数字、符号)。',
        },
        password_min_classes: {
          label: '最少字符类别数',
          help: '密码至少需包含四类(大写/小写/数字/符号)中的几类。',
        },
        password_history_count: {
          label: '密码历史(禁止重用)',
          help: '在修改/重置时禁止重用最近这么多个旧密码。0 表示关闭该检查。',
        },
        password_expiry_days: {
          label: '密码有效期(天)',
          help: '超过这么多天后强制修改密码。0 表示不过期。密码过期期间,用户在修改密码前将被阻止访问数据。',
        },
        lockout_threshold: {
          label: '账户锁定阈值',
          help: '连续登录失败达到此次数后锁定账户 —— 密码错误和两步验证码错误都计入。锁定期间即使凭据正确也会拒绝登录。0 表示关闭密码阶段的锁定;此时两步验证仍保留其内置限制(15 分钟内 10 次),因为它是签发会话前的最后一道校验。',
        },
        lockout_duration_minutes: {
          label: '锁定时长(分钟)',
          help: '越过阈值后账户保持锁定的时长,两个登录阶段通用。',
        },
        rate_limit_max: {
          label: '认证限流:最大请求数',
          help: '每个 IP、每个时间窗内对登录 / 注册 / 重置密码端点的最大请求数。',
        },
        rate_limit_window_seconds: {
          label: '认证限流:时间窗(秒)',
          help: '统计上述请求上限所用的滑动时间窗。',
        },
        mfa_required: {
          label: '要求多因素认证',
          help: '未注册身份验证器的用户在宽限期结束后将被阻止访问数据。启用此项也会开启两步验证功能,以便用户注册。',
        },
        mfa_grace_period_days: {
          label: 'MFA 宽限期(天)',
          help: '用户在被硬阻断前可延迟注册的时长。0 表示立即阻断。',
        },
        session_expiry_days: { label: '会话有效期(天)', help: '登录后会话在此天数后过期。' },
        session_refresh_days: { label: '刷新阈值(天)', help: '活跃会话在超过此时长后自动续期。' },
        session_idle_timeout_minutes: {
          label: '空闲超时(分钟)',
          help: '在这么多分钟无活动后将用户登出。0 表示关闭。',
        },
        session_absolute_max_hours: {
          label: '会话绝对有效期(小时)',
          help: '登录后经过这么多小时强制重新认证,与是否活跃无关。0 表示关闭。',
        },
        max_concurrent_sessions_per_user: {
          label: '每用户最大并发会话数',
          help: '限制每个用户同时在线的会话数;超出上限后最旧的会话会被登出。0 表示不限制。',
        },
        allowed_ip_ranges: {
          label: '允许的 IP 段',
          help: 'CIDR 段或精确 IP(每行一个,或用逗号分隔),例如 203.0.113.0/24。设置后,来自这些范围之外的登录将被拒绝。留空表示不限制。需要可信代理设置 X-Forwarded-For。',
        },
        google_enabled: {
          label: '启用 Google 登录',
          help: '需要在 Google Cloud Console 中创建的 Google OAuth 客户端 ID 与密钥。',
        },
        google_client_id: {
          label: 'Google 客户端 ID',
          help: '来自 Google Cloud Console 的 OAuth 客户端 ID。也可在服务器上设置 GOOGLE_CLIENT_ID。',
        },
        google_client_secret: {
          label: 'Google 客户端密钥',
          help: '加密存储。也可在服务器上设置 GOOGLE_CLIENT_SECRET。',
        },
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
        deepseek: { title: 'DeepSeek', description: 'https://api.deepseek.com 上的 OpenAI 兼容 API,Base URL 自动填充。' },
        dashscope: { title: '阿里通义 DashScope', description: 'dashscope.aliyuncs.com/compatible-mode/v1 上的 OpenAI 兼容端点,Base URL 自动填充。' },
        cloudflare: { title: 'Cloudflare AI Gateway', description: '通过 Cloudflare AI Gateway 代理 OpenAI 兼容模型。' },
        siliconflow: { title: '硅基流动 SiliconFlow', description: 'api.siliconflow.cn/v1 上的 OpenAI 兼容端点,Base URL 自动填充。' },
        openrouter: { title: 'OpenRouter', description: 'openrouter.ai/api/v1 上的多提供商路由,Base URL 自动填充。' },
        titles: { title: '会话标题', description: '为新会话自动生成简短的摘要标题。' },
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
            deepseek: 'DeepSeek(OpenAI 兼容)',
            dashscope: '阿里通义 DashScope(OpenAI 兼容)',
            cloudflare: 'Cloudflare AI Gateway(OpenAI 兼容)',
            siliconflow: '硅基流动 SiliconFlow(OpenAI 兼容)',
            openrouter: 'OpenRouter(OpenAI 兼容)',
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
        deepseek_api_key: { label: 'DeepSeek API Key', help: 'sk-…,在 platform.deepseek.com 签发。' },
        deepseek_model: { label: '模型', help: '示例:deepseek-chat(V3)、deepseek-reasoner(R1 推理)。' },
        dashscope_api_key: { label: 'DashScope API Key', help: 'sk-…,在 dashscope.console.aliyun.com 签发。' },
        dashscope_model: { label: '模型' },
        cloudflare_account_id: { label: 'Cloudflare Account ID', help: '来自 Cloudflare 控制台 URL 的 32 位十六进制 ID。' },
        cloudflare_gateway_id: { label: 'Gateway ID', help: '在 Cloudflare → AI Gateway 中配置的网关名称,默认为 `default`。' },
        cloudflare_api_key: { label: 'Cloudflare AI Gateway Token', help: '在 AI Gateway →「API tokens」标签页签发(cfut_… 或 sk_…)。' },
        cloudflare_model: { label: '模型' },
        siliconflow_api_key: { label: 'SiliconFlow API Key' },
        siliconflow_model: { label: '模型', help: '示例:Qwen/Qwen2.5-72B-Instruct、deepseek-ai/DeepSeek-V3、meta-llama/Meta-Llama-3.1-8B-Instruct。' },
        openrouter_api_key: { label: 'OpenRouter API Key' },
        openrouter_model: { label: '模型', help: '格式:provider/model(例如 anthropic/claude-3.5-sonnet、deepseek/deepseek-chat)。' },
        title_generation_enabled: { label: '自动为会话生成摘要标题' },
        title_max_length: { label: '标题最大长度(字符)', help: '生成标题的硬上限,超出部分在服务端截断。' },
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
