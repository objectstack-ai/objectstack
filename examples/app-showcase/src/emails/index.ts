// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/** Email template fired by the Task Completed flow. */
export const TaskDoneEmail = {
  name: 'showcase_task_done_email',
  label: 'Task Done Notification',
  category: 'workflow' as const,
  locale: 'en',
  subject: '✅ Task done: {{title}}',
  bodyHtml: '<p>The task <strong>{{title}}</strong> on project {{project}} was marked done.</p>',
  bodyText: 'The task {{title}} on project {{project}} was marked done.',
  variables: [
    { name: 'title', type: 'string' as const, required: true, description: 'Task title' },
    { name: 'project', type: 'string' as const, required: false, description: 'Project name' },
  ],
  active: true,
  isSystem: false,
};

export const allEmails = [TaskDoneEmail];
