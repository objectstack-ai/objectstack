import { describe, expect, it } from 'vitest';

import { templateEngine } from './template-engine';

describe('templateEngine', () => {
  it('substitutes simple paths', () => {
    const r = templateEngine.evaluate(
      { dialect: 'template', source: 'Hi {{record.name}}!' },
      { record: { name: 'Lisa' } },
    );
    expect(r).toEqual({ ok: true, value: 'Hi Lisa!' });
  });

  it('renders nested paths', () => {
    const r = templateEngine.evaluate(
      { dialect: 'template', source: '{{record.account.name}} ({{record.account.tier}})' },
      { record: { account: { name: 'Acme', tier: 'gold' } } },
    );
    expect(r).toEqual({ ok: true, value: 'Acme (gold)' });
  });

  it('renders empty for missing paths', () => {
    const r = templateEngine.evaluate(
      { dialect: 'template', source: 'X={{record.missing}}Y' },
      { record: {} },
    );
    expect(r).toEqual({ ok: true, value: 'X=Y' });
  });

  it('exposes os.user / os.org / os.env', () => {
    const r = templateEngine.evaluate(
      { dialect: 'template', source: '{{os.user.id}}@{{os.org.id}}' },
      { user: { id: 'u1' }, org: { id: 'o1' } },
    );
    expect(r).toEqual({ ok: true, value: 'u1@o1' });
  });

  it('rejects unbalanced delimiters', () => {
    const r = templateEngine.compile('Hi {{name');
    expect(r.ok).toBe(false);
  });

  it('refuses non-template dialect', () => {
    const r = templateEngine.evaluate(
      { dialect: 'cel', source: '1' } as never,
      {},
    );
    expect(r.ok).toBe(false);
  });

  // #22110 — a host scope's `$`-named variable (a flow's engine-set `$error`)
  // is a path like any other: the hole compiles, resolves, and an unbound one
  // renders nothing.
  it('reads a `$`-named variable as a path', () => {
    const r = templateEngine.evaluate(
      { dialect: 'template', source: 'Failed: {{ $error.message }}' },
      { extra: { $error: { nodeId: 'n1', message: 'boom' } } },
    );
    expect(r).toEqual({ ok: true, value: 'Failed: boom' });
    expect(templateEngine.compile('{{ $runId }}').ok).toBe(true);
    expect(templateEngine.evaluate({ dialect: 'template', source: '[{{ $nope.x }}]' }, {})).toEqual({ ok: true, value: '[]' });
  });

  it('handles bracket notation', () => {
    const r = templateEngine.evaluate(
      { dialect: 'template', source: '{{record.tags[0]}}' },
      { record: { tags: ['hot', 'cold'] } },
    );
    expect(r).toEqual({ ok: true, value: 'hot' });
  });
});

// The formatter locale rides the context's reserved `locale` channel, never a
// root (#26232). Expected strings come from `Intl` itself, so a newer ICU in CI
// cannot drift them.
describe('templateEngine — formatter locale channel', () => {
  const source = '{{ amount | number:2 }} · {{ due | date:long }} · {{ locale }}';
  const roots = { amount: 1234567.5, due: '2031-05-06T12:00:00Z' };
  const due = new Date('2031-05-06T12:00:00Z');
  const expected = (tag: string, printed = '') =>
    `${new Intl.NumberFormat(tag, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(1234567.5)} · ` +
    `${new Intl.DateTimeFormat(tag, { dateStyle: 'long' }).format(due)} · ${printed}`;
  const render = (ctx: Parameters<typeof templateEngine.evaluate>[1]) =>
    templateEngine.evaluate<string>({ dialect: 'template', source }, ctx);

  it('formats in the locale the context names', () => {
    expect(render({ extra: roots, locale: 'de-DE' })).toEqual({ ok: true, value: expected('de-DE') });
    expect(expected('de-DE')).not.toBe(expected('en-US'));
  });

  it('a root named `locale` is a value a hole prints, not the formatter locale', () => {
    expect(render({ extra: { ...roots, locale: 'de-DE' } })).toEqual({
      ok: true,
      value: expected('en-US', 'de-DE'),
    });
    expect(render({ extra: { ...roots, locale: 'de-DE' }, locale: 'fr-FR' })).toEqual({
      ok: true,
      value: expected('fr-FR', 'de-DE'),
    });
  });

  it('no locale, or an empty one, renders en-US as before', () => {
    expect(render({ extra: roots })).toEqual({ ok: true, value: expected('en-US') });
    expect(render({ extra: roots, locale: '' })).toEqual({ ok: true, value: expected('en-US') });
  });
});
