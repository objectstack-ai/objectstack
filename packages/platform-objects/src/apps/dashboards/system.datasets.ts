// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineDataset } from '@objectstack/spec/ui';

/**
 * Datasets backing the System Overview dashboard (ADR-0021). Each is a single-
 * object count/breakdown over a platform `sys_*` object. The audit objects live
 * in `@objectstack/plugin-audit` and `sys_package_installation` is cloud-only —
 * datasets reference objects BY NAME, so co-locating them with the dashboard
 * (registered by plugin-auth) is fine; the widgets that target absent objects
 * are runtime-gated via `requiresObject`.
 *
 * Each member carries its business vocabulary (ADR-0149 D1): `synonyms`, the
 * words an administrator types for it in a question, Chinese and English in
 * the one authored array (a synonym is match input, never translated, so no
 * bundle carries it), and a one-sentence `description`, which is display copy
 * and is translated at `datasets.<name>.{measures,dimensions}.<member>.description`.
 * These datasets reach the dataset AI tools through plugin-auth's runtime
 * manifest, where the vocabulary advisory never reads them, so nothing but
 * this file gives them words.
 *
 * The dataset tools match a term by EQUALITY after `normalizeDatasetTerm`, so
 * a phrase an administrator asks in ("how many users", 「有多少用户」) answers
 * only where it is written as one synonym. No synonym below is a word of
 * another measure in any of the five datasets, in any locale: a word on two
 * measures makes the tools ask which one is meant. The other language's label
 * is listed too (`users` beside 「用户」), because the label a caller is matched
 * against is the one served in the caller's locale. 「用户」 is also the zh-CN
 * label of the audit log's `user_id` dimension; a dimension match alone picks
 * no number, so the word still answers with `user_count`.
 */

export const SysUserDataset = defineDataset({
  name: 'sys_user_metrics',
  label: 'User Metrics',
  object: 'sys_user',
  dimensions: [],
  measures: [{
    name: 'user_count',
    label: 'Users',
    aggregate: 'count',
    description: 'The number of user accounts on record, active or not.',
    synonyms: [
      '用户', '用户数', '用户数量', '用户总数', '有多少用户',
      'users', 'user count', 'number of users', 'total users', 'how many users',
    ],
  }],
});

export const SysOrganizationDataset = defineDataset({
  name: 'sys_organization_metrics',
  label: 'Organization Metrics',
  object: 'sys_organization',
  dimensions: [],
  measures: [{
    name: 'org_count',
    label: 'Organizations',
    aggregate: 'count',
    description: 'The number of organizations on record; each one keeps its own members, data and settings.',
    synonyms: [
      '组织', '组织数', '组织数量', '组织总数', '有多少组织',
      'organizations', 'orgs', 'organization count', 'number of organizations', 'how many organizations',
    ],
  }],
});

export const SysSessionDataset = defineDataset({
  name: 'sys_session_metrics',
  label: 'Session Metrics',
  object: 'sys_session',
  dimensions: [],
  measures: [{
    name: 'session_count',
    label: 'Sessions',
    aggregate: 'count',
    description: 'The number of sign-in sessions on record, one per sign-in from a browser or device.',
    synonyms: [
      '会话', '会话数', '会话数量', '登录会话', '有多少会话',
      'sessions', 'session count', 'number of sessions', 'login sessions', 'how many sessions',
    ],
  }],
});

export const SysPackageInstallationDataset = defineDataset({
  name: 'sys_package_installation_metrics',
  label: 'Package Installation Metrics',
  object: 'sys_package_installation',
  dimensions: [],
  measures: [{
    name: 'package_count',
    label: 'Installations',
    aggregate: 'count',
    description: 'The number of package installations on record, one per package installed.',
    synonyms: [
      '已安装的包', '安装的包数', '包安装数', '装了多少包',
      'installations', 'installed packages', 'package installations', 'package count',
      'number of installed packages', 'how many packages are installed',
    ],
  }],
});

export const SysAuditLogDataset = defineDataset({
  name: 'sys_audit_log_metrics',
  label: 'Audit Log Metrics',
  object: 'sys_audit_log',
  dimensions: [
    {
      name: 'action',
      label: 'Action',
      field: 'action',
      type: 'string',
      description:
        'The kind of action an audit log entry records, such as create, update, delete, login or a configuration change.',
      synonyms: ['操作类型', '动作', '审计动作', 'action type', 'operation', 'audit action'],
    },
    // Rows the platform writes itself carry no `user_id`; their bucket reads
    // "System", not the renderer's default "(None)". An inline locale map:
    // the translation bundles have no slot for a dimension's null label.
    {
      name: 'user_id',
      label: 'User',
      field: 'user_id',
      type: 'lookup',
      description:
        'The user who performed the audited action; entries the platform writes itself are grouped under System.',
      synonyms: ['操作人', '操作者', '执行人', '操作用户', 'actor', 'performed by', 'acting user'],
      nullLabel: { en: 'System', 'zh-CN': '系统', 'ja-JP': 'システム', 'es-ES': 'Sistema', 'zh-Hant': '系統', ar: 'النظام', fr: 'Système', 'pt-BR': 'Sistema', ru: 'Система', de: 'System', ko: '시스템' },
    },
  ],
  measures: [{
    name: 'event_count',
    label: 'Events',
    aggregate: 'count',
    description:
      'The number of audit log entries; each records one action taken in the system, by a user or by the platform itself.',
    synonyms: [
      '事件', '事件数', '审计事件', '审计事件数', '审计日志条数', '有多少审计事件',
      'events', 'event count', 'audit events', 'audit log entries', 'how many audit events',
    ],
  }],
});

export const SystemOverviewDatasets = [
  SysUserDataset,
  SysOrganizationDataset,
  SysSessionDataset,
  SysPackageInstallationDataset,
  SysAuditLogDataset,
];
