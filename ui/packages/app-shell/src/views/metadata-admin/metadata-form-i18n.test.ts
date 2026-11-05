// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#7254 — the dashboard property panel was an all-English island
 * inside a Chinese Studio.
 *
 * The panel is spec-driven on purpose (`dashboardForm` from
 * `@objectstack/spec/ui` fed straight into SchemaForm), and the spec authors
 * its copy in English, so every section heading, field label and hint reached
 * the author untranslated — including "Grid gap (Tailwind units)", a unit only
 * a developer can act on.
 *
 * These pins assert the OVERLAY, and specifically the two things a hand-rolled
 * walker would have got wrong and a shape-only test would not have noticed:
 * the section key is the SLUGGED label (not the label text), and a `composite`
 * field's sub-rows are synthesized from the bundle — completely, or the ones
 * left out vanish from the form.
 */
import { describe, expect, it } from 'vitest';
import { dashboardForm } from '@objectstack/spec/ui';
import { localizeMetadataForm, hasMetadataFormOverlay } from './metadata-form-i18n';
import { getDashboardForm } from './dashboard-schema';
import { METADATA_FORM_REGISTRY } from '@objectstack/spec/system';
import { getViewForm } from './view-schema';
import { getPageForm } from './page-schema';
import { getReportForm } from './report-schema';
import { formKeyLabel } from '../../preview/changeKeyLabels';

/** The two form shapes these assertions read. `unknown` everywhere else. */
interface FormField {
  field?: string;
  type?: string;
  label?: string;
  helpText?: string;
  fields?: FormField[];
}
interface Section {
  label?: string;
  description?: string;
  fields?: FormField[];
}

function sections(form: unknown): Section[] {
  return ((form as { sections?: Section[] } | undefined)?.sections ?? []) as Section[];
}

function fieldByName(form: unknown, name: string): FormField | undefined {
  for (const s of sections(form)) {
    for (const f of s.fields ?? []) {
      if (f?.field === name) return f;
    }
  }
  return undefined;
}

