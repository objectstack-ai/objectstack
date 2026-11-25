// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Tasks and notes — built-in platform objects every environment carries
 * (step 1: no links to other records; each object keeps its own sharing).
 */
export { SysTask, TASK_DONE_STATUS } from './sys-task.object.js';
export { SysNote } from './sys-note.object.js';
export { SYS_TASK_ASSIGNEE_SHARING_RULE, WORK_OBJECT_SHARING_RULES } from './sharing-rules.js';
export { installWorkObjectHooks, stampTaskCompletion, stampNoteHeading, firstLineOf } from './hooks.js';
