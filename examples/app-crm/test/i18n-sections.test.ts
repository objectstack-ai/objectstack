// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
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
 * container, every section any of its `formViews` declares must (a) carry a
 * `name` and (b) resolve to a REAL zh-CN `_sections.<name>.label` — non-empty
 * and not an echoed English string.
 *
 * Read on the COMPOSED stack (`objectstack.config.ts`'s `views`/`translations`
 * arrays), not the imported view/bundle modules directly — what the platform's
 * i18n resolver and lint gates see is the composed stack, which is exactly the
 * reachability this issue is about.
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
    formViews?: Record<string, FormView>;
  }

  const containers = (stack.views ?? []) as ViewContainer[];

  for (const container of containers) {
    const containerObject = container.list?.data?.object;
    if (typeof containerObject !== 'string') continue;
    const formViews = container.formViews ?? {};

    for (const [viewKey, formView] of Object.entries(formViews)) {
      const sections = Array.isArray(formView.sections) ? formView.sections : [];
      if (sections.length === 0) continue;
      const objectName = typeof formView.data?.object === 'string' ? formView.data.object : containerObject;

      sections.forEach((section, i) => {
        const label = typeof section.label === 'string' ? section.label : '(untitled)';
        it(`${objectName} · formViews.${viewKey} · section "${label}" declares a name and resolves in zh-CN`, () => {
          expect(
            typeof section.name === 'string' && section.name.length > 0,
            `${objectName}.formViews.${viewKey}.sections[${i}] ("${label}") has no \`name\` — ` +
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

  it('exercised at least one container with named sections (guards against a vacuous sweep)', () => {
    const total = containers.reduce(
      (n, c) =>
        n +
        Object.values(c.formViews ?? {}).reduce(
          (m, fv) => m + (Array.isArray(fv.sections) ? fv.sections.length : 0),
          0,
        ),
      0,
    );
    expect(total).toBeGreaterThanOrEqual(9);
  });
});
