// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { TranslationData } from '@objectstack/spec/system';

/**
 * 简体中文 (zh-CN) — built-in settings manifest translations.
 */
export const zhCN: TranslationData = {
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
  },
};
