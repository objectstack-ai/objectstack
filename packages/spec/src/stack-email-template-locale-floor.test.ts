// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #17614 — an `emailTemplates` bundle tagged with the stack's OWN
// `i18n.defaultLocale` has no fallback floor.
//
// Measured before this landed, on an unmodified tree: a stack declaring
// `defaultLocale: 'en'`, `supportedLocales: ['en','zh-CN','ja-JP','es-ES']`
// and one row per those tags parsed with ZERO warnings and ZERO errors, and
// the resolver then answered `TEMPLATE_NOT_FOUND` — which classifies
// PERMANENT, so the delivery dead-letters with no retry — for `de-DE` and for
// the literal `en-US`. The identical bundle with its English row tagged
// `en-US` delivered for `de-DE`. `sendTemplate` matches `(name, locale)`
// exactly and retries exactly one rung, the literal `en-US`; there is no
// language-subtag folding, and that ladder's shape is a settled ruling this
// change deliberately does not touch. The remedy is the bundle, so the
// diagnostic is where the author is standing.
//
// These pin the diagnostic ADVISORY: every case asserts the parse still
// succeeds and the stack comes back unchanged. The diagnostic narrows what
// passes SILENTLY; it moves no accept set.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { defineStack } from './stack.zod';
import { EmailTemplateDefinitionSchema, EMAIL_TEMPLATE_FLOOR_LOCALE } from './system/email-template.zod';

const MANIFEST = { id: 'acme', name: 'acme', version: '1.0.0', namespace: 'acme', type: 'app' as const };

const tpl = (locale: string | undefined, name = 'acme.welcome') => ({
  name,
  label: `Welcome ${locale ?? '(default)'}`,
  ...(locale === undefined ? {} : { locale }),
  subject: `[${locale ?? 'default'}] Hi {{name}}`,
  bodyHtml: `<p>[${locale ?? 'default'}] Hi {{name}}</p>`,
});

const stack = (tpls: unknown[], i18n?: unknown) => ({
  manifest: MANIFEST,
  ...(i18n === undefined ? {} : { i18n }),
  emailTemplates: tpls,
}) as never;

const THE_TRAP = { defaultLocale: 'en', supportedLocales: ['en', 'zh-CN', 'ja-JP', 'es-ES'], fallbackLocale: 'en' };

/** Run `defineStack` capturing every `console.warn` it emits. */
function warningsOf(config: unknown): { warns: string[]; value: ReturnType<typeof defineStack> } {
  const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const value = defineStack(config as never);
    return { warns: spy.mock.calls.map((c) => c.map(String).join(' ')), value };
  } finally {
    spy.mockRestore();
  }
}

const floorWarns = (warns: string[]) => warns.filter((w) => w.includes('no fallback floor'));

afterEach(() => {
  // The reporter is warn-once per (bundle, tags); each test authors its own
  // tag set so the cache cannot mask a case, but keep runs independent.
  vi.restoreAllMocks();
});

describe('#17614 — the floor tag is one named constant, not two spellings', () => {
  it('is the schema default for `locale`, so a row that omits the key HAS the floor', () => {
    expect(EMAIL_TEMPLATE_FLOOR_LOCALE).toBe('en-US');
    const parsed = EmailTemplateDefinitionSchema.parse({
      name: 'acme.welcome', label: 'W', subject: 's', bodyHtml: '<p>b</p>',
    });
    expect(parsed.locale).toBe(EMAIL_TEMPLATE_FLOOR_LOCALE);
  });

  it("states the two facts an author needs in the published `describe` — the floor tag and what a miss costs", () => {
    // The `describe` is the authoring surface (it lands in the generated
    // reference docs). The rule used to live only in a docstring two packages
    // away, under a heading about a different subject — which is the finding.
    const text = String(EmailTemplateDefinitionSchema.shape.locale.description ?? '');
    expect(text).toContain('en-US');
    expect(text).toContain('TEMPLATE_NOT_FOUND');
  });
});

describe('#17614 — defineStack reports a bundle with no `en-US` floor', () => {
  it('reports the trap: every supportedLocales tag authored, none of them the floor', () => {
    const { warns, value } = warningsOf(stack(['en', 'zh-CN', 'ja-JP', 'es-ES'].map((l) => tpl(l)), THE_TRAP));
    const hits = floorWarns(warns);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toContain("emailTemplates 'acme.welcome'");
    expect(hits[0]).toContain("none tagged 'en-US'");
    expect(hits[0]).toContain('TEMPLATE_NOT_FOUND');
    // ADVISORY — the accept set did not move: the stack parsed and came back
    // carrying exactly the tags the author wrote.
    expect(value.emailTemplates?.map((t) => t.locale)).toEqual(['en', 'zh-CN', 'ja-JP', 'es-ES']);
  });

  it('reports a single-row bundle tagged with the stack default — the consistent thing an author writes', () => {
    const { warns, value } = warningsOf(stack([tpl('en')], THE_TRAP));
    expect(floorWarns(warns)).toHaveLength(1);
    expect(value.emailTemplates).toHaveLength(1);
  });

  it('reports each bundle separately, by name', () => {
    const { warns } = warningsOf(stack(
      [tpl('en', 'acme.welcome'), tpl('zh-CN', 'acme.welcome'), tpl('en', 'acme.reset')],
      THE_TRAP,
    ));
    const hits = floorWarns(warns);
    expect(hits).toHaveLength(2);
    expect(hits.some((w) => w.includes("'acme.welcome'"))).toBe(true);
    expect(hits.some((w) => w.includes("'acme.reset'"))).toBe(true);
  });
});

describe('#17614 — and stays silent where the bundle HAS a floor (the controls)', () => {
  it('silent when the bundle carries an en-US row beside the supported tags', () => {
    const { warns, value } = warningsOf(stack(
      ['en-US', 'zh-CN', 'ja-JP', 'es-ES'].map((l) => tpl(l)), THE_TRAP,
    ));
    expect(floorWarns(warns)).toEqual([]);
    expect(value.emailTemplates).toHaveLength(4);
  });

  it('silent when the row omits `locale` entirely — the schema default already IS the floor', () => {
    // This is the post-parse seam. Run pre-parse, the key is not there yet and
    // this stack would be reported for a floor it actually has.
    const { warns, value } = warningsOf(stack([tpl(undefined)], THE_TRAP));
    expect(floorWarns(warns)).toEqual([]);
    expect(value.emailTemplates?.[0]?.locale).toBe(EMAIL_TEMPLATE_FLOOR_LOCALE);
  });

  it('silent when the stack declares no supportedLocales to measure against', () => {
    const { warns } = warningsOf(stack([tpl('en')]));
    expect(floorWarns(warns)).toEqual([]);
  });

  it('silent when no authored tag is one this stack claims to support', () => {
    const { warns } = warningsOf(stack([tpl('fr-CA')], { defaultLocale: 'en', supportedLocales: ['en'] }));
    expect(floorWarns(warns)).toEqual([]);
  });

  it('warns once for one bundle, however many times the same stack is defined', () => {
    const first = warningsOf(stack([tpl('pt-BR')], { defaultLocale: 'pt-BR', supportedLocales: ['pt-BR'] }));
    const second = warningsOf(stack([tpl('pt-BR')], { defaultLocale: 'pt-BR', supportedLocales: ['pt-BR'] }));
    expect(floorWarns(first.warns)).toHaveLength(1);
    expect(floorWarns(second.warns)).toEqual([]);
  });
});
