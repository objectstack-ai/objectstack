// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PageDefaultInspector — the curated "home" panel for a Page, shown as the
 * DEFAULT right panel (no block selection).
 *
 * An interface/list page (kanban / calendar / gallery / gantt board —
 * `type: 'list'` + `interfaceConfig.source`) has NO block tree, so the block
 * inspector (`PageBlockInspector`) never fires and the Interfaces-pillar panel
 * used to sit permanently on the "click a block" empty state — the config was
 * uneditable. This renders the spec-driven Page authoring form so the
 * `interfaceConfig` (source / columns / appearance.allowedVisualizations /
 * userActions / showRecordCount …) is editable from the panel, exactly as the
 * classic metadata-admin editor already allowed.
 *
 * SPEC-DRIVEN (mirrors {@link ReportDefaultInspector}): fields come from the
 * spec's canonical `pageForm` + Page JSONSchema fed into {@link SchemaForm};
 * the form's type-conditional `visibleWhen` sections surface the right fields per
 * page type, and server-only fields are grafted via {@link mergeServerFields}
 * so a newer server stays editable even when the bundled spec lags.
 */

import * as React from 'react';
import { SchemaForm } from '../SchemaForm.js';
import { getPageSchema, getPageForm, PAGE_FIELDS_OWNED_ELSEWHERE } from '../page-schema.js';
import { mergeServerFields } from '../mergeServerFields.js';
import type { MetadataDefaultInspectorProps } from '../default-inspector-registry.js';
import { t } from '../i18n.js';

export function PageDefaultInspector({
  draft,
  onPatch,
  readOnly,
  serverSchema,
  locale,
}: MetadataDefaultInspectorProps) {
  const { schema, form } = React.useMemo(
    () =>
      mergeServerFields({
        bundledSchema: getPageSchema(),
        bundledForm: getPageForm(),
        serverSchema,
        excludeFields: PAGE_FIELDS_OWNED_ELSEWHERE,
        sectionTitle: t('engine.inspector.moreFields', locale),
      }),
    [serverSchema, locale],
  );

  if (!schema) {
    return (
      <p className="px-1 py-2 text-xs text-muted-foreground">
        {t('engine.studio.inspector.noPageSchema', locale)}
      </p>
    );
  }

  return (
    <SchemaForm
      schema={schema}
      form={form}
      value={draft}
      hiddenFields={[...PAGE_FIELDS_OWNED_ELSEWHERE]}
      readOnly={readOnly}
      onChange={(next) => onPatch(next)}
    />
  );
}
