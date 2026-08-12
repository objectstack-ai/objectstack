// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7730] i18n bundles survive registration — `(name, locale)` is the key.
 *
 * `EmailTemplateDefinitionSchema` declares that "multiple rows with the same
 * `name` but different `locale` form an i18n bundle" and that a template "is
 * resolved by `(name, locale)`" (packages/spec/src/system/email-template.zod.ts).
 * `registerItem` keyed every item by name alone, so the zh-CN row overwrote the
 * en-US one through the `[Registry] Overwriting …` path and only the last
 * locale ever reached `sys_email_template`. Declared, not enforced.
 *
 * The rows are only half the round trip: this file also pins the READ side, so
 * a bare-name lookup of a bundle answers the same layer it always did (ADR-0005
 * overlay, then ADR-0048 prefer-local, then first composite) and picks the
 * canonical locale within it, rather than whichever member the Map iterates
 * first.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { EmailTemplateDefinitionSchema } from '@objectstack/spec/system';
import { SchemaRegistry, ITEM_KEY_DISCRIMINATORS } from './registry';

/** A minimal spec-valid template; `locale` is supplied per case. */
function tpl(name: string, locale: string | undefined, extra: Record<string, unknown> = {}) {
  return {
    name,
    label: `Label ${locale ?? '(default)'}`,
    subject: `Subject ${locale ?? '(default)'}`,
    bodyHtml: `<p>${locale ?? '(default)'}</p>`,
    ...(locale === undefined ? {} : { locale }),
    ...extra,
  };
}

