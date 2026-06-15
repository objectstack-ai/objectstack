// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Object lifecycle hooks — the showcase's "logic layer".
 *
 * Each hook is a plain object validated by `HookSchema` inside
 * `defineStack({ hooks })` (same authoring style as webhooks). Together they
 * exercise the full hook designer surface so Studio has something real to
 * render for every property:
 *
 *   • multi-event targeting (`beforeInsert` + `beforeUpdate`)
 *   • an L2 sandboxed-JS `body` (language + source + capabilities)
 *   • a CEL `condition` gate
 *   • fire-and-forget `async` execution with a `retryPolicy`
 *   • `onError` / `priority` tuning across more than one object
 *
 * The bodies are deliberately tiny and side-effect-light — they are read as
 * documentation as much as they run.
 */

type LifecycleEvent =
  | 'beforeInsert' | 'afterInsert'
  | 'beforeUpdate' | 'afterUpdate'
  | 'beforeDelete' | 'afterDelete';

/** beforeInsert/beforeUpdate — normalise the task title before it is stored. */
export const NormalizeTaskTitleHook = {
  name: 'showcase_normalize_task_title',
  label: 'Normalize Task Title',
  object: 'showcase_task',
  events: ['beforeInsert', 'beforeUpdate'] as LifecycleEvent[],
  body: {
    language: 'js' as const,
    source: "if (ctx.input.title) ctx.input.title = ctx.input.title.trim();",
  },
  priority: 50,
  onError: 'abort' as const,
  description: 'Trims leading/trailing whitespace from the task title before every write.',
};

/** afterUpdate (gated) — log a line whenever a task flips to done. */
export const AuditTaskCompletionHook = {
  name: 'showcase_audit_task_completion',
  label: 'Audit Task Completion',
  object: 'showcase_task',
  events: ['afterUpdate'] as LifecycleEvent[],
  condition: "record.done == true",
  body: {
    language: 'js' as const,
    source: "var r = ctx.result || ctx.input || {}; if (typeof ctx.log === 'function') ctx.log('task completed: ' + (r.title || r.id || 'unknown'));",
    capabilities: ['log'] as ('log')[],
  },
  async: true,
  priority: 90,
  retryPolicy: { maxRetries: 3, backoffMs: 1000 },
  onError: 'log' as const,
  description: 'Fire-and-forget audit line emitted after a task transitions to done.',
};

/** afterUpdate (gated) — warn when a project goes over budget. */
export const WarnOverBudgetHook = {
  name: 'showcase_warn_over_budget',
  label: 'Warn On Over-Budget Project',
  object: 'showcase_project',
  events: ['afterUpdate'] as LifecycleEvent[],
  condition: "record.spent > record.budget",
  body: {
    language: 'js' as const,
    source: "var r = ctx.result || ctx.input || {}; if (typeof ctx.log === 'function') ctx.log('project over budget: ' + (r.name || r.id || 'unknown') + ' (' + r.spent + ' / ' + r.budget + ')');",
    capabilities: ['log'] as ('log')[],
  },
  async: true,
  onError: 'log' as const,
  description: 'Emits a warning when a project’s spend exceeds its budget.',
};

export const allHooks = [
  NormalizeTaskTitleHook,
  AuditTaskCompletionHook,
  WarnOverBudgetHook,
];
