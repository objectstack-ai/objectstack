// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `notify` / `http` config contracts — the #4001 批 9 closure (#4045, #4277).
 *
 * These are LIVE execute-time contracts (`parse-config.ts`), so what is pinned
 * here is behaviour: a shape accepted runs, a shape rejected refuses the node
 * as a guard. Before this batch an undeclared key was deleted in silence at
 * this seam and the step reported success without it.
 *
 * The `guidance` assertions are the load-bearing half. This campaign's finding
 * 7 is that a rejection's PROSE is behaviour — it tells the author what to do
 * next, and a confidently wrong prescription is worse than none, because the
 * author has no reason to doubt it. Every entry asserted below was measured
 * against real payloads in the repo before it was written.
 */

import { describe, expect, it } from 'vitest';

import { HttpConfigSchema, NotifyConfigSchema } from './io-node-config.zod.js';
import { flowNodeConfigRefusals } from './flow-node-config-refusals.js';
import {
  TYPED_EXPRESSION_DIALECT_ONLY,
  TYPED_EXPRESSION_SOURCE_REQUIRED,
  tmpl,
} from '../shared/expression.zod.js';

/** The unknown-key message, or `undefined` when the shape was accepted. */
function unknownKeyMessage(schema: { safeParse(v: unknown): { success: boolean; error?: { issues: ReadonlyArray<{ code: string; message: string }> } } }, value: unknown): string | undefined {
  const result = schema.safeParse(value);
  if (result.success) return undefined;
  return result.error!.issues.find((i) => i.code === 'unrecognized_keys')?.message;
}