describe('localizeMetadataForm — the spec form, in the author’s language', () => {
  it('has an overlay for `dashboard` at zh and none at en', () => {
    expect(hasMetadataFormOverlay('dashboard', 'zh-CN')).toBe(true);
    expect(hasMetadataFormOverlay('dashboard', 'en-US')).toBe(false);
  });

  it('leaves the form untouched (same object) outside zh', () => {
    const form = dashboardForm as unknown as Record<string, unknown>;
    expect(localizeMetadataForm(form, 'dashboard', 'en-US')).toBe(form);
  });

  it('leaves a type the overlay does not carry untouched', () => {
    const form = dashboardForm as unknown as Record<string, unknown>;
    // `job` is no `METADATA_FORM_REGISTRY` type, so the overlay names no row for it.
    expect(localizeMetadataForm(form, 'job', 'zh-CN')).toBe(form);
  });

  it('translates section headings — addressed by the SLUGGED label, not the label text', () => {
    const zh = localizeMetadataForm(
      dashboardForm as unknown as Record<string, unknown>,
      'dashboard',
      'zh-CN',
    );
    const labels = sections(zh).map((s) => s.label);
    expect(labels).toContain('布局'); // 'Layout' → section key `layout`
    expect(labels).toContain('筛选'); // 'Filters' → `filters`
    expect(labels).not.toContain('Layout');
    const layout = sections(zh).find((s) => s.label === '布局');
    expect(layout?.description).toBe('栅格尺寸与刷新频率。');
    expect(layout?.description).not.toMatch(/refresh cadence/);
  });

  it('translates the layout field labels and hints the card named', () => {
    const zh = localizeMetadataForm(
      dashboardForm as unknown as Record<string, unknown>,
      'dashboard',
      'zh-CN',
    );
    expect(fieldByName(zh, 'columns')).toMatchObject({ label: '列数', helpText: '栅格列数（默认 12）' });
    expect(fieldByName(zh, 'refreshIntervalSeconds')?.label).toBe('自动刷新');
    expect(fieldByName(zh, 'header')?.label).toBe('页眉');
  });

  it('drops the "Tailwind units" developer vocabulary rather than transliterating it', () => {
    const zh = localizeMetadataForm(
      dashboardForm as unknown as Record<string, unknown>,
      'dashboard',
      'zh-CN',
    );
    const gap = fieldByName(zh, 'gap');
    expect(gap?.label).toBe('间距');

    // ⚠️ THE CONTROL IS NOT A SENTENCE PIN, and it used to be one. This asserted
    // that the English producer copy still said "Tailwind" — true while the spec
    // shipped `Grid gap (Tailwind units)`, and false from @objectstack/spec
    // 17.4.0, which rewrote it to "Space between widgets, in steps of 0.25rem
    // (4 = 1rem)" (objectui#8785). The producer was right to fix its own copy;
    // the pin was wrong to name a sentence it does not own, and re-pointing it
    // at the new sentence would buy exactly one release before rotting again.
    //
    // What this test actually claims is narrower and durable: the overlay hands
    // the author text they can act on, where the producer's copy reaches for
    // DEVELOPER vocabulary — a framework name, a CSS unit — to say the same
    // thing. So the control asserts the English carries some of that vocabulary
    // and the zh carries none of it. It stays non-vacuous (the English leg must
    // fire for the zh leg to mean anything) without pinning any one wording, and
    // if the spec ever writes this hint in plain author language the control
    // reddens and someone re-reads the overlay — which is the correct outcome,
    // not a false alarm: the overlay would have nothing left to do here.
    // A framework name, or a CSS length written as an author never would —
    // digits welded to a unit. ⚠️ `\brem\b` does NOT work here: the boundary
    // before `rem` never matches in `0.25rem`, because `5` is a word character.
    const DEVELOPER_UNITS = /tailwind|\d\s*(rem|px)\b/i;
    expect(fieldByName(dashboardForm, 'gap')?.helpText).toMatch(DEVELOPER_UNITS);
    expect(gap?.helpText).not.toMatch(DEVELOPER_UNITS);
  });

  it('synthesizes ALL of the `header` composite’s sub-rows — a partial list would hide the rest', () => {
    const zh = localizeMetadataForm(
      dashboardForm as unknown as Record<string, unknown>,
      'dashboard',
      'zh-CN',
    );
    const header = fieldByName(zh, 'header');
    expect(header?.type).toBe('composite');
    const children = (header?.fields ?? []).map((f) => f.field);
    // Exactly `DashboardHeaderSchema`'s three properties. SchemaForm prefers a
    // declared `fields` array over the schema-derived one, so anything absent
    // here would disappear from the panel.
    expect(children.sort()).toEqual(['actions', 'showDescription', 'showTitle']);
    const byName = new Map((header!.fields ?? []).map((f) => [f.field, f]));
    expect(byName.get('showTitle')?.label).toBe('显示标题');
    expect(byName.get('showTitle')?.helpText).toBe('在页眉中显示仪表盘名称');
    expect(byName.get('showDescription')?.label).toBe('显示描述');
    expect(byName.get('actions')?.label).toBe('操作按钮');
  });
});

describe('getDashboardForm — the overlay reaches the panel, and caches per locale', () => {
  it('serves the spec’s English by default and Chinese to a zh console', () => {
    const en = getDashboardForm('en-US');
    const zh = getDashboardForm('zh-CN');
    expect(sections(en).map((s) => s.label)).toContain('Layout');
    expect(sections(zh).map((s) => s.label)).toContain('布局');
  });

  it('does not serve one locale’s copy to another (the single-slot cache bug)', () => {
    // Order matters: ask for zh first, then en. A single memo slot would hand
    // the Chinese form to the English console.
    expect(sections(getDashboardForm('zh-CN')).map((s) => s.label)).toContain('布局');
    expect(sections(getDashboardForm('en-US')).map((s) => s.label)).toContain('Layout');
    expect(sections(getDashboardForm('en-US')).map((s) => s.label)).not.toContain('布局');
  });

  it('is stable per locale', () => {
    expect(getDashboardForm('zh-CN')).toBe(getDashboardForm('zh-CN'));
  });

  it('still prunes the fields the curated inspector owns', () => {
    const zh = getDashboardForm('zh-CN');
    for (const owned of ['name', 'label', 'description', 'widgets']) {
      expect(fieldByName(zh, owned)).toBeUndefined();
    }
  });
});

