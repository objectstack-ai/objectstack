// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #8019 — the change-email notice template, in every supported locale.
 *
 * Maintainer ruling 2026-08-12: 「notify the OLD address — do not gate on it」,
 * with the scope naming a new template plus its keys in the four supported
 * locales, and ⛔ **no undo/rollback link** (a revert is a separate flow and a
 * separate decision).
 *
 * `plugin-auth` owns the SENDING half (that it goes out, to the old address,
 * without gating — `change-email-delete-user-wiring.test.ts`). This file owns
 * the AUTHORING half: that the row exists in each locale, that it is
 * seeded/resolvable rather than merely exported, and that the prose obeys the
 * ruling's two content constraints.
 *
 * Every expectation is written as a literal. Deriving the locale set or the
 * variable list from the same constants the templates are built from would
 * make this file agree with any edit, including deleting three locales.
 */

import { describe, it, expect } from 'vitest';
import { EmailTemplateDefinitionSchema } from '@objectstack/spec/system';
import {
  AUTH_EMAIL_CHANGE_NOTICE_TEMPLATES,
  BUILTIN_AUTH_TEMPLATES,
} from './templates/auth-templates.js';

/** The four locales this platform supports, spelled out — not imported. */
const SUPPORTED_LOCALES = ['en-US', 'zh-CN', 'ja-JP', 'es-ES'] as const;

const TEMPLATE_NAME = 'auth.email_change_notice';

const rows = AUTH_EMAIL_CHANGE_NOTICE_TEMPLATES;
const byLocale = (locale: string) => rows.find((t) => t.locale === locale);

/** Subject + both bodies, i.e. everything a recipient can actually read. */
const proseOf = (t: (typeof rows)[number]): string =>
  [t.subject, t.bodyHtml, t.bodyText].filter(Boolean).join('\n');

describe('#8019 — auth.email_change_notice ships in all four locales', () => {
  it('has exactly one row per supported locale, all under the same template name', () => {
    expect(rows.map((t) => t.locale).sort()).toEqual([...SUPPORTED_LOCALES].sort());
    expect(new Set(rows.map((t) => t.name))).toEqual(new Set([TEMPLATE_NAME]));
  });

  it('is seeded with the built-in auth templates, so the send path can resolve it', () => {
    // Exported-but-unseeded would pass every other assertion here and still
    // throw TEMPLATE_NOT_FOUND on the first real change-email request.
    const seeded = BUILTIN_AUTH_TEMPLATES.filter((t) => t.name === TEMPLATE_NAME);
    expect(seeded.map((t) => t.locale).sort()).toEqual([...SUPPORTED_LOCALES].sort());
  });

  it('carries an en-US row — the locale the platform send path actually asks for', () => {
    // `EmailService.sendTemplate` with no `locale` resolves DEFAULT_TEMPLATE_LOCALE
    // ('en-US'). Without this row the notice would fall through the ladder's
    // last resort and pick a row by lowest locale tag — 'es-ES' — so a
    // deployment would mail Spanish to everyone.
    expect(byLocale('en-US')).toBeDefined();
  });

  for (const locale of SUPPORTED_LOCALES) {
    describe(locale, () => {
      it('parses against EmailTemplateDefinitionSchema', () => {
        const parsed = EmailTemplateDefinitionSchema.safeParse(byLocale(locale));
        expect(parsed.success, JSON.stringify(parsed.error?.issues ?? [], null, 2)).toBe(true);
      });

      it('declares the holes the sender fills, and requires the two that carry the meaning', () => {
        const t = byLocale(locale)!;
        const names = (t.variables ?? []).map((v) => v.name).sort();
        expect(names).toEqual(['appName', 'newEmail', 'user.email', 'user.name']);
        const required = (t.variables ?? []).filter((v) => v.required).map((v) => v.name).sort();
        // Ruling: the notice must state the new address; `user.email` is the
        // old one it is addressed to. Neither may silently render empty.
        expect(required).toEqual(['newEmail', 'user.email']);
      });

      it('names what changed and the address it is moving to', () => {
        const prose = proseOf(byLocale(locale)!);
        expect(prose).toContain('{{newEmail}}');
        expect(prose).toContain('{{user.email}}');
      });

      it('offers a support path', () => {
        // "who to contact" in the locale's own words — asserted as the
        // presence of a contact instruction, since the wording differs per
        // locale by design.
        const prose = proseOf(byLocale(locale)!);
        const support: Record<string, RegExp> = {
          'en-US': /administrator or support/i,
          'zh-CN': /管理员或支持团队/,
          'ja-JP': /管理者またはサポート/,
          'es-ES': /administrador o el equipo de soporte/i,
        };
        expect(prose).toMatch(support[locale]);
      });

      it('⛔ embeds no undo/rollback affordance', () => {
        // Ruling edge 3. Checked as (a) no revert-shaped wording, and (b) no
        // link hole at all other than none — this template deliberately has no
        // URL variable, so ANY `href` pointing at a placeholder is a smuggled
        // action.
        const t = byLocale(locale)!;
        const prose = proseOf(t);
        expect(prose).not.toMatch(/undo|revert|rollback|restore this address|cancel the change/i);
        expect(prose).not.toMatch(/撤销|撤消|回滚|取消变更/);
        expect(prose).not.toMatch(/元に戻す|取り消/);
        expect(prose).not.toMatch(/deshacer|revertir|cancelar el cambio/i);
        expect(t.bodyHtml ?? '').not.toMatch(/href="\{\{/);
        expect((t.variables ?? []).map((v) => v.type)).not.toContain('url');
      });

      it('does not tell the reader to ignore it', () => {
        // The shared footer ends "you can safely ignore this message", which is
        // the opposite of true here — this row overrides it. A future refactor
        // that drops the override would silently neuter the notice.
        const prose = proseOf(byLocale(locale)!);
        expect(prose).not.toMatch(/safely ignore/i);
        expect(prose).not.toMatch(/可以忽略|请忽略/);
        expect(prose).not.toMatch(/無視して/);
        expect(prose).not.toMatch(/puedes ignorar/i);
      });
    });
  }

  it('says the change is PENDING, never that it already happened', () => {
    // The notice is sent when the request is accepted, not when it is applied
    // — the only non-gating seam better-auth 1.7.0-rc.2 offers. Past-tense
    // wording would be false for every request nobody ever confirms.
    expect(proseOf(byLocale('en-US')!)).toMatch(/requested to change|takes effect once/i);
    expect(proseOf(byLocale('en-US')!)).not.toMatch(/your email (address )?(has been|was) changed/i);
  });
});
