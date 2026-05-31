// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Outbound webhook — fans out task changes to an external endpoint with a
 * retry policy. Validated as part of `defineStack({ webhooks })`.
 */
export const TaskChangedWebhook = {
  name: 'showcase_task_changed',
  label: 'Task Changed → External',
  object: 'showcase_task',
  triggers: ['create', 'update', 'delete'] as ('create' | 'update' | 'delete')[],
  url: 'https://hooks.example/showcase/task',
  method: 'POST' as const,
  retryPolicy: { maxRetries: 3, backoffStrategy: 'exponential' as const, initialDelayMs: 1000, maxDelayMs: 30000 },
  isActive: true,
  description: 'Sends task lifecycle events to an external system.',
};

export const allWebhooks = [TaskChangedWebhook];
