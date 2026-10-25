/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The app logo has ONE spelling: `branding.logo` (objectui#10827).
 *
 * `@objectstack/spec`'s `AppSchema` declares the logo only inside
 * `AppBrandingSchema`, as a URL. Its alias table answers a top-level `logo`
 * with "did you mean `branding`?" — a refusal, not a fold. objectui carried
 * that top-level key as a second, local spelling ("Logo URL or icon name"),
 * declared on both faces of `AppComponentSchema` and written by
 * `wizardDraftToAppSchema` beside the `branding.logo` it copied it from.
 *
 * Pinned here:
 *   (a) the zod mirror refuses a top-level `logo` by name, at its own path,
 *       pointing at `branding` — the answer the spec gives;
 *   (b) the TypeScript face refuses it at the authoring site;
 *   (c) `wizardDraftToAppSchema` writes the logo into `branding` only, and its
 *       output parses green through the spec `AppSchema` that refuses the alias;
 *   (d) CONTROLS — `branding.logo` parses, and the spec's own posture is the
 *       refusal this mirror now matches.
 */

import { describe, it, expect } from 'vitest';
import { AppSchema as SpecAppSchema } from '@objectstack/spec/ui';
import { wizardDraftToAppSchema } from '../index';
import type { AppComponentSchema, AppWizardDraft } from '../index';
import { AppComponentSchema as AppComponentZod } from '../zod/app.zod';

type Issue = { code: string; path: string; message: string };
/** `null` when the document parses; its issues otherwise. */
const issuesOf = (input: unknown): Issue[] | null => {
  const r = AppComponentZod.safeParse(input);
  return r.success
    ? null
    : r.error.issues.map((i) => ({ code: i.code, path: i.path.join('.'), message: i.message }));
};

const DRAFT: AppWizardDraft = {
  name: 'acme_crm',
  title: 'Acme CRM',
  icon: 'Briefcase',
  objects: [],
  navigation: [],
  branding: { logo: 'https://cdn.example.test/acme.svg', primaryColor: '#2563eb' },
};

describe('objectui#10827 — the zod mirror refuses a top-level `logo` by name', () => {
  it('refuses with one issue, `invalid_type` at `logo`', () => {
    const issues = issuesOf({ type: 'app', name: 'acme_crm', logo: '/acme.svg' });
    expect(issues).toHaveLength(1);
    expect(issues![0]).toMatchObject({ code: 'invalid_type', path: 'logo' });
  });

  it('the issue names `branding` as the fix — the spec\'s own alias answer', () => {
    const [issue] = issuesOf({ type: 'app', logo: '/acme.svg' })!;
    expect(issue.message).toContain('Did you mean `logo` → `branding`?');
  });

  it.each(['/acme.svg', 'Briefcase', 'https://cdn.example.test/acme.svg', ''])(
    'refuses the key whatever it holds (%j) — URL and icon name alike',
    (value) => {
      expect(issuesOf({ type: 'app', logo: value })?.map((i) => i.path)).toEqual(['logo']);
    },
  );

  it('CONTROL — the same logo at `branding.logo` parses green', () => {
    expect(issuesOf({ type: 'app', name: 'acme_crm', branding: { logo: '/acme.svg' } })).toBeNull();
  });
});

describe('objectui#10827 — the TypeScript face refuses a top-level `logo`', () => {
  it('`logo` on an `AppComponentSchema` literal is a compile error; `branding.logo` is not', () => {
    // @ts-expect-error — `logo` is `never` on the app node: write `branding.logo`.
    const alias: AppComponentSchema = { type: 'app', logo: '/acme.svg' };
    const canonical: AppComponentSchema = { type: 'app', branding: { logo: '/acme.svg' } };
    expect(alias.type).toBe(canonical.type);
  });
});

describe('objectui#10827 — `wizardDraftToAppSchema` writes the logo into `branding` only', () => {
  it('no top-level `logo` key, and `branding.logo` carries the draft\'s value', () => {
    const schema = wizardDraftToAppSchema(DRAFT);
    expect(Object.prototype.hasOwnProperty.call(schema, 'logo')).toBe(false);
    expect(schema.branding?.logo).toBe('https://cdn.example.test/acme.svg');
  });

  it('its output parses green through the spec `AppSchema`, which refuses the alias', () => {
    // A converter that still copied the logo to the top level would be refused
    // here. The output is the document the Studio SAVES, so the spec's own
    // schema judges it (objectui#10842), not the renderer-node mirror.
    expect(SpecAppSchema.safeParse(wizardDraftToAppSchema(DRAFT)).success).toBe(true);
  });
});

describe('objectui#10827 — CONTROL: the spec refuses the top-level key and accepts `branding.logo`', () => {
  it('spec `AppSchema` answers a top-level `logo` with `unrecognized_keys`', () => {
    const r = SpecAppSchema.safeParse({ name: 'acme_crm', label: 'Acme CRM', logo: '/acme.svg' });
    expect(r.success).toBe(false);
    expect(r.error!.issues.map((i) => i.code)).toEqual(['unrecognized_keys']);
  });

  it('spec `AppSchema` accepts the logo at `branding.logo`', () => {
    const r = SpecAppSchema.safeParse({ name: 'acme_crm', label: 'Acme CRM', branding: { logo: '/acme.svg' } });
    expect(r.success).toBe(true);
  });
});
