// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ObjectGroupInspector — the right-rail property panel for a **field group**
 * (section) selected in the Studio Data → Form → Layout designer.
 *
 * Fields open the shared `ObjectFieldInspector`; groups had no inspector at all
 * (they could only be renamed inline in the designer). This panel gives a group
 * its own selection target, exposing the properties the form renderer actually
 * consumes: the group's **label** and its **collapse behaviour** (the
 * spec-canonical `collapse` enum that `@objectstack/spec`'s
 * `deriveFieldGroupLayout` reads). `icon`/`description` exist on the spec but no
 * renderer consumes them yet, so — per the repo's "no dead metadata" rule — they
 * are preserved on round-trip but not surfaced as editable controls here.
 *
 * Persistence mirrors the field inspector: edits are a shallow `fieldGroups`
 * patch through the pillar's existing draft → publish (`onPatch`).
 */

import * as React from 'react';
import {
  InspectorShell,
  InspectorTextField,
  InspectorSelectField,
  InspectorEmptyState,
} from '../metadata-admin/inspectors/_shared.js';
import { readGroups, updateGroup } from '../metadata-admin/previews/object-fields-io.js';
import { t } from '../metadata-admin/i18n.js';

export interface ObjectGroupInspectorProps {
  /** Object metadata draft (reads `fieldGroups`). */
  draft: Record<string, unknown>;
  /** Key of the selected field group. */
  groupKey: string;
  /** Persist a partial object-draft patch (fieldGroups) + mark dirty. */
  onPatch: (patch: Record<string, unknown>) => void;
  /** Clear the selection (closes the panel). */
  onClose: () => void;
  /** Courtesy gate: panel stays viewable but controls are disabled. */
  readOnly?: boolean;
  locale?: string;
}

type CollapseMode = 'none' | 'expanded' | 'collapsed';

export function ObjectGroupInspector({
  draft,
  groupKey,
  onPatch,
  onClose,
  readOnly = false,
  locale,
}: ObjectGroupInspectorProps): React.ReactElement {
  const tr = React.useCallback((key: string) => t(key, locale), [locale]);
  const groups = React.useMemo(() => readGroups(draft.fieldGroups), [draft.fieldGroups]);
  const group = groups.find((g) => g.key === groupKey);

  if (!group) {
    return (
      <InspectorShell
        kindLabel={tr('engine.studio.designer.group.kind')}
        title={groupKey}
        onClose={onClose}
        closeLabel={tr('engine.studio.close')}
      >
        <InspectorEmptyState message={tr('engine.studio.designer.group.missing')} />
      </InspectorShell>
    );
  }

  // Current collapse mode, tolerant of the legacy boolean aliases so a group
  // authored with `collapsed: true` (no `collapse`) still shows correctly.
  const mode: CollapseMode =
    group.collapse ?? (group.collapsed ? 'collapsed' : group.collapsible ? 'expanded' : 'none');

  const setMode = (next: CollapseMode) =>
    onPatch({
      fieldGroups: updateGroup(groups, group.key, {
        // 'none' is the spec default → drop the key entirely to keep metadata
        // clean; otherwise write the canonical enum and drop the legacy aliases
        // so there is exactly one source of truth.
        collapse: next === 'none' ? undefined : next,
        collapsible: undefined,
        collapsed: undefined,
        defaultExpanded: undefined,
      }),
    });

  return (
    <InspectorShell
      kindLabel={tr('engine.studio.designer.group.kind')}
      title={group.label || group.key}
      onClose={onClose}
      closeLabel={tr('engine.studio.close')}
    >
      <InspectorTextField
        label={tr('engine.studio.designer.group.nameLabel')}
        value={group.label}
        onCommit={(v) => onPatch({ fieldGroups: updateGroup(groups, group.key, { label: v }) })}
        disabled={readOnly}
        testId="group-label"
      />
      <InspectorSelectField
        label={tr('engine.studio.designer.group.collapseLabel')}
        value={mode}
        onCommit={(v) => setMode((v || 'none') as CollapseMode)}
        disabled={readOnly}
        options={[
          { value: 'none', label: tr('engine.studio.designer.group.collapseNone') },
          { value: 'expanded', label: tr('engine.studio.designer.group.collapseExpanded') },
          { value: 'collapsed', label: tr('engine.studio.designer.group.collapseCollapsed') },
        ]}
      />
      <p className="text-[11px] leading-4 text-muted-foreground">
        {tr('engine.studio.designer.group.collapseHint')}
      </p>
    </InspectorShell>
  );
}