describe('every form type Studio renders reads in zh-CN (objectstack#30039)', () => {
  const registryTypes = Object.keys(METADATA_FORM_REGISTRY);
  const registryForm = (type: string) => METADATA_FORM_REGISTRY[type] as unknown as Record<string, unknown>;

  it('carries a zh-CN overlay for every METADATA_FORM_REGISTRY type, and none at en', () => {
    expect(registryTypes.length).toBeGreaterThan(10);
    for (const type of registryTypes) {
      expect(hasMetadataFormOverlay(type, 'zh-CN'), type).toBe(true);
      expect(hasMetadataFormOverlay(type, 'en-US'), type).toBe(false);
    }
  });

  it('the view properties panel: section headings, hints and schema-titled rows read in Chinese', () => {
    const zh = getViewForm('zh-CN');
    const labels = sections(zh).map((s) => s.label);
    expect(labels).toContain('基础信息');
    expect(labels).toContain('列与筛选');
    for (const english of ['Basics', 'Columns & filters', 'Table options', 'End-user controls', 'Navigation & sharing']) {
      expect(labels).not.toContain(english);
    }
    expect(sections(zh).find((s) => s.label === '基础信息')?.description).toBe('标识与主显示形态');
    expect(fieldByName(zh, 'searchableFields')?.label).toBe('可搜索字段');
    expect(fieldByName(zh, 'description')?.label).toBe('描述');
  });

  it('an English console reads the spec English, the same object every time — the control', () => {
    const en = getViewForm('en');
    expect(en).toBe(getViewForm('en'));
    expect(sections(en).map((s) => s.label)).toContain('Basics');
    expect(fieldByName(en, 'searchableFields')?.label).toBeUndefined();
  });

  it('the page and report panels read in Chinese too', () => {
    expect(sections(getPageForm('zh-CN')).map((s) => s.label)).toContain('基础信息');
    expect(sections(getPageForm('zh-CN')).map((s) => s.label)).not.toContain('Basics');
    expect(sections(getReportForm('zh-CN')).map((s) => s.label)).toContain('基础信息');
  });

  it('a composite the form declares no sub-fields for gets none synthesized from the overlay', () => {
    // The ⛔ composite rule, mechanically: naming a child of such a field would
    // make the form show only the named children.
    for (const type of registryTypes) {
      const zh = localizeMetadataForm(registryForm(type), type, 'zh-CN');
      const walk = (before: FormField[] = [], after: FormField[] = []) => {
        before.forEach((f, i) => {
          if (typeof f !== 'object' || !f) return;
          if (!Array.isArray(f.fields)) expect(after[i]?.fields, `${type}.${f.field}`).toBeUndefined();
          else walk(f.fields, after[i]?.fields);
        });
      };
      sections(registryForm(type)).forEach((s, i) => walk(s.fields, sections(zh)[i]?.fields));
    }
  });

  it('the publish sheet names a changed flow property in Chinese: Status → 状态', () => {
    expect(formKeyLabel('flow', 'status', 'zh-CN')).toBe('状态');
    expect(formKeyLabel('flow', 'status', 'en')).toBe('Status');
  });

  it('no zh-CN form row calls a dashboard 仪表板: the one word is 仪表盘', () => {
    const text = JSON.stringify(registryTypes.map((type) => localizeMetadataForm(registryForm(type), type, 'zh-CN')));
    expect(text).not.toContain('仪表板');
    expect(text).toContain('仪表盘');
  });
});
