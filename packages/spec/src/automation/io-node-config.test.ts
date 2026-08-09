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

/** The unknown-key message, or `undefined` when the shape was accepted. */
function unknownKeyMessage(schema: { safeParse(v: unknown): { success: boolean; error?: { issues: ReadonlyArray<{ code: string; message: string }> } } }, value: unknown): string | undefined {
  const result = schema.safeParse(value);
  if (result.success) return undefined;
  return result.error!.issues.find((i) => i.code === 'unrecognized_keys')?.message;
}

describe('NotifyConfigSchema — strict as of #4001 批 9', () => {
  it('accepts every declared key', () => {
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

  it('sourceObject/sourceId describes state the documented pair tolerance, not a phantom requirement (#7085)', () => {
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
});

describe('HttpConfigSchema — strict as of #4001 批 9', () => {
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
