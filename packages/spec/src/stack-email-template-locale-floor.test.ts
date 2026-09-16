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

  // [#18056] The same `describe` used to promise that a floorless bundle
  // dead-letters, full stop. Measured against `EmailService`'s ladder
  // (`resolveAndRenderTemplate` → `createSysEmailTemplateLoader`), that is true
  // only for a call that NAMED a locale: a call naming none drops to the
  // bundle's lowest tag and renders it, which `plugin-email`'s
  // `template-locale-resolution.test.ts` pins as resolving, not dead-lettering.
  // A published declaration promising a loud permanent refusal where the
  // runtime performs a silent fill is the defect; both call shapes must stay
  // named, so the promise cannot quietly go unconditional again.
  it('[#18056] scopes the dead-letter promise to a call that NAMES a locale, and states the other case', () => {
    const text = String(EmailTemplateDefinitionSchema.shape.locale.description ?? '');
    expect(text).toMatch(/NAMES a locale/);
    expect(text).toMatch(/lowest locale tag/);
    // ⛔ The unscoped promise itself, in the spelling it shipped in.
    expect(text).not.toMatch(/therefore has no fallback floor: any recipient locale/);
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
  // ⛔ Every case in THIS block is a bundle that genuinely carries the floor
  // row. The shapes that are floorless and silent anyway are the guard's scope
  // boundary and live in their own block below — filing them here read as
  // "these have a floor", which is exactly the kind of sentence about runtime
  // behaviour nobody re-reads (#18056).
  it('silent when the bundle carries an en-US row beside the supported tags', () => {
    const { warns, value } = warningsOf(stack(
      ['en-US', 'zh-CN', 'ja-JP', 'es-ES'].map((l) => tpl(l)), THE_TRAP,
    ));
    expect(floorWarns(warns)).toEqual([]);
    expect(value.emailTemplates).toHaveLength(4);
  });

  it('silent when the row omits `locale` entirely — the schema default already IS the floor', () => {
    // Measured, by ablation: moving the call pre-parse does NOT break this —
    // the reader mirrors the schema default for a missing key, so the two
    // agree and the case is silent either way. The pin is the behaviour (an
    // omitted `locale` is never reported), not the call site.
    const { warns, value } = warningsOf(stack([tpl(undefined)], THE_TRAP));
    expect(floorWarns(warns)).toEqual([]);
    expect(value.emailTemplates?.[0]?.locale).toBe(EMAIL_TEMPLATE_FLOOR_LOCALE);
  });

});

describe('#17614 — warn-once bookkeeping', () => {
  it('warns once for one bundle, however many times the same stack is defined', () => {
    const first = warningsOf(stack([tpl('pt-BR')], { defaultLocale: 'pt-BR', supportedLocales: ['pt-BR'] }));
    const second = warningsOf(stack([tpl('pt-BR')], { defaultLocale: 'pt-BR', supportedLocales: ['pt-BR'] }));
    expect(floorWarns(first.warns)).toHaveLength(1);
    expect(floorWarns(second.warns)).toEqual([]);
  });
});

// ── #18056 — the two shapes the guard returns early on ──────────────────────
//
// ⛔ NOT controls. Every bundle below genuinely carries NO `en-US` row, so the
// hazard is real and the silence is this guard's DECLARED SCOPE, not a pass.
// `warnEmailTemplateLocaleFloor`'s docblock now states both; these hold it to
// that, in both directions — each silent case is paired with a DISCRIMINATOR
// that warns, so "silent" can never be read out of a harness that had simply
// stopped reporting. Whether either shape SHOULD warn is the ADR-0049
// enforce-or-remove question and is not decided here; what is closed is the
// silence being undeclared and unpinned.

