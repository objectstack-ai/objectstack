// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineDataset } from '@objectstack/spec/ui';

/**
 * Datasets backing the System Overview dashboard (ADR-0021). Each is a single-
 * object count/breakdown over a platform `sys_*` object. The audit objects live
 * in `@objectstack/plugin-audit` and `sys_package_installation` is cloud-only —
 * datasets reference objects BY NAME, so co-locating them with the dashboard
 * (registered by plugin-auth) is fine; the widgets that target absent objects
 * are runtime-gated via `requiresObject`.
 */

export const SysUserDataset = defineDataset({
  name: 'sys_user_metrics',
  label: 'User Metrics',
  object: 'sys_user',
  dimensions: [],
  measures: [{ name: 'user_count', label: 'Users', aggregate: 'count' }],
});

export const SysOrganizationDataset = defineDataset({
  name: 'sys_organization_metrics',
  label: 'Organization Metrics',
  object: 'sys_organization',
  dimensions: [],
  measures: [{ name: 'org_count', label: 'Organizations', aggregate: 'count' }],
});

export const SysSessionDataset = defineDataset({
  name: 'sys_session_metrics',
  label: 'Session Metrics',
  object: 'sys_session',
  dimensions: [],
  measures: [{ name: 'session_count', label: 'Sessions', aggregate: 'count' }],
});

export const SysPackageInstallationDataset = defineDataset({
  name: 'sys_package_installation_metrics',
  label: 'Package Installation Metrics',
  object: 'sys_package_installation',
  dimensions: [],
  measures: [{ name: 'package_count', label: 'Installations', aggregate: 'count' }],
});

export const SysAuditLogDataset = defineDataset({
  name: 'sys_audit_log_metrics',
  label: 'Audit Log Metrics',
  object: 'sys_audit_log',
  dimensions: [
    { name: 'action', label: 'Action', field: 'action', type: 'string' },
    { name: 'user_id', label: 'User', field: 'user_id', type: 'lookup' },
  ],
  measures: [{ name: 'event_count', label: 'Events', aggregate: 'count' }],
});

export const SystemOverviewDatasets = [
  SysUserDataset,
  SysOrganizationDataset,
  SysSessionDataset,
  SysPackageInstallationDataset,
  SysAuditLogDataset,
];
