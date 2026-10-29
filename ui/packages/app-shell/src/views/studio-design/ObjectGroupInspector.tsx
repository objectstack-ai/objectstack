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
import { readFields, readGroups, updateGroup } from '../metadata-admin/previews/object-fields-io.js';
import { t } from '../metadata-admin/i18n.js';
import {
  acceptRelatedListEntries,
  relationshipEntry,
  relationshipLabel,
  relationshipsNamedBy,
  useRelatedListCatalog,
} from './relatedListVocabulary.js';

export interface ObjectGroupInspectorProps {
  /** Object metadata draft (reads `fieldGroups`, and `fields` for a group's members). */
  draft: Record<string, unknown>;
  /** The object's name — the parent a placed related table's relationship points at. */
  objectName?: string;
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
  objectName,
  groupKey,
  onPatch,
  onClose,
  readOnly = false,
  locale,
}: ObjectGroupInspectorProps): React.ReactElement {
  const tr = React.useCallback((key: string) => t(key, locale), [locale]);
  const groups = React.useMemo(() => readGroups(draft.fieldGroups), [draft.fieldGroups]);
  const group = groups.find((g) => g.key === groupKey);
  const parentName = objectName || (typeof draft.name === 'string' ? draft.name : '');
  const { relationships, ready } = useRelatedListCatalog(parentName, draft);
  const memberCount = React.useMemo(
    () => readFields(draft.fields).entries.filter((e) => e.def.group === groupKey).length,
    [draft.fields, groupKey],
  );

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
      <RelatedTablePlacement
        groups={groups}
        group={group}
        relationships={relationships}
        ready={ready}
        memberCount={memberCount}
        onPatch={onPatch}
        readOnly={readOnly}
        tr={tr}
      />
    </InspectorShell>
  );
}

/**
 * objectstack#27069 — a field group may stand for a related list's BODY TABLE
 * instead of a section of fields: `relatedList` names one inbound relationship
 * (the vocabulary the object's `relatedLists` editor uses) and the record page
 * draws that table at the group's position in the details column.
 *
 * What the picker can write is held to what the spec accepts:
 *  - only inbound relationships are offered, and a pick is checked against
 *    them before it is written (a name matching none is refused at
 *    `defineStack` and by the publish door's lint);
 *  - a group that still holds fields cannot be made a table (the object parse
 *    refuses a field whose group is a table group), so the picker is withheld
 *    until its fields move elsewhere;
 *  - a relationship another group already places is not offered again.
 */
function RelatedTablePlacement({
  groups,
  group,
  relationships,
  ready,
  memberCount,
  onPatch,
  readOnly,
  tr,
}: {
  groups: ReturnType<typeof readGroups>;
  group: ReturnType<typeof readGroups>[number];
  relationships: ReturnType<typeof useRelatedListCatalog>['relationships'];
  ready: boolean;
  memberCount: number;
  onPatch: (patch: Record<string, unknown>) => void;
  readOnly: boolean;
  tr: (key: string) => string;
}): React.ReactElement {
  const current = typeof group.relatedList === 'string' ? group.relatedList : '';
  const placedElsewhere = new Set(
    groups
      .filter((g) => g.key !== group.key && typeof g.relatedList === 'string')
      .flatMap((g) => relationshipsNamedBy(g.relatedList as string, relationships)),
  );
  const options = relationships
    .filter((r) => !placedElsewhere.has(r) || relationshipsNamedBy(current, relationships).includes(r))
    .map((r) => {
      const entry = relationshipEntry(r, relationships);
      return { value: entry, label: `${relationshipLabel(r)} (${entry})` };
    });
  const blockedByFields = memberCount > 0;
  const commit = (v: string) => {
    if (!v) {
      onPatch({ fieldGroups: updateGroup(groups, group.key, { relatedList: undefined }) });
      return;
    }
    // The pre-write check, shared with the relatedLists editor.
    if (blockedByFields || acceptRelatedListEntries([v], relationships).length === 0) return;
    onPatch({ fieldGroups: updateGroup(groups, group.key, { relatedList: v }) });
  };
  return (
    <div className="space-y-1" data-testid="group-related-table">
      <InspectorSelectField
        label={tr('engine.studio.designer.group.relatedListLabel')}
        value={current}
        onCommit={commit}
        disabled={readOnly || !ready || (blockedByFields && !current)}
        options={[{ value: '', label: tr('engine.studio.designer.group.relatedListNone') }, ...options]}
      />
      <p className="text-[11px] leading-4 text-muted-foreground" data-testid="group-related-table-hint">
        {!ready
          ? tr('engine.studio.designer.group.relatedListLoading')
          : blockedByFields
            ? tr('engine.studio.designer.group.relatedListHasFields')
            : tr('engine.studio.designer.group.relatedListHint')}
      </p>
    </div>
  );
}
