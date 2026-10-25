/**
 * Section headings on the create/edit form resolve the `_sections` translation
 * convention — the SAME lookup the record detail page uses.
 *
 * Convention (per `@objectstack/spec` `ObjectTranslationDataSchema`):
 *
 *     {ns}.objects.{objectName}._sections.{sectionName}.label
 *
 * resolved by `useObjectLabel().sectionLabel(objectName, sectionName, fallback)`
 * in `@object-ui/i18n`, falling back to the authored `label`.
 *
 * Both halves of the renderer call that one resolver:
 *   - detail page — `packages/plugin-detail/src/renderers/record-details.tsx`
 *     (`sectionLabel(objectName, s.name, rawTitle ?? s.name)`)
 *   - this form    — `ObjectForm.tsx` (`tSec`), `ModalForm.tsx` (`sectionTitle`)
 *
 * The behaviour existed but was pinned by NO test on the form side, so nothing
 * stopped the two halves from drifting apart again (objectstack#5408 was filed
 * believing they already had). These tests pin the form half, the fallback, and
 * — critically — that the KEY is the section's stable `name`, never a guess
 * derived from its authored label.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, renderHook } from '@testing-library/react';
import React from 'react';
import { createI18n, I18nProvider, useObjectLabel } from '@object-ui/i18n';
import { registerAllFields } from '@object-ui/fields';
import { ObjectForm } from '../ObjectForm';

registerAllFields();

const objectSchema = {
  name: 'crm_case',
  fields: {
    subject: { type: 'text', label: 'Subject' },
    priority: { type: 'text', label: 'Priority' },
  },
};

let dataSource: any;

beforeEach(() => {
  dataSource = {
    getObjectSchema: vi.fn().mockResolvedValue(objectSchema),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  };
});

/**
 * The runtime bundle shape `transformSpecTranslations` produces from authored
 * `objects.<obj>._sections.<key>.label` entries — `_sections` is preserved
 * verbatim under the object scope (pinned in
 * `packages/i18n/src/__tests__/spec-translations.test.ts`).
 *
 * `case_info` is translated; `sla` deliberately is NOT, so every render below
 * exercises the translated path and the authored-label fallback at once.
 */
const withSections = () =>
  createI18n({
    defaultLanguage: 'zh',
    detectBrowserLanguage: false,
    resources: {
      zh: {
        app: {
          objects: {
            crm_case: {
              label: '服务案例',
              _sections: { case_info: { label: '工单信息' } },
            },
          },
          fields: { crm_case: { subject: '主题' } },
        },
      },
    },
  });

/** Same object bundle, no `_sections` block at all. */
const withoutSections = () =>
  createI18n({
    defaultLanguage: 'zh',
    detectBrowserLanguage: false,
    resources: {
      zh: {
        app: {
          objects: { crm_case: { label: '服务案例' } },
          fields: { crm_case: { subject: '主题' } },
        },
      },
    },
  });

/** Sections authored the way the convention requires: a stable `name` + label. */
const NAMED_SECTIONS = [
  { name: 'case_info', label: 'Case Info', fields: ['subject'] },
  { name: 'sla', label: 'SLA', fields: ['priority'] },
];

const renderForm = (instance: any, schema: Record<string, unknown>) =>
  render(
    <I18nProvider instance={instance}>
      <ObjectForm
        schema={{
          type: 'object-form',
          objectName: 'crm_case',
          mode: 'create',
          ...schema,
        } as any}
        dataSource={dataSource}
      />
    </I18nProvider>,
  );

const tabLabels = async () => {
  await waitFor(() => expect(screen.getAllByRole('tab').length).toBeGreaterThan(0));
  return screen.getAllByRole('tab').map((el) => el.textContent);
};

describe('form section headings resolve `_sections` (objectstack#5408)', () => {
  it('page-mode tabbed form: the tab strip shows the translated heading', async () => {
    renderForm(withSections(), { formType: 'tabbed', sections: NAMED_SECTIONS });
    // `case_info` translated; `sla` has no key and keeps its authored label.
    expect(await tabLabels()).toEqual(['工单信息', 'SLA']);
  });

  it('modal-hosted tabbed form: the tab strip shows the translated heading', async () => {
    renderForm(withSections(), {
      formType: 'modal',
      open: true,
      contentLayout: 'tabbed',
      sections: NAMED_SECTIONS,
    });
    expect(await tabLabels()).toEqual(['工单信息', 'SLA']);
  });

  it('stacked (simple) sectioned form: the section divider heading is translated too', async () => {
    // The non-tabbed grouping heading goes through the same resolver, so a
    // `simple` form view's headings never diverge from its tabbed sibling.
    renderForm(withSections(), { formType: 'simple', sections: NAMED_SECTIONS });
    await waitFor(() => expect(screen.getByText('工单信息')).toBeTruthy());
    expect(screen.getByText('SLA')).toBeTruthy();
  });

  it('falls back to the authored label when the bundle carries no `_sections`', async () => {
    renderForm(withoutSections(), { formType: 'tabbed', sections: NAMED_SECTIONS });
    expect(await tabLabels()).toEqual(['Case Info', 'SLA']);
  });

  it('resolves through the same `sectionLabel` call the detail page uses (parity)', async () => {
    // Parity anchor: `useObjectLabel().sectionLabel` is the ONE resolver for
    // this convention, and `record-details.tsx` calls it with this exact
    // argument shape — `(objectName, section.name, authoredLabel)`. Asserting
    // the rendered tab text equals what that call returns is what keeps the
    // form half from drifting away from the detail half again.
    const instance = withSections();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <I18nProvider instance={instance}>{children}</I18nProvider>
    );
    const { result } = renderHook(() => useObjectLabel(), { wrapper });
    const viaResolver = NAMED_SECTIONS.map((s) =>
      result.current.sectionLabel('crm_case', s.name, s.label),
    );

    renderForm(instance, { formType: 'tabbed', sections: NAMED_SECTIONS });
    expect(await tabLabels()).toEqual(viaResolver);
  });

  it('keys off the section `name` only — a nameless section is not guessed at', async () => {
    // Contract pin (AGENTS.md #0.1). A form view whose sections declare only a
    // `label` gives the renderer no key: `_sections` is keyed by section NAME,
    // so the authored English label is the correct output — the renderer must
    // not slugify the label and go fishing for a second de-facto key. This is
    // exactly the shape that produced the objectstack#5408 field report
    // (hotcrm `src/views/case.view.ts` authors `{ label: 'Case' }` with no
    // `name`, while its `_sections` bundle is keyed `basic`/`sla`/`resolution`)
    // — a metadata gap at the producer, not a renderer gap.
    const instance = createI18n({
      defaultLanguage: 'zh',
      detectBrowserLanguage: false,
      resources: {
        zh: {
          app: {
            objects: {
              crm_case: {
                label: '服务案例',
                // Keyed plausibly-but-differently from the authored labels.
                _sections: { case: { label: '工单信息' }, sla: { label: 'SLA 与优先级' } },
              },
            },
            fields: { crm_case: { subject: '主题' } },
          },
        },
      },
    });
    renderForm(instance, {
      formType: 'tabbed',
      sections: [
        { label: 'Case', fields: ['subject'] },
        { label: 'SLA', fields: ['priority'] },
      ],
    });
    expect(await tabLabels()).toEqual(['Case', 'SLA']);
  });
});
