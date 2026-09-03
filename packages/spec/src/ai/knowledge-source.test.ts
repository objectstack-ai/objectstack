// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// `KnowledgeRefreshPolicySchema.cron` — pins for the typed cron slot (#14825).
//
// The slot was a bare `z.string()` under a doc comment promising a 5-field
// cron, so the promise was enforced nowhere (ADR-0049 declared ≠ enforced). It
// now carries `CronExpressionInputSchema`, the shared cron-dialect input the
// other cron-shaped fields already use (`api/export.zod.ts`,
// `automation/execution.zod.ts`, `integration/connector.zod.ts`). What that
// schema ENFORCES was measured before these pins were written, and the pins
// state exactly that — no more:
//
// - a bare non-empty string normalizes to `{ dialect: 'cron', source }`;
// - an expression envelope passes through;
// - an empty string, a non-string, or an envelope naming an unknown dialect
//   is refused with `invalid_union` at the slot's own path;
// - cron SYNTAX is not judged at parse time. `'not a cron'` normalizes like
//   any other string: the syntax verdict belongs to the `cron` dialect engine
//   (`@objectstack/formula` cron-engine — 5- or 6-field, or an `@` alias) when
//   the expression is evaluated. That pin is deliberate: it is what keeps the
//   schema's describe honest. If the shared dialect ever gains parse-time
//   syntax validation, this pin flips, and the describe on the slot must be
//   rewritten in the same commit.

import { describe, expect, it } from 'vitest';
import {
  KnowledgeRefreshPolicySchema,
  KnowledgeSourceSchema,
  type KnowledgeRefreshPolicy,
  type KnowledgeRefreshPolicyParsed,
  type KnowledgeSource,
  type KnowledgeSourceParsed,
} from './knowledge-source.zod';

const SOURCE: KnowledgeSource = {
  id: 'kb_articles',
  label: 'KB articles',
  adapter: 'memory',
  source: { kind: 'object', object: 'kb_article', contentFields: ['title', 'body'] },
};

const CRON_5_FIELD = '0 3 * * *';

describe('KnowledgeRefreshPolicySchema.cron — the typed cron slot (#14825)', () => {
  it('positive control: a 5-field cron on a full knowledge source parses and normalizes to the cron envelope', () => {
    const r = KnowledgeSourceSchema.safeParse({ ...SOURCE, refresh: { cron: CRON_5_FIELD } });
    expect(r.success, r.success ? '' : JSON.stringify(r.error.issues)).toBe(true);
    if (!r.success) return;
    expect(r.data.refresh?.cron).toEqual({ dialect: 'cron', source: CRON_5_FIELD });
  });

  it('accepts the expression envelope form and passes it through', () => {
    const envelope = { dialect: 'cron' as const, source: '@daily' };
    const r = KnowledgeRefreshPolicySchema.safeParse({ cron: envelope });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.cron).toEqual(envelope);
  });

  it('absent stays absent — no `cron` key is fabricated by the parse', () => {
    const withEmptyRefresh = KnowledgeSourceSchema.safeParse({ ...SOURCE, refresh: {} });
    expect(withEmptyRefresh.success).toBe(true);
    if (withEmptyRefresh.success) expect(withEmptyRefresh.data.refresh?.cron).toBeUndefined();

    const withoutRefresh = KnowledgeSourceSchema.safeParse(SOURCE);
    expect(withoutRefresh.success).toBe(true);
    if (withoutRefresh.success) expect(withoutRefresh.data.refresh?.cron).toBeUndefined();
  });

  it('refuses an empty string with `invalid_union` at `refresh.cron`', () => {
    const r = KnowledgeSourceSchema.safeParse({ ...SOURCE, refresh: { cron: '' } });
    expect(r.success).toBe(false);
    if (r.success) return;
    const issue = r.error.issues.find((i) => i.path.join('.') === 'refresh.cron');
    expect(issue, JSON.stringify(r.error.issues)).toBeDefined();
    expect(issue?.code).toBe('invalid_union');
    expect(issue?.message.split('.')[0]).toBe('Invalid input');
  });

  it('refuses a non-string value with `invalid_union` at `cron`', () => {
    const r = KnowledgeRefreshPolicySchema.safeParse({ cron: 42 });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.issues.map((i) => [i.code, i.path.join('.')])).toEqual([['invalid_union', 'cron']]);
  });

  it('refuses an envelope naming a dialect the protocol does not declare', () => {
    // `js` was retired from `ExpressionDialect` (#3278, ADR-0058 addendum).
    const r = KnowledgeRefreshPolicySchema.safeParse({ cron: { dialect: 'js', source: 'x' } });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.issues.map((i) => [i.code, i.path.join('.')])).toEqual([['invalid_union', 'cron']]);
  });

  it('does NOT judge cron syntax at parse time — measured, and the describe promises no more (declared = enforced)', () => {
    // The syntax verdict is the `cron` dialect engine's at evaluate time:
    // `@objectstack/formula` cron-engine accepts 5- or 6-field expressions and
    // the `@yearly`…`@reboot` aliases. The parse only normalizes. If this case
    // ever goes red because the shared dialect learned to refuse syntax, update
    // the slot's describe in the same commit — do not weaken this pin.
    for (const source of ['not a cron', '0 0 3 * * *', '@daily']) {
      const r = KnowledgeRefreshPolicySchema.safeParse({ cron: source });
      expect(r.success, `${JSON.stringify(source)} should normalize, not be refused`).toBe(true);
      if (r.success) expect(r.data.cron).toEqual({ dialect: 'cron', source });
    }
  });

  it('names both states (ADR-0122): the bare alias is the author state, `XParsed` the parsed state', () => {
    // Author state: a bare string is what an author writes.
    const authored: KnowledgeRefreshPolicy = { cron: CRON_5_FIELD };
    // Parsed state: the envelope is what a consumer holds after the parse.
    const parsed: KnowledgeRefreshPolicyParsed = KnowledgeRefreshPolicySchema.parse(authored);
    expect(parsed.cron).toEqual({ dialect: 'cron', source: CRON_5_FIELD });
    // @ts-expect-error — a bare string is the AUTHOR shape, not the parsed one.
    const notParsed: KnowledgeRefreshPolicyParsed = { cron: CRON_5_FIELD };
    expect(notParsed).toBeDefined();

    const parsedSource: KnowledgeSourceParsed = KnowledgeSourceSchema.parse({ ...SOURCE, refresh: { cron: CRON_5_FIELD } });
    expect(parsedSource.refresh?.cron).toEqual({ dialect: 'cron', source: CRON_5_FIELD });
  });
});
