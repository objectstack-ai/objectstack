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

/**
 * The sentence {@link GuardTaskReopenHook} refuses with. Exported so the
 * fixture's test quotes the same string the hook throws.
 */
export const TASK_REOPEN_REFUSAL =
  'A finished task cannot be reopened. Create a follow-up task instead.';

/**
 * beforeUpdate (gated) — the showcase's first hook that REFUSES a write, with a
 * sentence addressed to the user. (The three paid-invoice line guards below
 * refuse the same way.)
 *
 * `throw new Error('<sentence>')` from a sandboxed body is the business-refusal
 * shape: the write is aborted (`onError: 'abort'`) and the sentence travels to
 * the caller as a 4xx — on `/data`, and through a script action's `ctx.api`
 * write on `/actions` too (`packages/runtime/src/sandbox/
 * nested-hook-refusal-is-a-rejection.test.ts`). `showcase_reopen_task`
 * (`src/ui/actions/index.ts`) is the script action that reaches it, and the
 * platform checklist item `records-forms.script-action-hook-refusal-toast`
 * drives that action in the console.
 *
 * The condition is the two-root transition form (same lesson as
 * {@link AuditTaskCompletionHook}): only the write that flips `done` from true
 * to not-true is refused. An edit of a finished task that leaves `done` alone
 * still lands.
 */
export const GuardTaskReopenHook = {
  name: 'showcase_guard_task_reopen',
  label: 'Guard Task Reopen',
  object: 'showcase_task',
  events: ['beforeUpdate'] as LifecycleEvent[],
  condition: 'previous.done == true && record.done != true',
  body: {
    language: 'js' as const,
    source: `throw new Error(${JSON.stringify(TASK_REOPEN_REFUSAL)});`,
  },
  priority: 60,
  onError: 'abort' as const,
  description: 'Refuses reopening a finished task (done true to false) with a user-facing sentence.',
};

/**
 * The sentences the paid-invoice line guards refuse with. Exported so the
 * fixture's test quotes the same strings the hooks throw.
 */
export const PAID_INVOICE_LINE_ADD_REFUSAL =
  'This invoice is paid, so its lines are locked: a line cannot be added to it.';
export const PAID_INVOICE_LINE_REMOVE_REFUSAL =
  'This invoice is paid, so its lines are locked: a line cannot be removed from it.';
export const PAID_INVOICE_LINE_MOVE_REFUSAL =
  'A paid invoice\'s lines are locked: a line cannot be moved onto or off a paid invoice.';

/**
 * The shared prelude of the three guards: `paid(id)` reads the header's status.
 *
 * Two kinds of write pass every guard:
 *  - a SYSTEM write (`ctx.session.isSystem`): the seed loads INV-1003's line
 *    under a header that is already paid, and a migration or import restores
 *    history. Every system writer passes by design — the seed, a script
 *    action's `ctx.api`, a `runAs: 'system'` flow — and none writes
 *    `showcase_invoice_line` in the showcase today. The platform's static
 *    `readonly` strip exempts system writes the same way;
 *  - a header that cannot be read: the engine's reference check answers a
 *    dangling `invoice` with its own refusal, so the guard does not invent one.
 */
const PAID_HEADER_PRELUDE =
  "if (ctx.session && ctx.session.isSystem) return;" +
  "var paid = async function (id) {" +
  "  if (!id) return false;" +
  "  var header = await ctx.api.object('showcase_invoice').findOne({ where: { id: id } });" +
  "  return !!header && header.status === 'paid';" +
  "};";

/**
 * beforeInsert / beforeUpdate / beforeDelete — a PAID invoice's lines are
 * locked against adding, moving and removing.
 *
 * `readonlyWhen: parent.status == 'paid'` on the line's `product`, `quantity`
 * and `unit_price` (`invoice.object.ts`) locks EDITS of an existing line. It is
 * insert-exempt by design, and it judges field values, not a line's existence,
 * so it cannot stop a line from being added, removed, or repointed at another
 * invoice. Each of those moves the paid `total`. A `validations[]` rule cannot
 * hold these either: no `validations[]` rule binds `parent`, and none runs on
 * delete. So the three guards are hooks, the mechanism
 * `ValidationRuleSchema.events` prescribes for that case.
 *
 * Each guard reads the header itself, under `runAs: 'system'`. The verdict is
 * the system's, and it must not depend on the writer's read grants on
 * invoices.
 */
export const GuardPaidInvoiceLineAddHook = {
  name: 'showcase_guard_paid_invoice_line_add',
  label: 'Guard Paid Invoice Line Add',
  object: 'showcase_invoice_line',
  events: ['beforeInsert'] as LifecycleEvent[],
  body: {
    language: 'js' as const,
    source:
      PAID_HEADER_PRELUDE +
      `if (await paid(ctx.input.invoice)) throw new Error(${JSON.stringify(PAID_INVOICE_LINE_ADD_REFUSAL)});`,
    capabilities: ['api.read'] as ('api.read')[],
  },
  runAs: 'system' as const,
  priority: 60,
  onError: 'abort' as const,
  description: 'Refuses adding a line to a paid invoice, with a user-facing sentence.',
};

/**
 * The repoint half: an update that moves a line's `invoice` onto or off a paid
 * header. The condition gates the hook to that write, so an ordinary line
 * edit pays no header read.
 */
export const GuardPaidInvoiceLineMoveHook = {
  name: 'showcase_guard_paid_invoice_line_move',
  label: 'Guard Paid Invoice Line Move',
  object: 'showcase_invoice_line',
  events: ['beforeUpdate'] as LifecycleEvent[],
  condition: 'record.invoice != previous.invoice',
  body: {
    language: 'js' as const,
    source:
      PAID_HEADER_PRELUDE +
      "var before = ctx.previous ? ctx.previous.invoice : undefined;" +
      `if ((await paid(before)) || (await paid(ctx.input.invoice))) throw new Error(${JSON.stringify(PAID_INVOICE_LINE_MOVE_REFUSAL)});`,
    capabilities: ['api.read'] as ('api.read')[],
  },
  runAs: 'system' as const,
  priority: 60,
  onError: 'abort' as const,
  description: 'Refuses moving a line onto or off a paid invoice, with a user-facing sentence.',
};

/**
 * The remove half. A cascade delete (`ctx.referentialCascadeDelete`) passes:
 * that is the header itself being deleted, not a line removed from a header
 * that stays.
 */
export const GuardPaidInvoiceLineRemoveHook = {
  name: 'showcase_guard_paid_invoice_line_remove',
  label: 'Guard Paid Invoice Line Remove',
  object: 'showcase_invoice_line',
  events: ['beforeDelete'] as LifecycleEvent[],
  body: {
    language: 'js' as const,
    source:
      PAID_HEADER_PRELUDE +
      "if (ctx.referentialCascadeDelete === true || !ctx.previous) return;" +
      `if (await paid(ctx.previous.invoice)) throw new Error(${JSON.stringify(PAID_INVOICE_LINE_REMOVE_REFUSAL)});`,
    capabilities: ['api.read'] as ('api.read')[],
  },
  runAs: 'system' as const,
  priority: 60,
  onError: 'abort' as const,
  description: 'Refuses removing a line from a paid invoice, with a user-facing sentence.',
};

export const allHooks = [
  NormalizeTaskTitleHook,
  StampInquiryDefaultsHook,
  GuardTaskReopenHook,
  GuardPaidInvoiceLineAddHook,
  GuardPaidInvoiceLineMoveHook,
  GuardPaidInvoiceLineRemoveHook,
  AuditTaskCompletionHook,
  WarnOverBudgetHook,
];
