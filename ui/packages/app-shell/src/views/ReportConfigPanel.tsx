// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ReportConfigPanel — the runtime ReportView's right-rail "report editor".
 *
 * MIGRATED: this panel hosts the studio's spec-driven
 * {@link ReportDefaultInspector} instead of the legacy
 * `buildReportSchema` / `ConfigPanelRenderer` engine in `plugin-report`, so the
 * runtime and the metadata studio share ONE report-editing surface. The
 * inspector renders the report config fields straight from `@objectstack/spec`
 * (`reportForm` / `ReportSchema`) plus a curated type / dataset / values /
 * rows layer (ADR-0021 single-form).
 *
 * It lives in `app-shell` (next to the studio inspector) rather than in
 * `plugin-report`: `app-shell` depends on `plugin-report`, so hosting the
 * inspector here avoids the circular import a plugin-side panel would need.
 *
 * The Report document is FLAT (label / dataset / type / values / rows / … at
 * the top level), so — unlike the View migration — no shape adapter is
 * required: the report config IS the inspector draft. The dataset catalog
 * (binding options + measure/dimension pickers) loads through the shared
 * MetadataClient.
 *
 * Props mirror the legacy `plugin-report` panel so it is a drop-in replacement
 * for ReportView.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { Button } from '@object-ui/components';
import { useObjectTranslation } from '@object-ui/i18n';
import { X } from 'lucide-react';
import { ReportDefaultInspector } from './metadata-admin/inspectors/ReportDefaultInspector.js';
import { RuntimeDraftBar } from './RuntimeDraftBar.js';
import { useMetadataLocale } from './metadata-admin/i18n.js';

/** Field option shape the host (ReportView) already computes. */
interface AvailableField {
  value: string;
  label?: string;
  type?: string;
}

export interface ReportConfigPanelProps {
  /** Whether the panel is open. */
  open: boolean;
  /** Close callback. */
  onClose: () => void;
  /** The current report definition (flat spec Report document). */
  config: Record<string, any> | null;
  /**
   * Persist all draft changes. Any return is accepted; the panel awaits it and
   * reads one refusal signal (objectui#11583): `false` (returned, or resolved
   * by a promise) or a rejection leaves it open and dirty, with the edit in
   * place, so it can be saved again. Anything else, nothing included, is read
   * as saved: the dirty state clears and the panel closes. Typed `unknown` for
   * the reason `ViewConfigPanelProps.onSave` gives.
   */
  onSave: (config: Record<string, any>) => unknown;
  /** Called on every field change so the host can drive a live preview. */
  onFieldChange?: (key: string, value: any, draft?: Record<string, any>) => void;
  /**
   * Legacy field catalog for the pre-9.0 object-bound report editor. Kept for
   * prop compatibility; a 9.0 report binds a dataset, so the inspector now
   * sources its pickers from the dataset catalog instead.
   */
  availableFields?: AvailableField[];
  /** Reserved for parity with the legacy panel; unused by the inspector. */
  getFieldsForObject?: (objectName: string | undefined) => AvailableField[] | undefined;
  /** Report artifact name — the `:name` for the ADR-0034 draft/publish chrome. */
  name?: string;
  /**
   * Studio metadata client — drives the draft/publish chrome
   * ({@link RuntimeDraftBar}).
   */
  metadataClient?: any;
  /** Called after a publish / discard so the host can refresh its read. */
  onAfterChange?: () => void;
}

