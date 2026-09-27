// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * platform-objects/audit — Audit & Realtime Platform Objects
 */

// sys_audit_log / sys_activity / sys_comment moved to @objectstack/plugin-audit
// and sys_presence to @objectstack/service-realtime (ADR-0029 K2).
// sys_notification stays here pending ADR-0030 messaging rework; sys_attachment
// stays here pending the storage-domain decomposition (it belongs with
// @objectstack/service-storage's sys_file, not the audit plugin).
export { SysNotification } from './sys-notification.object.js';
export { SysAttachment } from './sys-attachment.object.js';
export { SysEmail } from './sys-email.object.js';
export { SysEmailTemplate } from './sys-email-template.object.js';
// sys_saved_report / sys_report_schedule retired with the saved-report stack (#20102).
// sys_approval_request / sys_approval_action moved to @objectstack/plugin-approvals (ADR-0029 K2.b).
export { SysJob } from './sys-job.object.js';
export { SysJobRun } from './sys-job-run.object.js';
export { SysJobQueue } from './sys-job-queue.object.js';
export { SysImportJob } from './sys-import-job.object.js';
