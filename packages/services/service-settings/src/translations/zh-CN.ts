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
          help: '共享主机 Bucket。各项目的文件通过 projects/<projectId>/ 前缀进行隔离。' },
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
  },
};
