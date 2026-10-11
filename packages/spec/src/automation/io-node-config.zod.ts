// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @module automation/io-node-config
 *
 * Config contracts for the flat IO builtins — `notify` and `http` (#4045).
 *
 * ## Provenance — written from the executors, not from the forms
 *
 * Each schema here was derived by reading what the executor actually does with
 * `node.config` (`service-automation/builtin/notify-node.ts`, `http-nodes.ts`),
 * **not** by transcribing the hand-written `configSchema` literal on the node's
 * descriptor. That independence is the point: the two artifacts are reconciled
 * bidirectionally by `io-node-form-zod-ledger.test.ts` in `service-automation`,
 * and a Zod copied from the form would make that reconciliation a tautology —
 * it would pass by construction and prove nothing (#4045).
 *
 * ## What these schemas are wired to (#4277)
 *
 * Like `LoopConfigSchema` / `ParallelConfigSchema` / `TryCatchConfigSchema`,
 * these are **live execute-time contracts**: each executor `parse()`s its
 * config against its schema before running (`service-automation`'s
 * `parse-config.ts`), so type and `required` violations refuse the node as a
 * guard (not routable via `fault` edges). `notify` parses the RAW stored
 * config — its text slots carry `{{ }}` holes and its value slots a CEL value
 * envelope or a literal (#19939), so both pass, a `{token}` in either is
 * refused, and the post-evaluation guards still own "resolved to nothing".
 * `http` parses the
 * INTERPOLATED config, because that is the shape
 * its executor reads — a `{token}` in a typed slot (`timeoutMs`, `durable`)
 * resolves to its real type first.
 *
 * ## Unknown keys — closed here too, as of #4001 批 9
 *
 * These contracts used to say "unknown keys are the registration layer's job":
 * `registerFlow()` rejects keys the descriptor `configSchema` does not declare
 * (the tightened #4059 check), and this parse merely stripped them. That is one
 * door, and the #4001 campaign's second recurring finding is that a schema
 * which strips by default leaves every OTHER door open — whoever writes the
 * guard is fixing the bug in front of them, not auditing the surface.
 *
 * The registration check remains the first door a stored flow meets and the
 * more informative one (it walks NESTED config against the descriptor's JSON
 * Schema and prints the declared set per path, which a flat key list cannot).
 * What changes is that a config reaching `parse()` by any OTHER route — a
 * direct `NotifyConfigSchema.parse()` in tooling, a host that composes the
 * engine without `registerFlow`, a future executor seam — no longer has its
 * undeclared keys silently deleted. The two doors are kept in agreement by
 * `io-node-form-zod-ledger.test.ts`, which reconciles this key set against the
 * descriptor's in both directions.
 *
 * `connector_action` has no schema here on purpose: its config contract is
 * empty. The executor reads only the declared `FlowNodeSchema.connectorConfig`
 * sibling block — see the descriptor note in
 * `service-automation/builtin/connector-nodes.ts`.
 */

import { z } from 'zod';
import { ExpressionSchema } from '../shared/expression.zod';
import { lazySchema } from '../shared/lazy-schema';
import { NON_BLANK_STRING } from '../shared/refinement-projection';
import { strictObject } from '../shared/strict-object';
// The package-internal constructor `TemplateExpressionInputSchema` itself is
// built with — never re-exported, so the notify sentences add no public surface.
import { templateExpressionInput, type TypedExpressionRefusals } from '../shared/typed-expression-input';
import { textSlotTemplateRefusal } from './flow-text-slot-template';
// [#19939] The notify value slots take the one value-slot contract and its one
// judge — composed here, never re-spelled.
import {
  AssignmentExpressionValueSchema,
  FlowValueSlotSchema,
  VALUE_ENVELOPE_REFUSAL,
} from './builtin-node-config.zod';
import { isExpressionEnvelopeShaped } from './flow-node-expression-paths';
import { valueSlotTemplateRefusals } from './flow-value-slot-template';

/**
 * What a rejected key on these contracts silently did before #4001 批 9.
 *
 * Shared by both schemas because the failure was identical: the step ran, the
 * notification went out or the request was made, and the run reported success
 * minus whatever the key was meant to configure.
 */
const IO_NODE_CONFIG_HISTORY =
  'Until this shape was closed, an undeclared key here was dropped at the execute-time parse — the step still ran and '
  + 'the run still reported success, minus whatever the key was meant to configure.';

/**
 * `notify` prescriptions for the four ADR-0087 D2 aliases and the nested
 * `source` shape (#3796 / #4045).
 *
 * Each is a RETIRED SPELLING, not a typo, so a bare "did you mean" would
 * under-serve it: `flow-node-notify-config-aliases` rewrites all five at load
 * (including the `registerFlow` rehydration seam). Since #4923 that rewrite
 * also DELETES a retired spelling that merely repeats the canonical key's
 * value, which sharpens what a surviving one means: it survived because the
 * canonical key is also present and says something DIFFERENT, and the
 * conversion will not pick between two values the author wrote.
 *
 * So each prescription answers both readings — the rename, for whoever parses
 * this contract directly, and a reconciliation naming BOTH keys, for whoever
 * came through the load path.
 */
const NOTIFY_KEY_GUIDANCE: Readonly<Record<string, string>> = {
  to:
    'The recipient slot is `recipients`. `to` is the pre-17 spelling, rewritten at load by the ADR-0087 D2 '
    + 'conversion `flow-node-notify-config-aliases` — so if `recipients` is also present, the two name DIFFERENT '
    + 'recipients and the conversion kept both rather than choosing who gets notified. Decide the '
    + 'recipients, put them on `recipients`, and delete `to`.',
  subject:
    'The heading slot is `title`. `subject` is the pre-17 spelling rewritten at load by '
    + '`flow-node-notify-config-aliases`; delete it once `title` carries the text. If `title` is also present with '
    + 'a DIFFERENT value, the conversion kept both rather than choosing — reconcile them onto `title`.',
  body:
    'The body slot is `message`. `body` is the pre-17 spelling rewritten at load by '
    + '`flow-node-notify-config-aliases`; delete it once `message` carries the text. If `message` is also present '
    + 'with a DIFFERENT value, the conversion kept both rather than choosing — reconcile them onto `message`. '
    + '(`body` IS canonical on an `http` node — the key is wrong only here.)',
  url:
    'The click-through slot is `actionUrl`. It was renamed at 17 because `url` elsewhere on the platform means '
    + '"HTTP endpoint to call" (`http` node, webhooks), a different concept from an in-app click target. '
    + '`flow-node-notify-config-aliases` rewrites it at load; delete it once `actionUrl` carries the link. If '
    + '`actionUrl` is also present with a DIFFERENT link, the conversion kept both rather than choosing where the '
    + 'notification points — reconcile them onto `actionUrl`.',
  source:
    'The click-through target is the flat PAIR `sourceObject` + `sourceId`, never a nested `source: { object, id }`. '
    + '`flow-node-notify-config-aliases` lifts the nested shape at load and drops it once every part is accounted '
    + 'for, so a surviving `source` means a part of it holds a DIFFERENT value from the flat `sourceObject` / '
    + '`sourceId` already in that slot, and the conversion declined to pick — reconcile onto the flat pair '
    + 'and delete `source`. '
    + 'Note the pair only takes effect together: a half-specified target is dropped so the inbox never renders a '
    + 'dead link.',
};

/**
 * The placeholder every notify `title` / `message` refusal prescribes — the
 * ONE place it is written. Since protocol 18 (#22110, executing ADR-0032 D3)
 * the notify executor renders both slots through the formula template
 * engine, whose holes are `{{ }}`; a single-brace `{token}` is refused at
 * every door (`flow-text-slot-template.ts`). These two slots still take their
 * input from `templateExpressionInput` (`shared/typed-expression-input.ts`,
 * package-internal) rather than `TemplateExpressionInputSchema`, because the
 * sentences below name the slot ("A notify node's title …") where the
 * shared ones cannot (#22081).
 */
const NOTIFY_TEMPLATE_PLACEHOLDER = '{{ record.name }}';

/**
 * Why the notify prescription is a `{{ }}` hole, in the words every notify
 * template refusal ends on.
 */
const NOTIFY_TEMPLATE_RENDERER =
  'the notify executor renders `{{ }}` template holes (ADR-0032 §3) — a variable path with an optional formatter, '
  + '`{{ amount | currency }}` — and a single-brace token is not one.';

/**
 * The two sentences a notify `title` / `message` refuses a malformed value
 * with — the shared template input's refusals (a blank bare string; a value
 * that is neither a string nor a `template` envelope), naming the key and
 * prescribing {@link NOTIFY_TEMPLATE_PLACEHOLDER}.
 */
function notifyTemplateRefusals(key: 'title' | 'message'): TypedExpressionRefusals {
  const write =
    `Write \`'${NOTIFY_TEMPLATE_PLACEHOLDER}'\` or \`{ dialect: 'template', source: '${NOTIFY_TEMPLATE_PLACEHOLDER}' }\`: `
    + NOTIFY_TEMPLATE_RENDERER;
  return {
    sourceRequired:
      `A notify node's \`${key}\` needs a non-blank template: a bare string is shorthand for `
      + '`{ dialect: \'template\', source }`, and a blank one would normalize to an envelope with nothing to '
      + `interpolate. ${write}`,
    dialectOnly:
      `A notify node's \`${key}\` accepts a bare template string or an envelope declaring \`dialect: 'template'\` `
      + 'only: an envelope naming another dialect would validate and then have nothing to interpolate. '
      + write,
  };
}

/**
 * The refusal for a `title` / `message` template envelope that carries no
 * non-blank `source` — what the slot's executor renders. It names the key and
 * the fix, and prescribes the slot's own placeholder spelling
 * ({@link NOTIFY_TEMPLATE_PLACEHOLDER}).
 */
function notifyTemplateSourceRequired(key: 'title' | 'message'): string {
  const consequence = key === 'title'
    ? 'every run that reached this node would fail with no title to send'
    : 'the notification would go out with an empty body';
  return (
    `\`${key}\` is a template envelope with no non-blank \`source\`. The notify executor renders \`source\` — `
    + 'filling its `{{ }}` holes per run — and has nothing to render from `ast` alone or from a '
    + `blank \`source\`, so ${consequence}. Put the text in \`source\` `
    + `(\`{ dialect: 'template', source: 'Deal ${NOTIFY_TEMPLATE_PLACEHOLDER} won' }\`), or write it as a bare string.`
  );
}

// ─── notify value slots (#19939) ─────────────────────────────────────
//
// A notify node's computed values — `recipients`, the `templateData` and
// `payload` maps, `sourceObject`, `sourceId` and `actorId` — are VALUE slots
// (#19939, the C half of #11182 ruling D; ADR-0032 Decision 2, a computed
// value is whole-field CEL): a CEL value envelope the executor evaluates in the
// run's scope, or a literal written as it is. A single-brace `{…}` token of the
// retired template dialect is refused by the one value-slot judge
// (`valueSlotTemplateRefusals`), naming its CEL spelling. The two maps take
// `FlowValueSlotSchema` per key, like a screen's `defaults`; the three single
// values and `recipients` take the unions below, whose literal arm is
// narrower (a string, a list of strings), like `screen.recordId`'s, so the
// published JSON Schema and the inferred types keep it. Each union is built
// eagerly, like `FlowValueSlotSchema`: `.meta()` registers by identity, and its
// `xExpression: 'value'` marker is what the expression ledger's reconciliation
// ratchet reads (`LEDGER_DECLARED_NODE_CONFIG_SCHEMAS`).

/** The `{…}` token refusals of `text`, a literal string at `at` inside a notify value slot. */
function addTokenRefusals(ctx: z.RefinementCtx, text: string, at: readonly (string | number)[]): void {
  for (const refusal of valueSlotTemplateRefusals(text)) {
    ctx.addIssue({ code: 'custom', path: [...at, ...refusal.path], message: refusal.message });
  }
}

/** A malformed CEL value envelope's refusal — {@link VALUE_ENVELOPE_REFUSAL}, then each issue, located. */
function envelopeRefusal(value: unknown, at: string): string {
  const result = AssignmentExpressionValueSchema.safeParse(value);
  const details = result.success
    ? []
    : result.error.issues.map((i) => {
      const where = [at, ...i.path.map(String)].filter((segment) => segment !== '').join('.');
      return `${where ? `\`${where}\`: ` : ''}${i.message}`;
    });
  return [VALUE_ENVELOPE_REFUSAL, ...details].join(' ');
}

/** How a value that is not authorable in a notify value slot is named in its refusal. */
function notifyValuePhrase(value: unknown): string {
  if (value === null) return '`null`';
  if (Array.isArray(value)) return 'a list';
  if (typeof value === 'object') return 'an object';
  return `a ${typeof value}`;
}

/**
 * What `recipients` holds — the sentence every refusal of a value there that is
 * neither a recipient, a list of them nor a CEL value envelope leads with.
 */
const NOTIFY_RECIPIENTS_RULE =
  '`recipients` is who the notification goes to: a recipient — a user id, or an audience selector such as '
  + '`team:ID` — written as a string; a list of them, each a string or a CEL value envelope; or one CEL value '
  + 'envelope, `{ dialect: \'cel\', source: \'…\' }`, that evaluates to a recipient or a list of them.';

/** Why a `recipients` value the union refuses is refused — naming the list entry that is not one. */
function notifyRecipientsRefusal(input: unknown): string {
  if (Array.isArray(input)) {
    const index = input.findIndex((entry) => typeof entry !== 'string'
      && !(isExpressionEnvelopeShaped(entry) && AssignmentExpressionValueSchema.safeParse(entry).success));
    const entry = input[index];
    if (isExpressionEnvelopeShaped(entry)) return envelopeRefusal(entry, `[${index}]`);
    return `${NOTIFY_RECIPIENTS_RULE} The entry at \`[${index}]\` is ${notifyValuePhrase(entry)}: a list entry is a `
      + 'recipient string or an envelope.';
  }
  if (isExpressionEnvelopeShaped(input)) return envelopeRefusal(input, '');
  return `${NOTIFY_RECIPIENTS_RULE} This one is ${notifyValuePhrase(input)}.`;
}

/**
 * `notify.recipients` — who the notification goes to, a `value` slot that holds
 * one value OR a list of them (#19939; the ledger's `eachElement`):
 *
 *  - a **string** is one recipient as written — a user id, or an audience
 *    selector the messaging service resolves (`team:ID`, an email address);
 *  - a **list** holds one entry per recipient, each a string as written or a
 *    CEL value envelope evaluated per run — an entry that evaluates to a list
 *    (a multi-user field, a list variable) adds EACH of its recipients, so a
 *    list is never handed on as one joined recipient;
 *  - a **CEL value envelope** ({@link AssignmentExpressionValueSchema}) is
 *    evaluated per run to a recipient or a list of them.
 *
 * An envelope that evaluates to `null` or a blank string adds no recipient,
 * as a token that resolved to nothing did, and the executor's guard still
 * fails a node left with none, naming the sources that evaluated to nothing
 * (framework#3582); anything else that is not a string, or a list of them,
 * fails the node, naming what it evaluated to. A `{…}` token in a string is
 * refused by the one value-slot judge, with the envelope that replaces it.
 */
const NotifyRecipientsSlotSchema = z.union([
  z.string(),
  z.array(z.union([z.string(), AssignmentExpressionValueSchema])),
  AssignmentExpressionValueSchema,
], {
  error: (issue) => notifyRecipientsRefusal((issue as { input?: unknown }).input),
})
  .superRefine((value, ctx) => {
    if (typeof value === 'string') addTokenRefusals(ctx, value, []);
    else if (Array.isArray(value)) {
      value.forEach((entry, index) => {
        if (typeof entry === 'string') addTokenRefusals(ctx, entry, [index]);
      });
    }
  })
  .meta({
    description:
      'Who the notification goes to: a recipient (a user id, or an audience selector such as `team:ID`) as a '
      + 'string; a list of them, each a string or a CEL value envelope `{ dialect: \'cel\', source }` evaluated per '
      + 'run (an entry that evaluates to a list adds each of its recipients); or one envelope evaluating to a '
      + 'recipient or a list — a `{…}` template token is refused',
    xExpression: 'value',
  });

/**
 * A notify value slot holding ONE string — `sourceObject`, `sourceId`,
 * `actorId` (#19939): the string as written, or a CEL value envelope the
 * executor evaluates per run to a string. An envelope that evaluates to `null`
 * or a blank string leaves the key unset, as a token that resolved to nothing
 * did; anything else that is not a string fails the node, naming what it
 * evaluated to. A `{…}` token in the string is refused by the one value-slot
 * judge.
 */
function notifyStringSlotSchema(key: string, what: string, example: string, description: string) {
  const rule =
    `\`${key}\` is ${what}: write it as a string, or compute it with a CEL value envelope that evaluates to one, `
    + `\`{ dialect: 'cel', source: '${example}' }\`.`;
  return z.union([z.string(), AssignmentExpressionValueSchema], {
    error: (issue) => {
      const input = (issue as { input?: unknown }).input;
      if (isExpressionEnvelopeShaped(input)) return envelopeRefusal(input, '');
      return `${rule} This one is ${notifyValuePhrase(input)}.`;
    },
  })
    .superRefine((value, ctx) => {
      if (typeof value === 'string') addTokenRefusals(ctx, value, []);
    })
    .meta({ description, xExpression: 'value' });
}

const NotifySourceObjectSlotSchema = notifyStringSlotSchema(
  'sourceObject',
  'the name of the object the notification links to',
  'targetObject',
  'Object name of the record the notification links to — a string, or a CEL value envelope `{ dialect: \'cel\', '
    + 'source }` evaluated per run to one; a `{…}` template token is refused',
);

const NotifySourceIdSlotSchema = notifyStringSlotSchema(
  'sourceId',
  'the id of the record the notification links to',
  'record.id',
  'Id of the record the notification links to — a string, or a CEL value envelope `{ dialect: \'cel\', source }` '
    + 'evaluated per run to one; a `{…}` template token is refused',
);

const NotifyActorIdSlotSchema = notifyStringSlotSchema(
  'actorId',
  'the id of the user who caused the event',
  'current_user.id',
  'User id that caused the event — a string, or a CEL value envelope `{ dialect: \'cel\', source }` evaluated per '
    + 'run to one; a `{…}` template token is refused',
);

// ─── notify ──────────────────────────────────────────────────────────

/**
 * `notify` node config — what the executor reads (ADR-0012 outbound
 * notification via the `messaging` service).
 *
 * Executor semantics worth knowing beyond the key set:
 *
 *  - `recipients` is **required at execute time** (the step fails without it),
 *    and the node needs ONE content source: inline `title` (+ optional
 *    `message`), or a `template` reference (#9205). The descriptor's form
 *    deliberately publishes no `required` array — see the comment on the
 *    `configSchema` literal — so requiredness lives here and in the
 *    execute-time guard, not in the form.
 *  - **Localization contract (#9205, ruled 「走 emailTemplates 路线」):**
 *    `template` names a `sys_email_template` bundle
 *    (`EmailTemplateDefinitionSchema`, `system/email-template.zod.ts`), and the
 *    delivery path resolves `(name, locale)` at delivery time via
 *    `IEmailService.sendTemplate({ template, locale })`.
 *
 *    That `locale` is resolved **per recipient, after fan-out** — declared
 *    here exactly as the delivery path enforces it
 *    (`service-messaging/src/recipient-locale.ts`, the one read point every
 *    channel resolves through). The chain is the recipient's own
 *    `sys_user.locale` → the **deployment default**,
 *    `II18nService.getDefaultLocale()` (the same ruled source the auth emails
 *    read as their deployment rung, #8195). A recipient whose column is
 *    absent, empty or malformed always falls back to the deployment default;
 *    no value ever dead-letters a delivery. Maintainer ruling **2026-09-01**
 *    (#13881), which lifted the 2026-08-13 deferral once hotcrm measured the
 *    pull (4 published languages × 16 notify nodes × 0 localizable). The
 *    pre-ruling single value — `payload.locale`, interpolated once before
 *    fan-out — is no longer consulted. Request-scoped locale
 *    (`Accept-Language` → `ExecutionContext.requestLocale`) still does not
 *    exist at async delivery time and is not part of this chain. So two
 *    recipients with different `sys_user.locale` values DO receive different
 *    rows of the same bundle.
 *    Inline `title`/`message` are the NON-localizable path — one text for
 *    every recipient, interpolated per run (below), never translated. The two
 *    paths are mutually exclusive on one node (see the `superRefine` below):
 *    runtime precedence would silently ignore one of them, so the ambiguous
 *    combination is unrepresentable instead — the same posture as
 *    `objectNavTargetExclusivity` (`ui/app.zod.ts`).
 *  - `title`, `message` and (since #19939) `actionUrl` are TEXT slots: they
 *    render through the formula template engine, so `{{ record.x }}` holes are
 *    legal in them (below). `recipients`, `sourceObject`, `sourceId`,
 *    `actorId` and the VALUES of `templateData` and `payload` are VALUE slots
 *    (#19939): a CEL value envelope the executor evaluates per run, or a
 *    literal written as it is — until #19939 each passed through the flow's
 *    single-brace `interpolate()`, and a `{record.x}` token in one is refused
 *    now, naming its CEL spelling. `channels`, `topic`, `severity` and
 *    `template` are read RAW — a `{token}` in those is forwarded verbatim,
 *    never resolved (channel ids are static routing, `severity` is a closed
 *    vocabulary, and `template` is a static metadata cross-reference, not
 *    per-record data). Re-measured against `notify-node.ts` for #7086: the
 *    previous wording ("every string-ish value except `channels`") was stale
 *    for `topic` and `severity`, and it is what makes closing the `severity`
 *    gate below safe.
 *  - `title` and `message` are TEMPLATE slots, taking the same input as every
 *    other `template` slot in the dialect table (`shared/expression.zod.ts`):
 *    a bare string, or a `{ dialect: 'template', source }` envelope — what the
 *    `tmpl` helper builds. The parse normalizes the bare string to that
 *    envelope, so the executor reads one shape and interpolates its `source`;
 *    both spellings of one text render the same notification. Since protocol
 *    18 (#22110, ADR-0032 D3) the renderer is the formula template engine,
 *    so the placeholder spelling is a `{{ }}` hole — a variable path with an
 *    optional formatter (`{{ record.name }}`, `{{ amount | currency }}`). A
 *    single-brace `{token}` is no placeholder any more and is refused by the
 *    `superRefine` below, through the one text-slot judge
 *    (`flow-text-slot-template.ts`), with the hole spelling of each token.
 *    The input is built with `templateExpressionInput` (the package-internal
 *    constructor of `TemplateExpressionInputSchema`) so its refusals name the
 *    slot; they prescribe {@link NOTIFY_TEMPLATE_PLACEHOLDER}.
 *    An envelope must carry a non-blank `source` (the `superRefine` below) —
 *    the executor renders `source` and has nothing to render from `ast` alone,
 *    which the shared schema's envelope arm would otherwise admit.
 *  - `sourceObject`/`sourceId` only take effect as a PAIR — a half-specified
 *    click-through target is dropped so the inbox never renders a dead link.
 *    The schema keeps both optional rather than refining, because the executor
 *    tolerates (drops) the half-specified shape rather than rejecting it.
 *  - The historical aliases (`to`/`subject`/`body`/`url`, nested
 *    `source: { object, id }`) are NOT part of this contract: the ADR-0087 D2
 *    conversion `flow-node-notify-config-aliases` rewrites them at load, so the
 *    executor only ever sees the canonical keys below (#3796, #4045).
 */
export const NotifyConfigSchema = lazySchema(() => strictObject({
  surface: 'this notify node config',
  history: IO_NODE_CONFIG_HISTORY,
  guidance: NOTIFY_KEY_GUIDANCE,
}, {
  /**
   * Who gets the notification — a `value` slot holding one value or a list of
   * them (#19939, {@link NotifyRecipientsSlotSchema}).
   */
  recipients: NotifyRecipientsSlotSchema
    .describe(
      'Who the notification goes to: a recipient (a user id, or an audience selector such as `team:ID`) as a '
      + 'string; a list of them, each a string or a CEL value envelope `{ dialect: \'cel\', source }` evaluated per '
      + 'run — an entry that evaluates to a list adds each of its recipients, and one that evaluates to null adds '
      + 'none; or one envelope evaluating to a recipient or a list. A `{…}` template token is refused.',
    ),
  /**
   * Inline notification title — the NON-localizable content path, and a
   * template slot (see the docblock above). Required unless `template` is set
   * (the superRefine below owes one of the two).
   */
  title: templateExpressionInput(ExpressionSchema, notifyTemplateRefusals('title')).optional()
    .describe('Notification title — a template: a bare string, or a `{ dialect: \'template\', source }` envelope (the `tmpl` helper) carrying the same text. It is rendered per run with `{{ }}` holes over the flow\'s variables — a variable path with an optional formatter (`{{ record.name }}`, `{{ record.amount | currency }}`); a single-brace `{token}` is refused. One text for every recipient (not localizable — use `template` for per-locale content). Either this or `template` is required; the two are mutually exclusive.'),
  /** Notification body (inline path only) — the same template input as `title`. */
  message: templateExpressionInput(ExpressionSchema, notifyTemplateRefusals('message')).optional()
    .describe('Notification body — the same template input as `title` (a bare string or a `{ dialect: \'template\', source }` envelope), rendered per run with `{{ }}` holes like `title`; not localizable. Only valid with inline `title`, never with `template`.'),
  /**
   * The localizable content path (#9205): name of a `sys_email_template`
   * bundle. Resolved by `(name, locale)` AT DELIVERY TIME —
   * `IEmailService.sendTemplate({ template, locale })` picks that locale's row
   * with the documented en-US fallback ladder.
   *
   * The `locale` is resolved PER RECIPIENT, after fan-out (maintainer ruling
   * 2026-09-01, #13881): the recipient's own `sys_user.locale` when set, else
   * the DEPLOYMENT DEFAULT — `II18nService.getDefaultLocale()`. A missing,
   * empty or malformed recipient value always falls back; it never reaches
   * the template lookup. A producer-set `payload.locale` is NOT consulted —
   * it was the pre-ruling single value for the whole notification, and that
   * shape is what the ruling retired.
   *
   * Read RAW like `topic`/`channels`: a static metadata cross-reference, never
   * interpolated. Mutually exclusive with inline `title`/`message`.
   *
   * The describe below is form help an author reads: it states the behaviour
   * and carries neither the service interface nor the ruling date — both live
   * in this comment only (#22093).
   */
  template: z.string().optional()
    .describe('Email template name (`sys_email_template.name`, e.g. `crm.large_deal_won`) — the localizable content path: the delivery path resolves `(name, locale)` against sys_email_template at delivery time and renders subject/body from that row. The locale is resolved per recipient, after fan-out: the recipient\'s own `sys_user.locale` when set, else the deployment default locale — so recipients whose personal languages differ receive different rows of the same bundle. The node\'s `payload.locale` is not consulted. Mutually exclusive with inline `title`/`message`, which are the non-localizable path. Read raw — no `{token}` interpolation.'),
  /**
   * Render context for the referenced template's `{{var}}` holes — a `value`
   * slot per key (#19939, {@link FlowValueSlotSchema}): a CEL value envelope
   * evaluated per run, so flow state can feed the template, or a literal. Only
   * meaningful with `template` — refused without it.
   */
  templateData: z.record(z.string(), FlowValueSlotSchema).optional()
    .describe('Render context for the referenced template\'s `{{var}}` placeholders — each value a CEL value envelope `{ dialect: \'cel\', source }` evaluated per run, or a literal written as it is; a `{…}` template token is refused. Only valid together with `template`.'),
  /** Channels to fan out to (default: inbox). Read raw — no template interpolation. */
  channels: z.union([z.string(), z.array(z.string())]).optional()
    .describe('Channels to fan out to (default: inbox)'),
  /** Event topic handed to the messaging service (default: "notify"). */
  topic: z.string().optional().describe('Event topic (default: "notify")'),
  /**
   * Severity forwarded to the messaging service — a CLOSED vocabulary (#7086).
   *
   * Was a bare `z.string()` whose `.describe()` read `'info | warning | critical'`,
   * so the enumeration existed only in the sentence: `'urgent'`, `'INFO'` and `''`
   * all parsed green, then rode the dispatcher's blind cast
   * (`severity: (p.severity as Notification['severity']) ?? 'info'`) into
   * `sys_inbox_message.severity` under a TypeScript union that says those values
   * cannot exist — every downstream `switch` on the three names fell through.
   * The gate is the last surface that was open: the describe, the
   * `Notification['severity']` type, and the `sys_inbox_message.severity` select
   * field all already declared exactly these three.
   *
   * Safe to close because the executor reads this key RAW — see the
   * interpolation note above — so a `{token}` template here never resolved and
   * a rejection removes no working authoring shape.
   */
  severity: z.enum(['info', 'warning', 'critical']).optional()
    .describe('Severity forwarded to the messaging service'),
  /**
   * Click-through target object — only effective together with `sourceId`
   * (#2675). A `value` slot (#19939, {@link NotifySourceObjectSlotSchema}).
   */
  sourceObject: NotifySourceObjectSlotSchema.optional()
    .describe('Object name of the record the notification links to (writes sys_notification.source_object) — a string, or a CEL value envelope `{ dialect: \'cel\', source }` evaluated per run to one; a `{…}` template token is refused. Only takes effect together with sourceId — a half-specified click-through target is dropped at execute time, so the inbox never renders a dead link.'),
  /**
   * Click-through target record id — only effective together with
   * `sourceObject`. A `value` slot (#19939, {@link NotifySourceIdSlotSchema}).
   */
  sourceId: NotifySourceIdSlotSchema.optional()
    .describe('Record id the notification links to (writes sys_notification.source_id) — a string, or a CEL value envelope `{ dialect: \'cel\', source }` evaluated per run to one (`record.id`); a `{…}` template token is refused. Only takes effect together with sourceObject — a half-specified click-through target is dropped at execute time, so the inbox never renders a dead link.'),
  /** User id that caused the event. A `value` slot (#19939, {@link NotifyActorIdSlotSchema}). */
  actorId: NotifyActorIdSlotSchema.optional()
    .describe('User id that caused the event (writes sys_notification.actor_id) — a string, or a CEL value envelope `{ dialect: \'cel\', source }` evaluated per run to one (`current_user.id`); a `{…}` template token is refused'),
  /**
   * Explicit click-through URL; overrides the sourceObject/sourceId link. A
   * TEXT slot (#19939): rendered per run with `{{ }}` holes, like `title`; a
   * single-brace `{token}` is refused by the `superRefine` below.
   */
  actionUrl: z.string().optional()
    .describe('Explicit click-through URL, rendered per run with `{{ }}` holes like `title` (`/crm_case/{{ record.id }}`); a single-brace `{token}` is refused. Overrides the link synthesized from sourceObject/sourceId.'),
  /**
   * Extra values merged into the notification payload — a `value` slot per key
   * (#19939, {@link FlowValueSlotSchema}).
   */
  payload: z.record(z.string(), FlowValueSlotSchema).optional()
    .describe('Extra values merged into the notification payload — each a CEL value envelope `{ dialect: \'cel\', source }` evaluated per run, or a literal written as it is; a `{…}` template token is refused'),
}).superRefine((cfg, ctx) => {
  // #9205 — correct-by-construction (the `objectNavTargetExclusivity`
  // posture, ui/app.zod.ts): `template` combined with inline `title`/`message`
  // is an authoring ambiguity — the delivery path would have to silently pick
  // which content wins, per channel, and whichever loses would look exactly
  // like a delivered notification. Reject at the gate with the fix in the
  // message instead of resolving by precedence.
  //
  // These checks run only on a structurally valid config (zod skips object
  // -level refinements once a property has failed — probed on zod 4.4.3 for
  // ui/action.zod.ts), which is fine: each names keys, not values.
  if (cfg.template !== undefined && (cfg.title !== undefined || cfg.message !== undefined)) {
    ctx.addIssue({
      code: 'custom',
      path: ['template'],
      message:
        '`template` cannot be combined with inline `title`/`message` — pick ONE content path: '
        + '`template` (localizable: resolves `(name, locale)` from sys_email_template at delivery, the locale being '
        + 'each recipient\'s own `sys_user.locale` or the deployment default — resolved per recipient, after fan-out) '
        + 'or inline `title` + `message` (one text for every recipient, not localizable). To localize, keep `template`, move '
        + 'the text into the template bundle\'s rows, and delete `title`/`message`; runtime precedence would '
        + 'silently ignore one of them.',
    });
  }
  if (cfg.templateData !== undefined && cfg.template === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['templateData'],
      message:
        '`templateData` is the render context for a `template` reference, and this node names no `template` — '
        + 'nothing would ever read it. Add the `template` it feeds, or delete `templateData`.',
    });
  }
  if (cfg.template === undefined && cfg.title === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['title'],
      message:
        'A notify node needs one content source: inline `title` (+ optional `message`), or a `template` '
        + 'reference resolving a sys_email_template bundle at delivery in each recipient\'s locale '
        + '(the recipient\'s own `sys_user.locale` or the deployment default — resolved per recipient, after fan-out). '
        + 'Neither was given, so there is nothing to deliver.',
    });
  }
  // The two template slots render `source` (see the docblock): the executor
  // renders it per run and has no renderer for `ast`. The shared template
  // input (`templateExpressionInput`) is the persistence contract, so its
  // envelope arm admits an `ast`-only envelope and a whitespace `source` —
  // shapes that parse and then render nothing (a `title` failing every run, a
  // `message` going out empty). The slot states what its executor needs
  // instead, in the same notion of blank as the bare-string arm. Reached only
  // once both values parsed, so `source` is read off a template envelope.
  //
  // [#22110] And the text it carries is a `{{ }}` template: a single-brace
  // `{token}` left from the 17.x dialect would go out as literal text, so it
  // is refused here — the same judge, and the same words, as `registerFlow`
  // and `objectstack validate` (`flow-text-slot-template.ts`).
  for (const key of ['title', 'message'] as const) {
    const value = cfg[key];
    if (value === undefined) continue;
    if (!(typeof value.source === 'string' && NON_BLANK_STRING(value.source))) {
      ctx.addIssue({ code: 'custom', path: [key], message: notifyTemplateSourceRequired(key) });
      continue;
    }
    const refusal = textSlotTemplateRefusal(value.source);
    if (refusal !== undefined) ctx.addIssue({ code: 'custom', path: [key], message: refusal });
  }
  // [#19939] `actionUrl` is a text slot too — a link with `{{ }}` holes
  // (`/crm_case/{{ record.id }}`), rendered by the same engine; a single-brace
  // token left from the 17.x dialect would go out as a literal link, so it is
  // refused by the same judge, in the same words.
  if (typeof cfg.actionUrl === 'string') {
    const refusal = textSlotTemplateRefusal(cfg.actionUrl);
    if (refusal !== undefined) ctx.addIssue({ code: 'custom', path: ['actionUrl'], message: refusal });
  }
}));

export type NotifyConfig = z.input<typeof NotifyConfigSchema>;
export type NotifyConfigParsed = z.infer<typeof NotifyConfigSchema>;

// ─── http ────────────────────────────────────────────────────────────

/**
 * `http` node config — what the executor reads (ADR-0018 M3 outbound callout).
 *
 * Executor semantics worth knowing beyond the key set:
 *
 *  - `url` is **required at execute time** (the step is refused without it) —
 *    the one key the descriptor's form also marks `required`.
 *  - The whole config is `interpolate()`d before reading, so every value may
 *    carry `{token}` templates.
 *  - `method` defaults per mode — GET inline, POST durable — which is why the
 *    schema declares no static `.default()`.
 *  - `durable: true` routes through the messaging HTTP outbox
 *    (retry / dead-letter) and returns `{ deliveryId }` instead of the
 *    response; without an outbox it degrades to the inline call.
 */
export const HttpConfigSchema = lazySchema(() => strictObject({
  surface: 'this http node config',
  history: IO_NODE_CONFIG_HISTORY,
  // No curated table: `http` has no retired spelling and no cross-surface
  // near-miss this campaign's payload scan could attest. The two plausible
  // typos are already reachable by edit distance (`timeout` → `timeoutMs`,
  // `header` → `headers`), and inventing entries nothing refutes is how this
  // campaign shipped four confidently-wrong prescriptions in one batch.
}, {
  /** Target URL (execute-time required). */
  url: z.string().describe('Target URL'),
  /**
   * HTTP method — default GET inline, POST when durable.
   *
   * ⛔ **No `.default()`, and that is the measured answer, not an omission.**
   * The executor applies TWO values for an absent key, decided by `durable`:
   * run with `config: { url }` it calls `fetch` with `GET`; run with
   * `config: { url, durable: true }` against a ready outbox it enqueues `POST`
   * (`http-nodes.ts`: `method: cfg.method ?? 'POST'` on the durable arm,
   * `const method = cfg.method ?? 'GET'` on the inline one). A static
   * `.default('GET')` would materialise `GET` at parse time, the durable arm's
   * `??` would never fire again, and every stored durable callout that omits
   * the method would silently change from POST to GET — a protocol-declared
   * default the runtime does not apply, which is precisely the defect the
   * maintainer's ruling on defaults (decision batch #127 item 5) forbids.
   * Contrast `ScreenConfigSchema.mode` in `builtin-node-config.zod.ts`, where
   * one value IS applied and is therefore declared.
   */
  method: z.string().optional().describe('HTTP method (default GET; POST when durable)'),
  /**
   * Request headers.
   *
   * An open map, so it is served as authored: a flow definition is readable by
   * every member who can read flows, and nothing here is withheld. An outbound
   * header credential therefore never goes in this map — it goes to a
   * declarative connector whose `auth` is `bearer` or a header `api-key`, with
   * `auth.credentialRef` naming the secret (ADR-0097 §3), called from a
   * `connector_action` node. `@objectstack/lint`'s `flow-credential-literal`
   * advisory names a literal that reads as one.
   */
  headers: z.record(z.string(), z.string()).optional().describe(
    'Request headers. The flow definition, this map included, is served to every member who can read flows, so '
      + 'never put a credential here: declare a connector whose `auth` is `bearer` or `api-key` (a header), with '
      + '`auth.credentialRef` naming the secret, and call it from a `connector_action` node.',
  ),
  /** Request body — JSON-serialised before sending. */
  body: z.unknown().optional().describe('Request body (JSON-serialised)'),
  /** Fire-and-forget via the durable outbox instead of inline request/response. */
  durable: z.boolean().optional()
    .describe('Fire-and-forget via the durable outbox (retry/dead-letter) instead of inline request/response'),
  /** Per-request timeout in milliseconds (both modes). */
  timeoutMs: z.number().optional().describe('Per-request timeout (ms)'),
  /** HMAC-SHA256 signing secret → X-Objectstack-Signature. */
  signingSecret: z.string().optional().describe('HMAC-SHA256 secret → X-Objectstack-Signature'),
}));

export type HttpConfig = z.input<typeof HttpConfigSchema>;
export type HttpConfigParsed = z.infer<typeof HttpConfigSchema>;