describe('#18056 — the guard\'s declared scope boundary', () => {
  it('early return 1: a stack with no `i18n` block is never examined, floorless or not', () => {
    const { warns, value } = warningsOf(stack([tpl('en', 'acme.scope_no_i18n')]));
    expect(floorWarns(warns)).toEqual([]);
    // …and the bundle really is floorless: one row, tagged `en`, no `en-US`.
    expect(value.emailTemplates?.map((t) => t.locale)).toEqual(['en']);

    // DISCRIMINATOR — the identical floorless bundle, under a stack that does
    // declare the tag. The guard is awake; shape alone decides.
    const seen = warningsOf(stack(
      [tpl('en', 'acme.scope_no_i18n_disc')], { defaultLocale: 'en', supportedLocales: ['en'] },
    ));
    expect(floorWarns(seen.warns)).toHaveLength(1);
  });

  it('early return 1: `supportedLocales: []` is the other arm — `i18n` cannot omit the key', () => {
    // Measured: `supportedLocales` is REQUIRED inside `i18n`, so the
    // `!Array.isArray` arm is reachable only by omitting `i18n` entirely and
    // the `length === 0` arm only by a literal empty array. Both are silent.
    const { warns } = warningsOf(stack(
      [tpl('en', 'acme.scope_empty_supported')], { defaultLocale: 'en', supportedLocales: [] },
    ));
    expect(floorWarns(warns)).toEqual([]);
  });

  it('early return 1 guards the read as much as it scopes — defineStack must not throw', () => {
    // What deleting it actually costs. `supported.map(...)` off an absent
    // `i18n` is a TypeError out of `defineStack` itself, and BOTH in-tree
    // stacks that declare `emailTemplates` would take it (measured 2026-09-16:
    // examples/app-showcase and the qa/dogfood materialization fixture).
    expect(() => defineStack(stack([tpl('en', 'acme.scope_nothrow')]))).not.toThrow();
  });

  it('early return 2: a bundle whose tags are ALL outside supportedLocales is skipped', () => {
    const i18n = { defaultLocale: 'en-GB', supportedLocales: ['en-GB'] };
    const { warns, value } = warningsOf(stack([tpl('fr-CA', 'acme.scope_outside')], i18n));
    expect(floorWarns(warns)).toEqual([]);
    expect(value.emailTemplates?.map((t) => t.locale)).toEqual(['fr-CA']);

    // DISCRIMINATOR — same stack, same floorlessness, one tag moved INSIDE
    // `supportedLocales`. So the silence above is `declared` being empty, one
    // line after the floor check established the bundle has no floor row.
    const seen = warningsOf(stack([tpl('en-GB', 'acme.scope_inside')], i18n));
    expect(floorWarns(seen.warns)).toHaveLength(1);
    expect(floorWarns(seen.warns)[0]).toContain("carries rows for 'en-GB'");
  });

  it('early return 1 decides nothing early return 2 would not — the outcomes are equal', () => {
    // Measured (#18056): with no supported set every bundle's `declared` list
    // is empty, so shape 2 skips exactly what shape 1 returns before reaching.
    // Pinning the OUTCOMES equal means a future change that gives shape 1 its
    // own meaning has to come and say so here rather than landing silently.
    const tags = (n: string) => [tpl('en', n), tpl('zh-CN', n)];
    const noI18n = warningsOf(stack(tags('acme.scope_shadow_a')));
    const emptySupported = warningsOf(stack(
      tags('acme.scope_shadow_b'), { defaultLocale: 'en', supportedLocales: [] },
    ));
    const allOutside = warningsOf(stack(
      tags('acme.scope_shadow_c'), { defaultLocale: 'ja-JP', supportedLocales: ['ja-JP'] },
    ));
    expect(floorWarns(noI18n.warns)).toEqual([]);
    expect(floorWarns(emptySupported.warns)).toEqual([]);
    expect(floorWarns(allOutside.warns)).toEqual([]);

    // DISCRIMINATOR for all three: the same two-row floorless bundle, with its
    // tags declared. One `supportedLocales` edit is the whole difference.
    const seen = warningsOf(stack(
      tags('acme.scope_shadow_d'), { defaultLocale: 'en', supportedLocales: ['en', 'zh-CN'] },
    ));
    expect(floorWarns(seen.warns)).toHaveLength(1);
  });
});
