// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { TranslationData } from '@objectstack/spec/system';
import { zhCNObjects } from './zh-CN.objects.generated.js';

/**
 * 简体中文 (zh-CN) — Setup App Translations
 */
export const zhCN: TranslationData = {
  objects: zhCNObjects,
  apps: {
    account: {
      label: '账户',
      description: '个人安全与身份设置',
      navigation: {
        grp_account_inbox: { label: '收件箱' },
        grp_account_security: { label: '安全' },
        grp_account_developer: { label: '开发者' },
        nav_account_profile: { label: '个人资料' },
        nav_account_notifications: { label: '通知' },
        nav_account_approvals: { label: '待我审批' },
        nav_account_memberships: { label: '我的组织' },
        nav_account_linked: { label: '已关联账户' },
        nav_account_sessions: { label: '活动会话' },
        nav_account_api_keys: { label: 'API 密钥' },
        nav_account_oauth_apps: { label: 'OAuth 应用' },
      },
    },
    setup: {
      label: '系统设置',
      description: '平台设置与管理',
      navigation: {
        group_overview: { label: '总览' },
        group_apps: { label: '应用' },
        nav_marketplace_browse: { label: '浏览应用市场' },
        nav_marketplace_installed: { label: '已安装应用' },
        nav_cloud_connection: { label: '云连接' },
        group_people_org: { label: '人员与组织' },
        group_access_control: { label: '访问控制' },
        group_approvals: { label: '审批' },
        group_configuration: { label: '配置' },
        group_integrations: { label: '集成' },
        group_diagnostics: { label: '诊断' },
        group_advanced: { label: '高级' },

        nav_system_overview: { label: '系统概览' },

        nav_users: { label: '用户' },
        nav_organization: { label: '组织' },
        nav_business_units: { label: '业务单元' },
        nav_teams: { label: '团队' },
        nav_organizations: { label: '组织' },
        nav_invitations: { label: '邀请' },

        nav_positions: { label: '岗位' },
        nav_capabilities: { label: '能力' },
        nav_permission_sets: { label: '权限集' },
        nav_sharing_rules: { label: '共享规则' },
        nav_record_shares: { label: '记录共享' },
        nav_api_keys: { label: 'API 密钥' },
        nav_connect_agent: { label: '连接智能体' },

        nav_approval_processes: { label: '审批流程' },
        nav_approval_requests: { label: '审批申请' },
        nav_approval_actions: { label: '审批历史' },

        nav_settings_hub: { label: '全部设置' },
        nav_settings_localization: { label: '本地化' },
        nav_settings_company: { label: '公司信息' },
        nav_settings_mail: { label: '邮件' },
        nav_settings_branding: { label: '品牌' },
        nav_settings_auth: { label: '认证' },
        nav_settings_storage: { label: '文件存储' },
        nav_settings_ai: { label: 'AI 与 Embedder' },
        nav_settings_knowledge: { label: '知识库' },
        nav_settings_feature_flags: { label: '功能开关' },
        nav_notification_preferences: { label: '通知偏好' },
        nav_notification_subscriptions: { label: '通知订阅' },
        nav_notification_templates: { label: '通知模板' },

        nav_sessions: { label: '会话' },
        nav_audit_logs: { label: '审计日志' },
        nav_notifications: { label: '通知' },

        nav_datasources: { label: '数据源' },

        nav_oauth_apps: { label: 'OAuth 应用' },
        nav_jwks: { label: '签名密钥 (JWKS)' },
        nav_accounts: { label: '身份链接' },
        nav_user_preferences: { label: '用户偏好' },
        nav_metadata: { label: '全部元数据' },
      },
    },
    studio: {
      label: 'Studio',
      description: '面向开发者、分析师与实施者的元数据工作台',
      navigation: {
        group_overview: { label: '总览' },
        nav_metadata_directory: { label: '全部元数据类型' },
        nav_packages: { label: '软件包' },
        group_data_model: { label: '数据模型' },
        nav_objects: { label: '对象' },
        nav_validations: { label: '校验规则' },
        group_ux: { label: '用户体验' },
        nav_apps: { label: '应用' },
        nav_views: { label: '视图' },
        nav_pages: { label: '页面' },
        nav_dashboards: { label: '仪表盘' },
        nav_reports: { label: '报表' },
        nav_datasets: { label: '数据集' },
        group_logic: { label: '逻辑' },
        nav_actions: { label: '动作' },
        nav_hooks: { label: '钩子' },
        group_automation: { label: '自动化' },
        nav_flows: { label: '流程' },
        nav_workflows: { label: '工作流规则' },
        group_ai: { label: 'AI' },
        nav_agents: { label: '智能体' },
        nav_tools: { label: '工具' },
        nav_skills: { label: '技能' },
        group_developer: { label: '开发者' },
        nav_api_console: { label: 'API 控制台' },
        nav_flow_runs: { label: '流程运行记录' },
        nav_public_forms: { label: '公开表单' },
        group_integration: { label: '集成' },
        nav_email_templates: { label: '邮件模板' },
      },
    },
  },

  dashboards: {
    system_overview: {
      label: '系统概览',
      description: '平台运行状况、安全活动与最近审计事件',
      widgets: {
        widget_total_users: { title: '用户总数', description: '系统中已注册的用户总数' },
        widget_organizations: { title: '组织数', description: '平台上的组织总数' },
        widget_active_sessions: { title: '活跃会话', description: '当前活跃用户会话数量' },
        widget_packages_installed: { title: '已安装包', description: '项目中已激活的安装包数' },
        widget_login_events: { title: '登录事件', description: '审计日志中记录的认证事件' },
        widget_permission_changes: { title: '权限变更', description: '最近的权限和角色修改' },
        widget_config_changes: { title: '配置变更', description: '系统配置修改' },
        widget_events_by_type: { title: '按操作分布的审计事件', description: '审计事件按操作类型分布' },
        widget_events_by_user: { title: '按用户分布的事件', description: '用户活动分布' },
        widget_recent_events: { title: '最近审计事件', description: '最新的平台事件（登录、权限、配置等）' },
      },
    },
  },
};
