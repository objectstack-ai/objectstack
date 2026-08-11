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
    // [#7543] The guard is `typeof … === 'string'`, not truthiness. A JSON body
    // may put a number in a `text` field — `{"title": 12345}` — which is truthy,
    // has no `.trim`, and made this body throw `TypeError: not a function` on a
    // write the platform otherwise ACCEPTS (`record-validator` coerces a `text`
    // value with `String(value)`). These bodies are read as documentation, so
    // the type-safe shape is the one to show: a hook must not assume a field's
    // runtime type just because its metadata declares one.
    language: 'js' as const,
    source: "if (typeof ctx.input.title === 'string') ctx.input.title = ctx.input.title.trim();",
  },
  priority: 50,
  onError: 'abort' as const,
  description: 'Trims leading/trailing whitespace from the task title before every write.',
};

/**
 * afterUpdate (gated) — log a line on the update that flips a task to done.
 *
 * The condition compares against `previous` on purpose (#4784). Since #4770
 * `record` means the record's STATE, so `record.done == true` alone would audit
 * every later edit of an already-done task — while this hook's own description
 * says "transitions to done". The transition is the two-root form.
 */
export const AuditTaskCompletionHook = {
  name: 'showcase_audit_task_completion',
  label: 'Audit Task Completion',
  object: 'showcase_task',
  events: ['afterUpdate'] as LifecycleEvent[],
  condition: "previous.done != true && record.done == true",
  body: {
    language: 'js' as const,
    source: "var r = ctx.result || ctx.input || {}; ctx.log.info('task completed: ' + (r.title || r.id || 'unknown'));",
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
  // Guard with `!= null`, NOT with `has()` (#4770, same lesson as #4649). A
  // condition is evaluated against the STORED record overlaid with this
  // write's payload, made total over the object's declared fields — so a
  // partial write (the task-rollup that only touches task_count) still sees
  // spent/budget, and `has(record.spent)` is uniformly TRUE for a declared
  // field, including one holding null. Only `!= null` actually keeps
  // `null > null` — which CEL has no overload for — from aborting the
  // expression.
  condition: "record.spent != null && record.budget != null && record.spent > record.budget",
  body: {
    language: 'js' as const,
    source: "var r = ctx.result || ctx.input || {}; ctx.log.warn('project over budget: ' + (r.name || r.id || 'unknown') + ' (' + r.spent + ' / ' + r.budget + ')');",
    capabilities: ['log'] as ('log')[],
  },
  async: true,
  onError: 'log' as const,
  description: 'Emits a warning when a project’s spend exceeds its budget.',
};

/**
 * beforeInsert — stamp server-controlled defaults on a public inquiry.
 *
 * The web-to-lead public form (ADR-0056 Option A) lets anonymous visitors
 * INSERT a `showcase_inquiry`. Its field whitelist already excludes `status` /
 * `source`, but this hook is the server-side belt-and-braces: it stamps
 * `status = 'new'` and `source = 'web'` so an inquiry can never arrive
 * pre-triaged, regardless of how the request was crafted.
 */
export const StampInquiryDefaultsHook = {
  name: 'showcase_stamp_inquiry_defaults',
  label: 'Stamp Inquiry Defaults',
  object: 'showcase_inquiry',
  events: ['beforeInsert'] as LifecycleEvent[],
  body: {
    language: 'js' as const,
    source: "if (!ctx.input.status) ctx.input.status = 'new'; if (!ctx.input.source) ctx.input.source = 'web';",
  },
  priority: 50,
  onError: 'abort' as const,
  description: 'Stamps status=new and source=web on every new inquiry (public web-to-lead defaults).',
};

export const allHooks = [
  NormalizeTaskTitleHook,
  StampInquiryDefaultsHook,
  AuditTaskCompletionHook,
  WarnOverBudgetHook,
];
