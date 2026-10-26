/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The Studio wizard saves an app document the platform accepts
 * (objectui#10842).
 *
 * `wizardDraftToAppSchema` feeds `client.meta.saveItem('app', …)`, and the
 * platform's write door judges that body with `@objectstack/spec`'s strict
 * `AppSchema`. The converter used to write top-level `type`, `title`,
 * `favicon` and `layout` beside the declared keys, and the spec refuses all
 * four (`unrecognized_keys`), so the door answered `422 INVALID_METADATA`.
 *
 * Pinned here:
 *   (a) the wizard's output parses green through the spec's own `AppSchema`,
 *       and carries no key that schema does not declare;
 *   (b) CONTROL — the spec refuses the four keys the converter used to write,
 *       so (a) is judged by a schema that can fail;
 *   (c) the favicon has one spelling, `branding.favicon`: objectui's zod mirror
 *       refuses a top-level `favicon` by name, and so does the TypeScript face.
 */

import { describe, it, expect } from 'vitest';
import { AppSchema as SpecAppSchema } from '@objectstack/spec/ui';
import { wizardDraftToAppSchema } from '../index';
import type { AppComponentSchema, AppWizardDraft } from '../index';
import { AppComponentSchema as AppComponentZod } from '../zod/app.zod';

/** A draft the way `AppCreationWizard` builds it: an object entry and a group. */
const DRAFT: AppWizardDraft = {
  name: 'acme_crm',
  title: 'Acme CRM',
  description: 'Accounts and deals',
  icon: 'Briefcase',
  objects: [{ name: 'account', label: 'Account', pluralLabel: 'Accounts', icon: 'Building', selected: true }],
  navigation: [
    { id: 'account', type: 'object', label: 'Accounts', icon: 'Building', objectName: 'account' },
    { id: 'group_1', type: 'group', label: 'New Group', children: [] },
  ],
  branding: { logo: '/acme.svg', primaryColor: '#2563eb', favicon: '/acme.ico' },
};

/** The spec's issues for a document, as `code` plus the keys it names. */
const specIssues = (doc: unknown) => {
  const r = SpecAppSchema.safeParse(doc);
  return r.success
    ? null
    : r.error.issues.map((i) => ({ code: i.code, path: i.path.join('.'), keys: (i as { keys?: string[] }).keys }));
};

describe('objectui#10842 — the wizard output is a document the spec `AppSchema` accepts', () => {
  it('parses green through the spec `AppSchema`', () => {
    expect(specIssues(wizardDraftToAppSchema(DRAFT))).toBeNull();
  });

  it('carries only keys the spec `AppSchema` declares', () => {
    const declared = new Set(Object.keys(SpecAppSchema.shape));
    const undeclared = Object.keys(wizardDraftToAppSchema(DRAFT)).filter((k) => !declared.has(k));
    expect(undeclared).toEqual([]);
  });

  it('writes the draft title as `label` and the logo and favicon inside `branding`', () => {
    const doc = wizardDraftToAppSchema(DRAFT);
    expect(doc.label).toBe('Acme CRM');
    expect(doc.branding).toEqual({ logo: '/acme.svg', primaryColor: '#2563eb', favicon: '/acme.ico' });
    for (const key of ['type', 'title', 'favicon', 'layout', 'logo']) {
      expect(Object.prototype.hasOwnProperty.call(doc, key), key).toBe(false);
    }
  });
});

describe('objectui#10842 — CONTROL: the spec refuses the keys the converter used to write', () => {
  it('answers `type`, `title`, `favicon` and `layout` with one `unrecognized_keys` at the root', () => {
    // The converter's old output for DRAFT, written out rather than derived, so
    // this control does not move with the converter it is the control for.
    const old = {
      type: 'app',
      name: 'acme_crm',
      title: 'Acme CRM',
      label: 'Acme CRM',
      description: 'Accounts and deals',
      icon: 'Briefcase',
      favicon: '/acme.ico',
      branding: { logo: '/acme.svg', primaryColor: '#2563eb', favicon: '/acme.ico' },
      layout: 'header',
      navigation: DRAFT.navigation,
    };
    const issues = specIssues(old);
    expect(issues).toHaveLength(1);
    expect(issues![0]).toMatchObject({ code: 'unrecognized_keys', path: '' });
    expect([...issues![0].keys!].sort()).toEqual(['favicon', 'layout', 'title', 'type']);
  });
});

describe('objectui#10842 — the favicon has one spelling, `branding.favicon`', () => {
  const mirrorIssues = (input: unknown) => {
    const r = AppComponentZod.safeParse(input);
    return r.success ? null : r.error.issues.map((i) => ({ code: i.code, path: i.path.join('.'), message: i.message }));
  };

  it('the zod mirror refuses a top-level `favicon` by name, at its own path', () => {
    const issues = mirrorIssues({ type: 'app', name: 'acme_crm', favicon: '/acme.ico' });
    expect(issues).toHaveLength(1);
    expect(issues![0]).toMatchObject({ code: 'invalid_type', path: 'favicon' });
    expect(issues![0].message).toContain('Did you mean `favicon` → `branding`?');
  });

  it('CONTROL — the same favicon at `branding.favicon` parses green on both schemas', () => {
    expect(mirrorIssues({ type: 'app', name: 'acme_crm', branding: { favicon: '/acme.ico' } })).toBeNull();
    expect(specIssues({ name: 'acme_crm', label: 'Acme CRM', branding: { favicon: '/acme.ico' } })).toBeNull();
  });

  it('`favicon` on an `AppComponentSchema` literal is a compile error; `branding.favicon` is not', () => {
    // @ts-expect-error — `favicon` is `never` on the app node: write `branding.favicon`.
    const alias: AppComponentSchema = { type: 'app', favicon: '/acme.ico' };
    const canonical: AppComponentSchema = { type: 'app', branding: { favicon: '/acme.ico' } };
    expect(alias.type).toBe(canonical.type);
  });
});
