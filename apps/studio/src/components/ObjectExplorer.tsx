// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ObjectExplorer — Airtable-style canvas for an `object` metadata item.
 *
 * Controlled component: the active panel (records / fields / api) is
 * driven by the `mode` prop from {@link PluginHost}. This component
 * intentionally has **no** internal tab strip — PluginHost's mode
 * switcher is the single source of truth so the page only ever shows
 * one row of mode buttons.
 *
 * Mode mapping (see `object-plugin.tsx`):
 *   - `data`   → records grid (default landing; Airtable-style)
 *   - `design` → field/schema editor
 *   - `code`   → REST API console
 */

import { useState } from 'react';
import type { ViewMode } from '@objectstack/spec/studio';
import { ObjectDataTable } from './ObjectDataTable';
import { ObjectSchemaInspector } from './ObjectSchemaInspector';
import { ObjectDataForm } from './ObjectDataForm';
import { ObjectApiConsole } from './ObjectApiConsole';

interface ObjectExplorerProps {
  objectApiName: string;
  /** Active panel, driven by PluginHost. Falls back to records grid. */
  mode?: ViewMode;
}

export function ObjectExplorer({ objectApiName, mode = 'data' }: ObjectExplorerProps) {
  const [editingRecord, setEditingRecord] = useState<any>(null);
  const [showForm, setShowForm] = useState(false);
  // Refresh trigger: increment this to force data table to refetch
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  function handleEdit(record: any) {
    setEditingRecord(record);
    setShowForm(true);
  }

  function handleFormSuccess() {
    setShowForm(false);
    setEditingRecord(null);
    setRefreshTrigger((prev) => prev + 1);
  }

  // Resolve the active panel from the mode prop. Anything that isn't a
  // first-class object mode lands on the records grid so the user always
  // sees data first.
  const panel = mode === 'design' ? 'design' : mode === 'code' ? 'code' : 'data';

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex-1 overflow-auto">
        {panel === 'data' && (
          <ObjectDataTable
            objectApiName={objectApiName}
            onEdit={handleEdit}
            refreshTrigger={refreshTrigger}
          />
        )}
        {panel === 'design' && <ObjectSchemaInspector objectApiName={objectApiName} />}
        {panel === 'code' && <ObjectApiConsole objectApiName={objectApiName} />}
      </div>

      {showForm && (
        <ObjectDataForm
          objectApiName={objectApiName}
          record={editingRecord && Object.keys(editingRecord).length > 0 ? editingRecord : undefined}
          onSuccess={handleFormSuccess}
          onCancel={() => {
            setShowForm(false);
            setEditingRecord(null);
          }}
        />
      )}
    </div>
  );
}