export function ReportConfigPanel({
  open,
  onClose,
  config,
  onSave,
  onFieldChange,
  name,
  metadataClient,
  onAfterChange,
}: ReportConfigPanelProps) {
  const { t } = useObjectTranslation();
  const locale = useMetadataLocale();
  // Unsaved-edits flag — gates Publish (mirrors studio's "save first").
  const [dirty, setDirty] = useState(false);
  // A save is in flight: Save is disabled and the inspector read-only until it
  // settles, so no edit lands in a window the save does not carry.
  const [saving, setSaving] = useState(false);

  // Draft state seeded from `config`. Rebuilt only when the source identity
  // changes (the host stabilizes `config` and bumps it on open / save) — never
  // on every live field change — so in-flight edits are not clobbered.
  const initialDraft = useMemo<Record<string, any>>(() => ({ ...(config ?? {}) }), [config]);
  const [draft, setDraft] = useState<Record<string, any>>(initialDraft);
  const draftRef = useRef(draft);
  const lastSourceRef = useRef(initialDraft);
  if (lastSourceRef.current !== initialDraft) {
    lastSourceRef.current = initialDraft;
    draftRef.current = initialDraft;
    setDraft(initialDraft);
    setDirty(false);
  }

  // Shallow-merge an inspector patch into the draft, then mirror each changed
  // field back to the host so the live preview reflects the edit.
  const handlePatch = useCallback((patch: Record<string, unknown>) => {
    const next = { ...draftRef.current, ...patch };
    draftRef.current = next;
    setDraft(next);
    setDirty(true);
    if (onFieldChange) {
      for (const [key, value] of Object.entries(patch)) {
        onFieldChange(key, value, next);
      }
    }
  }, [onFieldChange]);

  const handleSave = useCallback(async () => {
    // objectui#11583: the edit is reported as saved, and the panel closed,
    // only once the host says the save landed. A refused save keeps the panel
    // open and dirty with the edit in place, so Save can be pressed again.
    setSaving(true);
    let landed: boolean;
    try {
      landed = (await onSave(draftRef.current)) !== false;
    } catch {
      landed = false;
    } finally {
      setSaving(false);
    }
    if (!landed) return;
    setDirty(false);
    onClose();
  }, [onSave, onClose]);

  // ADR-0034 (#1515): resume a pending draft into the inspector on open
  // (flag-ON only). The report document IS the inspector draft, so seed it
  // directly.
  const handleResumeDraft = useCallback((body: Record<string, unknown>) => {
    const next = { ...body };
    draftRef.current = next;
    setDraft(next);
    setDirty(false);
  }, []);

  const handleDiscard = useCallback(() => {
    onClose();
  }, [onClose]);

  if (!open) return null;

  // The panel's name — its visible heading and the accessible name of the
  // `role="complementary"` landmark — is `report.editor.panelTitle`. It was
  // once `report.editor.title`, the label of the report's Title *field*, which
  // titled the panel "Title" and announced the landmark as "Title"
  // (objectui#4118). That key no longer exists: `report.editor` was cut to this
  // one key when the hand-rolled editor form it labelled was replaced by the
  // spec-driven inspector below (objectui#4145), so the wrong-slot borrow is
  // now unavailable rather than merely discouraged. Both slots keep the same
  // string on purpose, so the landmark's spoken name matches the heading a
  // sighted user reads.
  return (
    <aside
      className="hidden sm:flex w-[440px] shrink-0 flex-col border-l bg-background h-full"
      data-testid="report-config-panel"
      role="complementary"
      aria-label={t('report.editor.panelTitle', { defaultValue: 'Edit report' })}
    >
      <div className="flex items-center justify-between gap-2 border-b px-4 py-2.5 shrink-0">
        <div className="text-sm font-medium truncate">
          {t('report.editor.panelTitle', { defaultValue: 'Edit report' })}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          className="h-7 w-7 p-0"
          aria-label={t('common.close', { defaultValue: 'Close' })}
          data-testid="report-config-close"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <ReportDefaultInspector
          type="report"
          name={typeof draft.name === 'string' ? draft.name : ''}
          draft={draft}
          readOnly={saving}
          locale={locale}
          onPatch={handlePatch}
        />
      </div>

      <div
        data-testid="report-config-footer"
        className="flex items-center justify-end gap-2 border-t px-4 py-2.5 shrink-0"
      >
        <RuntimeDraftBar
          type="report"
          name={name}
          metadataClient={metadataClient}
          dirty={dirty}
          onResume={handleResumeDraft}
          onAfterChange={onAfterChange}
        />
        <Button variant="ghost" size="sm" onClick={handleDiscard} data-testid="report-config-discard">
          {t('common.cancel', { defaultValue: 'Cancel' })}
        </Button>
        <Button size="sm" onClick={handleSave} disabled={saving} data-testid="report-config-save">
          {t('common.save', { defaultValue: 'Save' })}
        </Button>
      </div>
    </aside>
  );
}
