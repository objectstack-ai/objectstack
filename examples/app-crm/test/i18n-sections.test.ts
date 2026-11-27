// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { deriveFieldGroupLayout } from '@objectstack/spec/data';
import stack from '../objectstack.config.js';

/**
 * #8231 — a form section can silence `translation-section-name-missing`
 * completely just by getting a `name`, with ZERO translation delivered: the
 * bundle simply never gains a matching `_sections.<name>` entry, and the
 * heading keeps rendering in the source locale in every locale. Naming the
 * section is necessary but not sufficient.
 *
 * This is the `examples/app-showcase/test/seed.test.ts` "keys the contact
 * form sections to exactly what the container declares" harness, generalized
 * to every CRM view container instead of one hand-picked object: for each
 * container, every section its default `form` or any of its `formViews`
 * declares must (a) carry a `name` and (b) resolve to a REAL zh-CN
 * `_sections.<name>.label` — non-empty and not an echoed English string.
 *
 * The object's create and edit forms are laid out by its `fieldGroups`, not by
 * a form view (#36425), and a group heading resolves through the same
 * `_sections.<key>` entry. So the sweep also covers every titled section
 * `deriveFieldGroupLayout` (ADR-0085 §5, the derivation the renderers read)
 * gives each object: the default forms the lead, opportunity and activity once
 * declared moved there (#36553), and their headings must stay translated.
 *
 * Read on the COMPOSED stack (`objectstack.config.ts`'s `objects`/`views`/
 * `translations` arrays), not the imported modules directly — what the
 * platform's i18n resolver and lint gates see is the composed stack, which is
 * exactly the reachability this issue is about.
 */
describe('app-crm form section i18n coverage (#8231)', () => {
  const zhBundle = (stack.translations ?? [])[0] as
    | { 'zh-CN'?: { objects?: Record<string, { _sections?: Record<string, { label?: string }> }> } }
    | undefined;

  interface FormSection {
    name?: unknown;
    label?: unknown;
  }
  interface FormView {
    data?: { object?: unknown };
    sections?: FormSection[];
  }
  interface ViewContainer {
    list?: { data?: { object?: unknown } };
    form?: FormView;
    formViews?: Record<string, FormView>;
  }

  const containers = (stack.views ?? []) as ViewContainer[];

  for (const container of containers) {
    const containerObject = container.list?.data?.object;
    if (typeof containerObject !== 'string') continue;
    // The default `form` and every named form, each under its container key.
    const forms = Object.entries(container.formViews ?? {}).map(
      ([k, v]): [string, FormView] => [`formViews.${k}`, v],
    );
    if (container.form) forms.unshift(['form', container.form]);

    for (const [viewKey, formView] of forms) {
      const sections = Array.isArray(formView.sections) ? formView.sections : [];
      if (sections.length === 0) continue;
      const objectName = typeof formView.data?.object === 'string' ? formView.data.object : containerObject;

      sections.forEach((section, i) => {
        const label = typeof section.label === 'string' ? section.label : '(untitled)';
        it(`${objectName} · ${viewKey} · section "${label}" declares a name and resolves in zh-CN`, () => {
          expect(
            typeof section.name === 'string' && section.name.length > 0,
            `${objectName}.${viewKey}.sections[${i}] ("${label}") has no \`name\` — ` +
              'it can never be translated (translation-section-name-missing).',
          ).toBe(true);
          const name = section.name as string;

          const zhLabel = zhBundle?.['zh-CN']?.objects?.[objectName]?._sections?.[name]?.label;
          expect(
            zhLabel,
            `objects.${objectName}._sections.${name}.label is missing from the zh-CN bundle — ` +
              'the section has a name but no real translation.',
          ).toBeTruthy();
          // An echoed English label (or anything ASCII-only) is not a real
          // zh-CN translation — it satisfies the key set while faking coverage.
          expect(zhLabel, `zh-CN _sections.${name}.label reads as untranslated ASCII`).not.toMatch(
            /^[\x20-\x7e]+$/,
          );
        });
      });
    }
  }

  const objects = (stack.objects ?? []) as Array<{ name: string }>;
  /** Every titled section an object's field groups give its forms and record page. */
  const groupSections = objects.flatMap((object) =>
    (deriveFieldGroupLayout(object) ?? [])
      .filter((s): s is typeof s & { key: string } => typeof s.key === 'string')
      .map((s) => ({ objectName: object.name, key: s.key, label: s.label ?? s.key })),
  );

  for (const { objectName, key, label } of groupSections) {
    it(`${objectName} · fieldGroups · section "${label}" resolves in zh-CN`, () => {
      const zhLabel = zhBundle?.['zh-CN']?.objects?.[objectName]?._sections?.[key]?.label;
      expect(
        zhLabel,
        `objects.${objectName}._sections.${key}.label is missing from the zh-CN bundle — ` +
          'the group heading renders in English in every locale.',
      ).toBeTruthy();
      expect(zhLabel, `zh-CN _sections.${key}.label reads as untranslated ASCII`).not.toMatch(
        /^[\x20-\x7e]+$/,
      );
    });
  }

  it('exercised the named sections the app declares (guards against a vacuous sweep)', () => {
    const formSections = containers.reduce(
      (n, c) =>
        n +
        [...(c.form ? [c.form] : []), ...Object.values(c.formViews ?? {})].reduce(
          (m, fv) => m + (Array.isArray(fv.sections) ? fv.sections.length : 0),
          0,
        ),
      0,
    );
    // Web-to-Lead's one section, and the ten field-group headings of the
    // account (2), opportunity (1), lead (4) and activity (3) objects. Each
    // sweep is held separately, so one cannot cover for the other shrinking.
    expect(formSections).toBeGreaterThanOrEqual(1);
    expect(groupSections.length).toBeGreaterThanOrEqual(10);
    // The three objects whose default forms became field groups (#36553).
    for (const objectName of ['crm_lead', 'crm_opportunity', 'crm_activity']) {
      expect(groupSections.some((s) => s.objectName === objectName), objectName).toBe(true);
    }
  });
});
