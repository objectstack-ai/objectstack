// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Default Period select (`dateRange.defaultRange`) of the report and
 * dashboard authoring forms, named in the builder's language. Both forms
 * declare the same English-named options in the spec; both inspectors rename
 * them here, so the two selects read one set of words.
 */

import type { FormViewSpec } from './SchemaForm.js';
import type { FormFieldSpec } from './form-spec.js';
import type { SupportedLocale } from './i18n.js';
import { isZhLocale } from './schema-field-label.js';

/**
 * The console row the report and dashboard period chip reads for a Default
 * Period value (`ReportDateRange` in `@object-ui/plugin-report`): a preset's
 * `dashboard.filters.range.<preset>`, and `dashboard.filters.custom` for the
 * `custom` sentinel, which names no window.
 */
export function defaultPeriodLabelKey(value: string): string {
  return value === 'custom' ? 'dashboard.filters.custom' : `dashboard.filters.range.${value}`;
}

/**
 * The form with each Default Period option (`dateRange.defaultRange`) renamed
 * by `label(value, authored)`, where `authored` is the spec's English name.
 *
 * The spec form names the options in English; the `metadataForms` overlay
 * ({@link localizeMetadataForm}) translates a row's label and hint and has no
 * slot for option names. The words exist in the console's locale packs, where
 * the period chip reads them, so the builder picks a period in
 * the words a viewer sees it in. Returns the SAME form when it declares no such
 * options; otherwise copies only the spine it changes.
 */
export function withDefaultPeriodLabels(
  form: FormViewSpec | undefined,
  label: (value: string, authored: string) => string,
): FormViewSpec | undefined {
  if (!form?.sections) return form;
  const relabelChild = (child: string | FormFieldSpec): string | FormFieldSpec => {
    if (typeof child === 'string' || child.field !== 'defaultRange' || !Array.isArray(child.options)) return child;
    return {
      ...child,
      options: child.options.map((opt) => ({ ...opt, label: label(String(opt.value), String(opt.label ?? opt.value)) })),
    };
  };
  let changed = false;
  const sections = form.sections.map((section) => {
    if (!Array.isArray(section.fields)) return section;
    let sectionChanged = false;
    const fields = section.fields.map((field) => {
      if (typeof field === 'string' || field.field !== 'dateRange' || !Array.isArray(field.fields)) return field;
      const declared = field.fields;
      const children = declared.map(relabelChild);
      if (children.every((c, i) => c === declared[i])) return field;
      sectionChanged = true;
      return { ...field, fields: children };
    });
    if (!sectionChanged) return section;
    changed = true;
    return { ...section, fields };
  });
  return changed ? { ...form, sections } : form;
}

/**
 * The form a curated inspector renders, its Default Period options named for
 * `locale`. A zh designer reads the names from the console's locale packs
 * through `translate` (the app translator); every other designer locale keeps
 * the producer's English, like the rest of the panel. Returns the SAME form
 * when there is nothing to rename.
 */
export function localizeDefaultPeriods(
  form: FormViewSpec | undefined,
  locale: SupportedLocale | string | undefined,
  translate: (key: string, options: { defaultValue: string }) => string,
): FormViewSpec | undefined {
  if (!isZhLocale(locale)) return form;
  return withDefaultPeriodLabels(form, (value, authored) =>
    translate(defaultPeriodLabelKey(value), { defaultValue: authored }),
  );
}