describe('SchemaRegistry — i18n bundle keys (#7730)', () => {
  let registry: SchemaRegistry;

  beforeEach(() => {
    registry = new SchemaRegistry({ multiTenant: false });
    registry.logLevel = 'silent';
  });

  describe('the declared bundle materializes', () => {
    it('keeps both locales of one name — the reported symptom', () => {
      registry.registerItem('email_template', tpl('auth.welcome', 'en-US'), 'name', 'com.acme.crm');
      registry.registerItem('email_template', tpl('auth.welcome', 'zh-CN'), 'name', 'com.acme.crm');

      const listed = registry.listItems<any>('email_template');
      expect(listed).toHaveLength(2);
      expect(listed.map((t) => t.locale).sort()).toEqual(['en-US', 'zh-CN']);
    });

    it('is what the `sys_email_template` materializer reads back', () => {
      // `bootstrapDeclaredEmailTemplates` (plugin-email) reads
      // `registry.listItems('email_template')` and upserts each row on
      // `(name, locale)`. Four authored templates over three names — the QA
      // stack's shape — must arrive as four rows, not three.
      registry.registerItem('email_template', tpl('auth.welcome', 'en-US'), 'name', 'com.acme.crm');
      registry.registerItem('email_template', tpl('auth.welcome', 'zh-CN'), 'name', 'com.acme.crm');
      registry.registerItem('email_template', tpl('auth.reset', 'en-US'), 'name', 'com.acme.crm');
      registry.registerItem('email_template', tpl('crm.digest', 'en-US'), 'name', 'com.acme.crm');

      const pairs = registry
        .listItems<any>('email_template')
        .map((t) => `${t.name}@${t.locale}`)
        .sort();
      expect(pairs).toEqual([
        'auth.reset@en-US',
        'auth.welcome@en-US',
        'auth.welcome@zh-CN',
        'crm.digest@en-US',
      ]);
    });

    it('treats an omitted `locale` as the canonical member, not a fourth key', () => {
      // The schema defaults `locale` to en-US, so `{ name }` and
      // `{ name, locale: 'en-US' }` are the SAME template — a re-register, not
      // a bundle member. Keying the absent value separately would double-seed.
      registry.registerItem('email_template', tpl('auth.welcome', undefined), 'name', 'com.acme.crm');
      registry.registerItem('email_template', tpl('auth.welcome', 'en-US', { subject: 'second write' }), 'name', 'com.acme.crm');

      const listed = registry.listItems<any>('email_template');
      expect(listed).toHaveLength(1);
      expect(listed[0].subject).toBe('second write');
    });

    it('still overwrites a genuine same-(name, locale) re-registration', () => {
      registry.registerItem('email_template', tpl('auth.welcome', 'zh-CN', { subject: 'first' }), 'name', 'com.acme.crm');
      registry.registerItem('email_template', tpl('auth.welcome', 'zh-CN', { subject: 'second' }), 'name', 'com.acme.crm');

      const listed = registry.listItems<any>('email_template');
      expect(listed).toHaveLength(1);
      expect(listed[0].subject).toBe('second');
    });

    it('keeps two packages shipping the same (name, locale) apart', () => {
      registry.registerItem('email_template', tpl('auth.welcome', 'zh-CN', { subject: 'crm' }), 'name', 'com.acme.crm');
      registry.registerItem('email_template', tpl('auth.welcome', 'zh-CN', { subject: 'hr' }), 'name', 'com.acme.hr');

      expect(registry.listItems<any>('email_template')).toHaveLength(2);
      expect(registry.getItem<any>('email_template', 'auth.welcome', 'com.acme.hr')?.subject).toBe('hr');
    });
  });

  describe('the canonical member is the spec default, not a copy of it', () => {
    it('pins the registry canonical locale to `EmailTemplateDefinitionSchema`', () => {
      // The discriminator table carries the canonical locale as a literal.
      // This is the assertion that stops it drifting from the schema default
      // it mirrors — change one without the other and this goes red.
      const parsed = EmailTemplateDefinitionSchema.parse(tpl('auth.welcome', undefined));
      expect(ITEM_KEY_DISCRIMINATORS.email_template.canonical).toBe(parsed.locale);
      expect(ITEM_KEY_DISCRIMINATORS.email_template.field).toBe('locale');
    });
  });

  describe('bare-name reads answer the same layer they always did', () => {
    it('returns the canonical member regardless of registration order', () => {
      registry.registerItem('email_template', tpl('auth.welcome', 'zh-CN'), 'name', 'com.acme.crm');
      registry.registerItem('email_template', tpl('auth.welcome', 'en-US'), 'name', 'com.acme.crm');

      expect(registry.getItem<any>('email_template', 'auth.welcome')?.locale).toBe('en-US');
      expect(registry.getItem<any>('email_template', 'auth.welcome', 'com.acme.crm')?.locale).toBe('en-US');
    });

    it('still resolves a bundle that has no canonical member', () => {
      // A stack may localize a template into zh-CN only. Before the key
      // carried a locale this resolved because the single row sat on the bare
      // name; a bundle-blind read would now answer `undefined` — a regression
      // the fix must not introduce.
      registry.registerItem('email_template', tpl('auth.welcome', 'zh-CN'), 'name', 'com.acme.crm');

      expect(registry.getItem<any>('email_template', 'auth.welcome')?.locale).toBe('zh-CN');
    });

    it('keeps ADR-0005 overlay precedence over the packaged bundle', () => {
      registry.registerItem('email_template', tpl('auth.welcome', 'en-US', { subject: 'packaged' }), 'name', 'com.acme.crm');
      registry.registerItem('email_template', tpl('auth.welcome', 'en-US', { subject: 'overlay' }), 'name');

      expect(registry.getItem<any>('email_template', 'auth.welcome')?.subject).toBe('overlay');
      expect(registry.getItem<any>('email_template', 'auth.welcome', 'com.acme.crm')?.subject).toBe('overlay');
    });

    it('keeps ADR-0048 prefer-local precedence across packages', () => {
      registry.registerItem('email_template', tpl('auth.welcome', 'en-US', { subject: 'crm' }), 'name', 'com.acme.crm');
      registry.registerItem('email_template', tpl('auth.welcome', 'en-US', { subject: 'hr' }), 'name', 'com.acme.hr');

      expect(registry.getItem<any>('email_template', 'auth.welcome', 'com.acme.hr')?.subject).toBe('hr');
      expect(registry.getItem<any>('email_template', 'auth.welcome', 'com.acme.crm')?.subject).toBe('crm');
    });

    it('serves the packaged artifact to `getArtifactItem`, never the overlay', () => {
      registry.registerItem('email_template', tpl('auth.welcome', 'zh-CN', { subject: 'packaged' }), 'name', 'com.acme.crm');
      registry.registerItem('email_template', tpl('auth.welcome', 'zh-CN', { subject: 'overlay' }), 'name');

      const artifact = registry.getArtifactItem<any>('email_template', 'auth.welcome');
      expect(artifact?.subject).toBe('packaged');
      expect(artifact?._packageId).toBe('com.acme.crm');
    });
  });

  describe('withdrawal takes the whole bundle', () => {
    it('unregisters every locale of a name', () => {
      // Delete events carry `(type, name)` and no locale — the same reason
      // `deactivateDeclaredEmailTemplate` sweeps `sys_email_template` by name
      // across locales. Leaving a member behind would make it re-seed.
      registry.registerItem('email_template', tpl('auth.welcome', 'en-US'), 'name', 'com.acme.crm');
      registry.registerItem('email_template', tpl('auth.welcome', 'zh-CN'), 'name', 'com.acme.crm');
      registry.registerItem('email_template', tpl('auth.reset', 'en-US'), 'name', 'com.acme.crm');

      registry.unregisterItem('email_template', 'auth.welcome');

      expect(registry.listItems<any>('email_template').map((t) => t.name)).toEqual(['auth.reset']);
      expect(registry.getItem<any>('email_template', 'auth.welcome')).toBeUndefined();
    });

    it('does not take a second package\'s same-named bundle with it', () => {
      registry.registerItem('email_template', tpl('auth.welcome', 'en-US', { subject: 'crm' }), 'name', 'com.acme.crm');
      registry.registerItem('email_template', tpl('auth.welcome', 'zh-CN', { subject: 'crm' }), 'name', 'com.acme.crm');
      registry.registerItem('email_template', tpl('auth.welcome', 'en-US', { subject: 'hr' }), 'name', 'com.acme.hr');

      registry.unregisterItem('email_template', 'auth.welcome');

      const left = registry.listItems<any>('email_template');
      expect(left).toHaveLength(1);
      expect(left[0].subject).toBe('hr');
    });

    it('removes the overlay members and leaves the packaged bundle serving', () => {
      registry.registerItem('email_template', tpl('auth.welcome', 'zh-CN', { subject: 'packaged' }), 'name', 'com.acme.crm');
      registry.registerItem('email_template', tpl('auth.welcome', 'zh-CN', { subject: 'overlay' }), 'name');

      expect(registry.removeOverlayEntry('email_template', 'auth.welcome')).toBe(true);
      expect(registry.getItem<any>('email_template', 'auth.welcome')?.subject).toBe('packaged');
      // Idempotent: nothing left to remove.
      expect(registry.removeOverlayEntry('email_template', 'auth.welcome')).toBe(false);
    });

    it('heals the runtime shadow so the packaged bundle becomes visible again', () => {
      registry.registerItem('email_template', tpl('auth.welcome', 'en-US', { subject: 'packaged' }), 'name', 'com.acme.crm');
      registry.registerItem('email_template', tpl('auth.welcome', 'en-US', { subject: 'overlay' }), 'name');

      expect(registry.removeRuntimeShadow('email_template', 'auth.welcome')).toBe(true);
      expect(registry.getItem<any>('email_template', 'auth.welcome')?.subject).toBe('packaged');
      // Conservative as before: with no artifact underneath it declines.
      registry.registerItem('email_template', tpl('crm.digest', 'en-US'), 'name');
      expect(registry.removeRuntimeShadow('email_template', 'crm.digest')).toBe(false);
      expect(registry.getItem<any>('email_template', 'crm.digest')).toBeDefined();
    });
  });

  describe('scope — only declared-discriminated types are re-keyed', () => {
    it('leaves an undiscriminated type keyed by name alone, even when it carries a `locale`', () => {
      // The key computation is generic to every registered metadata type. A
      // type whose identity the spec does NOT declare as a pair must keep
      // last-write-wins on the name, or this fix would quietly change the
      // identity of every other metadata kind.
      registry.registerItem('page', { name: 'home', locale: 'en-US', title: 'first' }, 'name', 'com.acme.crm');
      registry.registerItem('page', { name: 'home', locale: 'zh-CN', title: 'second' }, 'name', 'com.acme.crm');

      const pages = registry.listItems<any>('page');
      expect(pages).toHaveLength(1);
      expect(pages[0].title).toBe('second');
      expect(registry.getItem<any>('page', 'home')?.title).toBe('second');
    });

    it('declares exactly one discriminated type today', () => {
      // A guard on the blast radius: adding a type here re-keys every item of
      // that type, so it is a deliberate contract change, not a tweak.
      expect(Object.keys(ITEM_KEY_DISCRIMINATORS)).toEqual(['email_template']);
    });
  });

  describe('the #7557 disabled-package gate still sees every member', () => {
    it('hides the whole bundle when its owning package is disabled', () => {
      // `listItems` filters by each item's `_packageId` (PR #7700). Re-keying
      // must not let a bundle member slip past that filter.
      registry.installPackage({ id: 'com.acme.crm', name: 'CRM', version: '1.0.0' } as any);
      registry.registerItem('email_template', tpl('auth.welcome', 'en-US'), 'name', 'com.acme.crm');
      registry.registerItem('email_template', tpl('auth.welcome', 'zh-CN'), 'name', 'com.acme.crm');
      expect(registry.listItems<any>('email_template')).toHaveLength(2);

      registry.disablePackage('com.acme.crm');
      expect(registry.listItems<any>('email_template')).toHaveLength(0);

      registry.enablePackage('com.acme.crm');
      expect(registry.listItems<any>('email_template')).toHaveLength(2);
    });
  });
});