describe('NotifyConfigSchema — an unknown key is refused, not stripped', () => {
  // Since #9205 the declared keys split into TWO content paths that cannot
  // coexist on one node (see the mutual-exclusion pins below), so "accepts
  // every declared key" is two configs: the inline path carries every key
  // except `template`/`templateData`; the template path carries those two in
  // place of `title`/`message`.
  it('accepts every declared key (inline content path — unchanged by the template path)', () => {
    const full = {
      recipients: ['{record.assignee}'],
      title: 'New task',
      message: 'You have been assigned a task.',
      channels: ['inbox'],
      topic: 'notify',
      severity: 'info',
      sourceObject: 'showcase_task',
      sourceId: '{record.id}',
      actorId: '{trigger.userId}',
      actionUrl: '/task/{record.id}',
      payload: { taskName: '{record.name}' },
    };
    // Every key survives the parse; `title`/`message` are template slots, so
    // their bare strings come back as the `{ dialect: 'template', source }`
    // envelope the slot normalizes to (pinned on its own below).
    expect(NotifyConfigSchema.parse(full)).toEqual({
      ...full,
      title: { dialect: 'template', source: 'New task' },
      message: { dialect: 'template', source: 'You have been assigned a task.' },
    });
  });

  it('accepts every declared key (template content path)', () => {
    const full = {
      recipients: ['{record.assignee}'],
      template: 'crm.large_deal_won',
      templateData: { dealName: '{record.name}', amount: '{record.amount}' },
      channels: ['inbox', 'email'],
      topic: 'notify',
      severity: 'info',
      sourceObject: 'showcase_task',
      sourceId: '{record.id}',
      actorId: '{trigger.userId}',
      actionUrl: '/task/{record.id}',
      payload: { taskName: '{record.name}' },
    };
    expect(NotifyConfigSchema.parse(full)).toEqual(full);
  });

  it('rejects an undeclared key instead of dropping it', () => {
    // The pre-批-9 behaviour, stated as the thing that is no longer true:
    // this parsed clean and the notification went out without a click target.
    const message = unknownKeyMessage(NotifyConfigSchema, {
      recipients: ['u1'], title: 'hi', sourceObjectt: 'showcase_task',
    });
    expect(message).toContain('this notify node config');
    expect(message).toContain('`sourceObjectt`');
    // A one-character typo IS reachable by edit distance, so the suggestion
    // must fire — this is the cheap half the curated table does not cover.
    expect(message).toContain('`sourceObjectt` → `sourceObject`');
  });

  it.each([
    ['to', ['u1'], '`recipients`'],
    ['subject', 'New task', '`title`'],
    ['body', 'Body text', '`message`'],
    ['url', '/task/1', '`actionUrl`'],
    ['source', { object: 'showcase_task', id: '1' }, '`sourceObject` + `sourceId`'],
  ] as ReadonlyArray<[string, unknown, string]>)(
    'names the canonical key AND the disagreeing-pair case for the retired `%s` alias',
    (key, value, canonical) => {
      const message = unknownKeyMessage(NotifyConfigSchema, {
        recipients: ['u1'], title: 'hi', [key]: value,
      });
      expect(message).toContain(canonical);
      // Both readings must be served: the ADR-0087 conversion rewrites this
      // key at load, so a config that still carries it at PARSE time also
      // carries the canonical key — and since #4923 it carries one holding a
      // DIFFERENT value, because an identical twin is deleted by the
      // conversion. Without this half the prescription ("rename it") is wrong
      // for the population that actually reaches this error.
      expect(message).toContain('flow-node-notify-config-aliases');
      expect(message).toMatch(/delete|reconcile/i);
      // The reconciliation reading has to name the OTHER key too, or the
      // author cannot see which two spellings disagree.
      expect(message).toMatch(/DIFFERENT|differ/i);
    },
  );

  it('lists every violated key in one refusal', () => {
    const message = unknownKeyMessage(NotifyConfigSchema, {
      recipients: ['u1'], title: 'hi', to: ['u2'], subject: 'x',
    });
    expect(message).toContain('`to`');
    expect(message).toContain('`subject`');
  });

  it('never suggests a key the schema does not accept (finding 12)', () => {
    const message = unknownKeyMessage(NotifyConfigSchema, {
      recipients: ['u1'], title: 'hi', nonsense: 1,
    })!;
    const suggested = [...message.matchAll(/→ `([^`]+)`/g)].map((m) => m[1]!);
    for (const key of suggested) {
      expect(NotifyConfigSchema.safeParse({ recipients: ['u1'], title: 'hi', [key]: 'x' })
        .error?.issues.some((i) => i.code === 'unrecognized_keys')).not.toBe(true);
    }
  });

  it('sourceObject/sourceId describes state the documented pair tolerance, not a phantom requirement', () => {
    const shape = (NotifyConfigSchema as unknown as { shape: Record<string, { description?: string }> }).shape;
    for (const [key, partner] of [
      ['sourceObject', 'sourceId'],
      ['sourceId', 'sourceObject'],
    ] as const) {
      const doc = shape[key]!.description ?? '';

      // Non-empty arm FIRST — the negative arm below passes vacuously on ''
      // (the #6918 demonstration), so this arm is what gives it teeth.
      expect(doc.length, `${key} .describe() must not be empty`).toBeGreaterThan(0);

      // Substance, by idiom borrowed from the module JSDoc (#6881 — no third
      // spelling): the pair only takes effect together, and a half-specified
      // click-through target is DROPPED at execute time rather than rejected
      // at the gate.
      expect(doc).toMatch(/only takes effect together/i);
      expect(doc).toContain(partner);
      expect(doc).toMatch(/dropped at execute time/i);

      // The #7085 defect: "Requires <partner>." read as gate-enforced
      // requiredness, while the schema deliberately keeps both keys optional
      // (module JSDoc: the executor tolerates/drops the half pair). The
      // phantom-requirement wording must not return in any casing or tense.
      expect(doc).not.toMatch(/\brequire[sd]?\b/i);
    }

    // The tolerance the describes now document, proven live on the same
    // schema — this is the acceptance face this change must NOT move: each
    // half pair still parses green.
    expect(NotifyConfigSchema.safeParse({ recipients: 'u1', title: 't', sourceObject: 'showcase_task' }).success).toBe(true);
    expect(NotifyConfigSchema.safeParse({ recipients: 'u1', title: 't', sourceId: 'r1' }).success).toBe(true);
  });

  // ── #7086 — severity is a CLOSED vocabulary, at the gate and not only in prose ──
  //
  // Until this change `severity` was a bare `z.string()` whose `.describe()`
  // read `'info | warning | critical'`. The enumeration lived only in the
  // sentence, so `'urgent'` parsed green here, was forwarded raw by the
  // executor, and was blind-cast by the dispatcher
  // (`(p.severity as Notification['severity']) ?? 'info'`) into a union that
  // declares those values impossible — silently falling through every
  // downstream `switch`. The three surfaces that already agreed on the closed
  // set: this describe, `Notification['severity']`, and the
  // `sys_inbox_message.severity` select field.
  describe('severity — the closed info | warning | critical vocabulary', () => {
    /** The `severity` issues of a failed parse, or `[]` when it was accepted. */
    function severityIssues(value: unknown): ReadonlyArray<{ code: string; message: string }> {
      const result = NotifyConfigSchema.safeParse({ recipients: 'u1', title: 't', severity: value });
      if (result.success) return [];
      return result.error.issues.filter((i) => i.path.length === 1 && i.path[0] === 'severity');
    }

    // Green BOTH before and after this change — pre-fix everything parsed, so
    // these prove nothing about the tightening. Stated plainly because the
    // template presumes before-green/after-red: their real job is the opposite
    // direction, that closing the gate did not OVERSHOOT and take a legal
    // spelling with it.
    it.each(['info', 'warning', 'critical'])('accepts the declared value %s', (value) => {
      expect(NotifyConfigSchema.safeParse({ recipients: 'u1', title: 't', severity: value }).success).toBe(true);
    });

    // The pins that carry the change. Measured RED on `origin/main` before the
    // fix — all three parsed green there (probe on 3e8e669c0).
    //
    // `code` + `path`, never a bare `success === false`: a strictObject rejects
    // for several reasons, so an assertion that only asks "did it fail" would
    // stay green if the refusal ever came from an unknown key instead of the
    // vocabulary — the two defects this file has to keep apart.
    it.each([
      ['urgent', 'an out-of-vocabulary spelling'],
      ['INFO', 'a casing variant — the vocabulary is lower-case'],
      ['', 'the empty string, which used to degrade to `info` two layers down'],
    ])('rejects %s (%s)', (value) => {
      const issues = severityIssues(value);
      expect(issues.map((i) => i.code)).toEqual(['invalid_value']);
      // The prescription is behaviour (this file's stated load-bearing half):
      // the refusal has to tell the author what IS legal, or an AI author who
      // guessed `urgent` has nothing to correct towards (ADR-0033).
      for (const legal of ['info', 'warning', 'critical']) {
        expect(issues[0]!.message).toContain(legal);
      }
    });

    it('declares the vocabulary in the TYPE, not only in the sentence', () => {
      const shape = (NotifyConfigSchema as unknown as {
        shape: Record<string, { description?: string; unwrap(): { options?: readonly string[] } }>;
      }).shape;

      // The gate itself carries the closed set — this is what `'urgent'`
      // now collides with, and what the generated reference renders as the
      // `Enum<...>` type column instead of a free-text `string`.
      expect(shape.severity!.unwrap().options).toEqual(['info', 'warning', 'critical']);

      // …and the describe is now a sentence about the field rather than a
      // bare value list standing in for a gate that did not exist. Non-empty
      // arm first, so the negative arm below cannot pass vacuously (#6918).
      const doc = shape.severity!.description ?? '';
      expect(doc.length, 'severity .describe() must not be empty').toBeGreaterThan(0);
      expect(doc).toMatch(/messaging service/i);
      expect(doc, 'the vocabulary belongs in the enum, not smuggled back into prose').not.toMatch(/\|/);
    });
  });

  // ── #9205 — the localizable content path: `template` + `templateData` ──
  //
  // Ruled 「立项，走 emailTemplates 路线」: a notify node references a
  // `sys_email_template` bundle by name and the delivery path resolves
  // `(name, locale)` at delivery time. Inline `title`/`message`
  // stay fully valid (the acceptance faces above) as the non-localizable
  // path; the two paths are mutually exclusive — loud refusal over silent
  // precedence, following `objectNavTargetExclusivity` (ui/app.zod.ts).
  //
  // The `locale` half of that pair is pinned below to the PER-RECIPIENT chain
  // the delivery path enforces since #13881 (maintainer ruling 2026-09-01):
  // the recipient's own `sys_user.locale`, else the deployment default.
  // Until that ruling these strings pinned the OPPOSITE — one value for the
  // whole notification (`payload.locale`, interpolated once before fan-out,
  // else the deployment default), because the 2026-08-13 ruling had deferred
  // a per-user locale until measured pull. The assertions pin the substance
  // of the chain, both rungs named, and REFUSE the retired single-value
  // wording: a future edit that says "one value for the whole notification"
  // or "not one per recipient" again turns these RED, because the wording an
  // author reads is the whole contract here — declared must equal enforced.
  describe('template reference — notify content localized through an email template', () => {
    /** Custom (superRefine) issues at exactly `path`, or `[]` when accepted. */
    function customIssuesAt(value: unknown, path: string): ReadonlyArray<{ code: string; message: string }> {
      const result = NotifyConfigSchema.safeParse(value);
      if (result.success) return [];
      return result.error.issues.filter(
        (i) => i.code === 'custom' && i.path.length === 1 && i.path[0] === path,
      );
    }

    it('accepts a template-only node (no inline title) — RED before the template path existed, when `template` was an unrecognized key', () => {
      expect(NotifyConfigSchema.safeParse({
        recipients: ['u1'],
        template: 'crm.large_deal_won',
        templateData: { dealName: '{record.name}' },
      }).success).toBe(true);
    });

    it('accepts a template reference without templateData (a template may need no variables)', () => {
      expect(NotifyConfigSchema.safeParse({
        recipients: ['u1'],
        template: 'crm.weekly_digest',
      }).success).toBe(true);
    });

    it('refuses template + inline title/message, naming both paths and which to keep', () => {
      for (const inline of [{ title: 'Deal won' }, { message: 'Body' }, { title: 'Deal won', message: 'Body' }]) {
        const issues = customIssuesAt({ recipients: ['u1'], template: 'crm.large_deal_won', ...inline }, 'template');
        // `code` + `path`, never a bare `success === false` (the #7086 lesson):
        // a strictObject refuses for several reasons, and this pin must stay
        // apart from an unknown-key refusal.
        expect(issues, `combo ${Object.keys(inline).join('+')} must be refused at ['template']`).toHaveLength(1);
        const msg = issues[0]!.message;
        // The prescription is behaviour: both keys named, the localizable path
        // identified, and the fix stated.
        expect(msg).toContain('`template`');
        expect(msg).toContain('`title`');
        // The localizable path is identified by what it actually resolves —
        // `(name, locale)` with both rungs of the per-recipient chain named
        // (#13881): the recipient's own column, then the deployment default.
        expect(msg).toMatch(/\(name, locale\)/);
        expect(msg).toContain('`sys_user.locale`');
        expect(msg).toMatch(/deployment default/);
        expect(msg).toMatch(/per recipient/);
        expect(msg).not.toMatch(/not per recipient/);
        expect(msg).not.toMatch(/one locale per notification/);
        expect(msg).toMatch(/delete `title`\/`message`/);
        expect(msg).toMatch(/silently ignore/);
      }
    });

    it('refuses templateData without template — nothing would ever read it', () => {
      const issues = customIssuesAt({ recipients: ['u1'], title: 'hi', templateData: { a: 1 } }, 'templateData');
      expect(issues).toHaveLength(1);
      expect(issues[0]!.message).toContain('`template`');
    });

    it('refuses a node with NEITHER inline title NOR template (at-least-one; a bare missing title was refused before the template path too, as invalid_type)', () => {
      const issues = customIssuesAt({ recipients: ['u1'] }, 'title');
      expect(issues).toHaveLength(1);
      expect(issues[0]!.message).toContain('`template`');
      expect(issues[0]!.message).toContain('`title`');
    });

    it('states the localization contract in the describes, plainly', () => {
      const shape = (NotifyConfigSchema as unknown as { shape: Record<string, { description?: string }> }).shape;

      // Non-empty arms first, so the pattern arms cannot pass vacuously (#6918).
      const templateDoc = shape.template!.description ?? '';
      expect(templateDoc.length, 'template .describe() must not be empty').toBeGreaterThan(0);
      // The contract: resolves by (name, locale) at delivery time…
      expect(templateDoc).toMatch(/\(name, locale\)/);
      expect(templateDoc).toMatch(/delivery time/);
      expect(templateDoc).toContain('sys_email_template');
      // …with the locale named as what it IS since #13881 — resolved per
      // recipient, after fan-out, from the recipient's own `sys_user.locale`
      // with the deployment default underneath. Both rungs are pinned by
      // name, and the retired single-value wording is refused: "one value for
      // the whole notification" would tell an author that converting the
      // nodes does NOT localize per user, which is now false.
      expect(templateDoc).toMatch(/per recipient/);
      expect(templateDoc).toContain('`sys_user.locale`');
      expect(templateDoc).toMatch(/deployment default/);
      expect(templateDoc).toContain('II18nService.getDefaultLocale()');
      expect(templateDoc).not.toMatch(/not one per recipient/);
      expect(templateDoc).not.toMatch(/one value for the whole notification/i);
      // The producer's pre-ruling knob is named as NOT consulted, so an author
      // who still writes `payload.locale` learns from the contract that it is
      // inert rather than from a recipient who got the wrong language.
      expect(templateDoc).toMatch(/`payload\.locale` is not consulted/);
      // The ruling is dated, so the text carries its own provenance rather
      // than reading as a permanent limitation of the design.
      expect(templateDoc).toContain('2026-09-01');
      // …and it is a RAW cross-reference, like topic/channels.
      expect(templateDoc).toMatch(/no `\{token\}` interpolation/i);

      // Inline strings are the non-localizable path, said out loud on both.
      for (const key of ['title', 'message'] as const) {
        const doc = shape[key]!.description ?? '';
        expect(doc.length, `${key} .describe() must not be empty`).toBeGreaterThan(0);
        expect(doc).toMatch(/not localizable/i);
      }

      // templateData names its coupling to template.
      const dataDoc = shape.templateData!.description ?? '';
      expect(dataDoc.length, 'templateData .describe() must not be empty').toBeGreaterThan(0);
      expect(dataDoc).toMatch(/together with `template`/);
    });
  });

  // The dialect table in `shared/expression.zod.ts` lists notification
  // subjects/bodies as `template` slots, and the executor already interpolated
  // `title`/`message` — but both were `z.string()`, so the envelope `tmpl`
  // builds was refused at the execute-time parse (`expected string, received
  // object`). They are typed with the shared template input now: both
  // spellings parse, to ONE value, and everything else is still refused.
  describe('title / message — template slots (the bare string and the template envelope)', () => {
    const TEXT = '[{record.priority}] {record.subject}';

    /** Issues at exactly `[key]`, as `{ code, message }`, or `[]` when accepted. */
    function issuesAt(value: unknown, key: string): ReadonlyArray<{ code: string; message: string }> {
      const result = NotifyConfigSchema.safeParse(value);
      if (result.success) return [];
      return result.error.issues
        .filter((i) => i.path.length === 1 && i.path[0] === key)
        .map((i) => ({ code: i.code, message: i.message }));
    }

    it('parses both spellings on both keys, and they parse to the same value', () => {
      const bare = NotifyConfigSchema.safeParse({ recipients: ['u1'], title: TEXT, message: TEXT });
      const envelope = NotifyConfigSchema.safeParse({
        recipients: ['u1'],
        title: { dialect: 'template', source: TEXT },
        message: tmpl`[{record.priority}] {record.subject}`,
      });
      expect(bare.success, JSON.stringify(bare.error?.issues)).toBe(true);
      expect(envelope.success, JSON.stringify(envelope.error?.issues)).toBe(true);
      // The executor reads this parsed value, so one value is what makes the
      // two spellings render one notification (pinned end to end in
      // service-automation's `notify-template-slots.test.ts`).
      const expected = { dialect: 'template', source: TEXT };
      expect(bare.data?.title).toEqual(expected);
      expect(bare.data?.message).toEqual(expected);
      expect(envelope.data?.title).toEqual(expected);
      expect(envelope.data?.message).toEqual(expected);
    });

    // A refusal is the one place an author is told exactly what to write, and
    // an AI author writes it verbatim. These two slots' renderer is the flow
    // interpolator, which reads single-brace `{token}` only, so their refusals
    // prescribe `{record.name}` — never the shared template input's
    // `{{record.name}}`, which the build's `flow-double-brace-interpolation`
    // rule flags on this very node and the executor would send with a stray
    // pair of braces (#22081). The lint round trip of each prescribed spelling
    // is pinned in `@objectstack/lint` (`lint-flow-patterns.test.ts`).
    const BARE_PRESCRIPTION = "`'{record.name}'`";
    const ENVELOPE_PRESCRIPTION = "`{ dialect: 'template', source: '{record.name}' }`";
    const BLANK = ['', '   '];
    const FOREIGN = [42, true, ['a'], { source: TEXT }, { dialect: 'cel', source: 'record.x' }];

    /** Every message in the refusal's tree: the union's own, then each branch issue beneath it. */
    function messagesIn(issue: { message: string; errors?: ReadonlyArray<ReadonlyArray<unknown>> }): string[] {
      const nested = (issue.errors ?? []).flat() as Array<{ message: string; errors?: ReadonlyArray<ReadonlyArray<unknown>> }>;
      return [issue.message, ...nested.flatMap(messagesIn)];
    }

    it('refuses a blank bare string, or a value that is neither a string nor a template envelope, with one issue prescribing `{record.name}`', () => {
      for (const key of ['title', 'message'] as const) {
        const sentences = new Map<'blank' | 'foreign', Set<string>>([['blank', new Set()], ['foreign', new Set()]]);
        for (const [kind, values] of [['blank', BLANK], ['foreign', FOREIGN]] as const) {
          for (const value of values) {
            const label = `${key} = ${JSON.stringify(value)}`;
            const issues = issuesAt({ recipients: ['u1'], title: 'x', [key]: value }, key);
            expect(issues.map((i) => i.code), label).toEqual(['invalid_union']);
            const message = issues[0]!.message;
            expect(message, label).toContain(`\`${key}\``);
            expect(message, label).toContain(BARE_PRESCRIPTION);
            expect(message, label).toContain(ENVELOPE_PRESCRIPTION);
            sentences.get(kind)!.add(message);
          }
        }
        // One sentence per kind, and the two kinds are told apart.
        expect(sentences.get('blank')!.size, key).toBe(1);
        expect(sentences.get('foreign')!.size, key).toBe(1);
        expect([...sentences.get('blank')!][0]).not.toBe([...sentences.get('foreign')!][0]);
      }
    });

    it('carries no doubled brace anywhere in the refusal — the branch issues the formatters expand included', () => {
      // `formatZodIssue` and the wire mapper both expand an `invalid_union`'s
      // branches beneath its own line, so a branch still naming the shared
      // input's `{{record.name}}` would reach the author under the right one.
      for (const key of ['title', 'message'] as const) {
        for (const value of [...BLANK, ...FOREIGN]) {
          const result = NotifyConfigSchema.safeParse({ recipients: ['u1'], title: 'x', [key]: value });
          const refusal = result.error!.issues.find((i) => i.path.length === 1 && i.path[0] === key)!;
          const messages = messagesIn(refusal as unknown as { message: string });
          expect(messages.length, `${key} = ${JSON.stringify(value)}: the tree was not read`).toBeGreaterThan(0);
          expect(messages.filter((m) => m.includes('{{')), `${key} = ${JSON.stringify(value)}`).toEqual([]);
        }
      }
    });

    it('reaches the build with the same prescription — the flow judge `FlowSchema`, `registerFlow` and `os validate` share', () => {
      for (const key of ['title', 'message'] as const) {
        for (const value of ['   ', 42]) {
          const refusals = flowNodeConfigRefusals('notify', { recipients: ['u1'], title: 'x', [key]: value })
            .filter((r) => r.path === key);
          expect(refusals.map((r) => r.code), `${key} = ${JSON.stringify(value)}`).toEqual(['node-config-refused-by-contract']);
          expect(refusals[0]!.message).toContain(BARE_PRESCRIPTION);
          expect(refusals[0]!.message).not.toContain('{{');
        }
      }
    });

    it('control — the shared template input, whose renderers read `{{var}}`, keeps prescribing `{{record.name}}`', () => {
      // The notify slots took their own sentences; the shared one did not
      // move. `typed-expression-envelope-dialect.test.ts` pins it at the slots
      // that answer with it (`titleFormat`, the prompt template).
      expect(TYPED_EXPRESSION_SOURCE_REQUIRED.template).toContain("`'{{record.name}}'`");
      expect(TYPED_EXPRESSION_DIALECT_ONLY.template).toContain("`'{{record.name}}'`");
      for (const key of ['title', 'message'] as const) {
        const blank = issuesAt({ recipients: ['u1'], title: 'x', [key]: '' }, key)[0]!.message;
        const foreign = issuesAt({ recipients: ['u1'], title: 'x', [key]: 42 }, key)[0]!.message;
        expect(blank).not.toBe(TYPED_EXPRESSION_SOURCE_REQUIRED.template);
        expect(foreign).not.toBe(TYPED_EXPRESSION_DIALECT_ONLY.template);
      }
    });

    it('refuses an envelope with no non-blank `source` — the executor renders `source` and nothing else', () => {
      // The shared envelope arm is the persistence contract and admits both of
      // these; this slot's executor cannot render either, so the slot refuses
      // them by its own rule rather than letting a `title` fail every run or a
      // `message` go out empty.
      for (const key of ['title', 'message'] as const) {
        for (const value of [
          { dialect: 'template', ast: { kind: 'text' } },
          { dialect: 'template', source: '   ' },
        ]) {
          const issues = issuesAt({ recipients: ['u1'], title: 'x', [key]: value }, key);
          expect(issues.map((i) => i.code), `${key} = ${JSON.stringify(value)}`).toEqual(['custom']);
          expect(issues[0]!.message).toContain('`source`');
        }
      }
    });

    it('keeps the content-path rules exactly: an envelope title still excludes `template`, and one still satisfies "needs a content source"', () => {
      const combined = issuesAt(
        { recipients: ['u1'], template: 'crm.large_deal_won', title: tmpl`Deal {record.name} won` },
        'template',
      );
      expect(combined.map((i) => i.code)).toEqual(['custom']);
      expect(NotifyConfigSchema.safeParse({ recipients: ['u1'], title: tmpl`Deal {record.name} won` }).success)
        .toBe(true);
    });

    it('says what the slot takes and which placeholder spelling its renderer reads', () => {
      const shape = (NotifyConfigSchema as unknown as { shape: Record<string, { description?: string }> }).shape;
      for (const key of ['title', 'message'] as const) {
        const doc = shape[key]!.description ?? '';
        expect(doc.length, `${key} .describe() must not be empty`).toBeGreaterThan(0);
        expect(doc).toContain('`{ dialect: \'template\', source }`');
        expect(doc).toContain('`{token}`');
        // The text is interpolated, so "sent verbatim" was never true of it.
        expect(doc).not.toMatch(/verbatim/);
      }
    });
  });
});

describe('HttpConfigSchema — an unknown key is refused, not stripped', () => {
  it('accepts every declared key', () => {
    const full = {
      url: 'https://example.test/hook',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: { hello: 'world' },
      durable: true,
      timeoutMs: 5000,
      signingSecret: 'shh',
    };
    expect(HttpConfigSchema.parse(full)).toEqual(full);
  });

  it('rejects an undeclared key and names the surface', () => {
    const message = unknownKeyMessage(HttpConfigSchema, { url: 'https://x.test', retries: 3 });
    expect(message).toContain('this http node config');
    expect(message).toContain('`retries`');
  });

  it('reaches the two plausible typos by edit distance, which is why it carries no curated table', () => {
    // The claim in the schema's comment, pinned. If either of these stops
    // being reachable, the comment is wrong and an entry is owed.
    expect(unknownKeyMessage(HttpConfigSchema, { url: 'https://x.test', timeout: 5000 }))
      .toContain('`timeout` → `timeoutMs`');
    expect(unknownKeyMessage(HttpConfigSchema, { url: 'https://x.test', header: {} }))
      .toContain('`header` → `headers`');
  });

  it('does not leak `notify`\'s vocabulary — `body` is canonical HERE', () => {
    expect(HttpConfigSchema.safeParse({ url: 'https://x.test', body: { a: 1 } }).success).toBe(true);
    // …and wrong on notify, where the guidance says so explicitly.
    expect(unknownKeyMessage(NotifyConfigSchema, { recipients: ['u1'], title: 'hi', body: 'text' }))
      .toContain('`body` IS canonical on an `http` node');
  });
});
