/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from 'react';
import { useState } from 'react';
import { X, Save, RotateCcw, ChevronRight, Undo2, Redo2 } from 'lucide-react';
import { createSafeTranslation } from '@object-ui/i18n';

import { cn } from '../lib/utils';
import { Button } from '../ui/button';
import { Separator } from '../ui/separator';
import { SectionHeader } from './section-header';
import { ConfigFieldRenderer } from './config-field-renderer';
import type { ConfigPanelSchema } from '../types/config-panel';

/**
 * The footer's own copy — objectui#4750.
 *
 * `saveLabel` / `discardLabel` used to carry the English literals `'Save'` and
 * `'Discard'` as PARAMETER DEFAULTS, and no caller in the repo passes either
 * prop. So the sticky footer that appears the moment a config draft is dirty
 * said `Save` / `Discard` in every locale, inside panels whose every other
 * string (breadcrumb, sections, field labels — objectui#4748) translates. The
 * fix belongs here rather than in each panel: the footer is the RENDERER's own
 * chrome, so a per-caller fix would translate one panel's footer and leave the
 * next one's English.
 *
 * ## Mechanism: `createSafeTranslation`, the one this package already uses
 *
 * Measured, not chosen: `form.tsx`, `fullscreen-editor.tsx`,
 * `data-table.tsx`, `containers.tsx`,
 * `filter-builder.tsx`, `sort-builder.tsx`, `navigation-overlay.tsx` and
 * `lib/close-label.tsx` all reach their built-in copy through a
 * `createSafeTranslation` defaults map. The safe hook rather than a bare
 * `useObjectTranslation` because this primitive has provider-less consumers —
 * embedded hosts, the preview gallery, and this package's own bare-render
 * tests — where the bare hook returns the raw KEY.
 *
 * ## Keys: `common.save` reused, `common.discard` added
 *
 * `common.save` already ships `Save` in all ten packs and is what the console's
 * other save buttons read (`app-shell`'s `ReportConfigPanel` footer,
 * `plugin-view`'s `ManageViewsDialog`), so a `configPanel.save` twin would be
 * exactly the one-word drift `form.tsx` documents having had to undo — and
 * `configPanel.*` is also the block objectui#4746 just deleted as dead.
 *
 * `common.discard` is NEW because the packs carried no SHARED spelling of the
 * word: the three that existed are all surface-scoped — `form.discard` (the
 * confirm button of plugin-form's "Discard changes?" alert dialog),
 * `console.settingsView.discard` and `console.objectView.discard` (two
 * app-shell/console view footers) — and they do not even agree with each other
 * across packs (`console.objectView.discard` is zh 丢弃 / ko 취소 / fr Annuler
 * where the other two are zh 放弃 / ko 버리기 / fr Abandonner). Borrowing one
 * of them would bind this shared primitive's copy to another surface's wording.
 * The new key's ten values are the dominant spelling — byte-identical to
 * `form.discard` and `console.settingsView.discard`, which agree in all ten
 * packs.
 *
 * Both defaults below are byte-identical to the literals they replaced, so a
 * provider-less host renders exactly what it did before. Pinned positively in
 * `__tests__/config-panel-footer-no-provider-4750.test.tsx` (DOM bytes + the
 * `en` pack), and the translated direction in
 * `__tests__/config-panel-footer-i18n-4750.test.tsx`.
 */
const FOOTER_DEFAULT_TRANSLATIONS: Record<string, string> = {
  'common.save': 'Save',
  'common.discard': 'Discard',
};

/**
 * Probe key: one this component itself consumes, so it cannot rot into pointing
 * at a key no caller reads. With no translations configured `t('common.save')`
 * returns the key itself, which is the signal to serve the defaults above.
 */
const useSafeConfigPanelTranslation = createSafeTranslation(
  FOOTER_DEFAULT_TRANSLATIONS,
  'common.save',
);

export interface ConfigPanelRendererProps {
  /** Whether the panel is visible */
  open: boolean;
  /** Close callback */
  onClose: () => void;
  /** Schema describing the panel structure */
  schema: ConfigPanelSchema;
  /** Current draft values */
  draft: Record<string, any>;
  /** Whether the draft has uncommitted changes */
  isDirty: boolean;
  /** Called when any field changes */
  onFieldChange: (key: string, value: any) => void;
  /** Persist current draft */
  onSave: () => void;
  /** Revert draft to source */
  onDiscard: () => void;
  /** Extra content rendered in the header row */
  headerExtra?: React.ReactNode;
  /** Object definition for field pickers */
  objectDef?: Record<string, any>;
  /** Additional CSS class name */
  className?: string;
  /** Additional inline styles applied to the panel root (e.g. to override `--config-panel-width`). */
  style?: React.CSSProperties;
  /** Label for save button (default: the locale pack's `common.save`) */
  saveLabel?: string;
  /** Label for discard button (default: the locale pack's `common.discard`) */
  discardLabel?: string;
  /** Ref for the panel root element */
  panelRef?: React.Ref<HTMLDivElement>;
  /** ARIA role for the panel (e.g. "complementary") */
  role?: string;
  /** ARIA label for the panel */
  ariaLabel?: string;
  /** tabIndex for the panel root element */
  tabIndex?: number;
  /** Override data-testid for the panel root (default: "config-panel") */
  testId?: string;
  /** Title for the close button */
  closeTitle?: string;
  /** Override data-testid for the footer (default: "config-panel-footer") */
  footerTestId?: string;
  /** Override data-testid for the save button (default: "config-panel-save") */
  saveTestId?: string;
  /** Override data-testid for the discard button (default: "config-panel-discard") */
  discardTestId?: string;
  /** Externally-controlled set of section keys that should be expanded (overrides local collapse state) */
  expandedSections?: string[];
  /** Undo callback */
  onUndo?: () => void;
  /** Redo callback */
  onRedo?: () => void;
  /** Whether undo is available */
  canUndo?: boolean;
  /** Whether redo is available */
  canRedo?: boolean;
  /** Label for undo button */
  undoLabel?: string;
  /** Label for redo button */
  redoLabel?: string;
}

/**
 * Schema-driven configuration panel renderer.
 *
 * Takes a `ConfigPanelSchema` and automatically renders the full panel:
 * - Header with breadcrumb & close button
 * - Scrollable body with collapsible sections
 * - Sticky footer with Save / Discard when dirty
 *
 * Each concrete panel (Dashboard, Form, Page…) only needs to provide
 * a schema and wire up `useConfigDraft`.
 */
export function ConfigPanelRenderer({
  open,
  onClose,
  schema,
  draft,
  isDirty,
  onFieldChange,
  onSave,
  onDiscard,
  headerExtra,
  objectDef,
  className,
  style,
  // No parameter defaults: the fallback is a TRANSLATION, resolved at render
  // time from the active language (objectui#4750). An explicitly passed label
  // still wins — see the `??` at each button below.
  saveLabel,
  discardLabel,
  panelRef,
  role,
  ariaLabel,
  tabIndex,
  testId,
  closeTitle,
  footerTestId,
  saveTestId,
  discardTestId,
  expandedSections,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  undoLabel = 'Undo',
  redoLabel = 'Redo',
}: ConfigPanelRendererProps) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  // Above the `open` early return: a hook may not sit behind a conditional
  // return, or the hook order changes the render the panel is opened.
  const { t } = useSafeConfigPanelTranslation();

  if (!open) return null;

  const toggleCollapse = (key: string, defaultCollapsed?: boolean) => {
    setCollapsed((prev) => ({
      ...prev,
      [key]: !(prev[key] ?? defaultCollapsed ?? false),
    }));
  };

  // Resolve effective collapsed state: expandedSections prop overrides local state
  const isCollapsed = (sectionKey: string, defaultCollapsed?: boolean): boolean => {
    if (expandedSections && expandedSections.includes(sectionKey)) {
      return false;
    }
    return collapsed[sectionKey] ?? defaultCollapsed ?? false;
  };

  return (
    <div
      ref={panelRef}
      data-testid={testId ?? 'config-panel'}
      role={role}
      aria-label={ariaLabel}
      tabIndex={tabIndex}
      style={style}
      className={cn(
        'absolute inset-y-0 right-0 w-full sm:w-[var(--config-panel-width,280px)] sm:relative border-l bg-background flex flex-col shrink-0 z-20',
        className,
      )}
    >
      {/* ── Header ─────────────────────────────────────────── */}
      <div className="px-4 py-3 border-b flex items-center justify-between shrink-0">
        <nav aria-label="breadcrumb">
          <ol className="flex items-center gap-1 text-xs text-muted-foreground">
            {schema.breadcrumb.map((segment, idx) => (
              <React.Fragment key={idx}>
                {idx > 0 && <ChevronRight className="h-3 w-3" />}
                <li
                  className={cn(
                    idx === schema.breadcrumb.length - 1 && 'text-foreground font-medium',
                  )}
                >
                  {segment}
                </li>
              </React.Fragment>
            ))}
          </ol>
        </nav>
        <div className="flex items-center gap-1">
          {onUndo && (
            <Button
              size="sm"
              variant="ghost"
              onClick={onUndo}
              disabled={!canUndo}
              className="h-7 w-7 p-0"
              data-testid="config-panel-undo"
              title={undoLabel}
            >
              <Undo2 className="h-3.5 w-3.5" />
            </Button>
          )}
          {onRedo && (
            <Button
              size="sm"
              variant="ghost"
              onClick={onRedo}
              disabled={!canRedo}
              className="h-7 w-7 p-0"
              data-testid="config-panel-redo"
              title={redoLabel}
            >
              <Redo2 className="h-3.5 w-3.5" />
            </Button>
          )}
          {headerExtra}
          <Button
            size="sm"
            variant="ghost"
            onClick={onClose}
            className="h-7 w-7 p-0"
            data-testid="config-panel-close"
            title={closeTitle}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* ── Scrollable sections ────────────────────────────── */}
      <div className="flex-1 overflow-auto px-4 pb-4">
        {schema.sections.map((section, sectionIdx) => {
          if (section.visibleWhen && !section.visibleWhen(draft)) return null;

          const sectionCollapsed = isCollapsed(section.key, section.defaultCollapsed);

          return (
            <div key={section.key} data-testid={`config-section-${section.key}`}>
              {sectionIdx > 0 && <Separator className="my-3" />}
              <SectionHeader
                title={section.title}
                icon={section.icon}
                collapsible={section.collapsible}
                collapsed={sectionCollapsed}
                onToggle={() => toggleCollapse(section.key, section.defaultCollapsed)}
                testId={`section-header-${section.key}`}
              />
              {section.hint && (
                <p className="text-[10px] text-muted-foreground mb-1">
                  {section.hint}
                </p>
              )}
              {!sectionCollapsed && (
                <div className="space-y-1">
                  {section.fields.map((field) => (
                    <ConfigFieldRenderer
                      key={field.key}
                      field={field}
                      value={draft[field.key]}
                      onChange={(v) => onFieldChange(field.key, v)}
                      draft={draft}
                      objectDef={objectDef}
                    />
                  ))}
                  {section.subsections?.map((sub) => {
                    if (sub.visibleWhen && !sub.visibleWhen(draft)) return null;
                    const subCollapsed = isCollapsed(sub.key, sub.defaultCollapsed);
                    return (
                      <div key={sub.key} data-testid={`config-subsection-${sub.key}`} className="ml-1" role="group" aria-label={sub.title}>
                        <SectionHeader
                          title={sub.title}
                          icon={sub.icon}
                          collapsible={sub.collapsible}
                          collapsed={subCollapsed}
                          onToggle={() => toggleCollapse(sub.key, sub.defaultCollapsed)}
                          testId={`section-header-${sub.key}`}
                          className="pt-2 pb-1"
                        />
                        {!subCollapsed && (
                          <div className="space-y-1">
                            {sub.fields.map((field) => (
                              <ConfigFieldRenderer
                                key={field.key}
                                field={field}
                                value={draft[field.key]}
                                onChange={(v) => onFieldChange(field.key, v)}
                                draft={draft}
                                objectDef={objectDef}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Footer ─────────────────────────────────────────── */}
      {isDirty && (
        <div className="px-4 py-2 border-t flex gap-2 shrink-0" data-testid={footerTestId ?? 'config-panel-footer'}>
          <Button size="sm" onClick={onSave} data-testid={saveTestId ?? 'config-panel-save'}>
            <Save className="h-3.5 w-3.5 mr-1" />
            {saveLabel ?? t('common.save')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onDiscard}
            data-testid={discardTestId ?? 'config-panel-discard'}
          >
            <RotateCcw className="h-3.5 w-3.5 mr-1" />
            {discardLabel ?? t('common.discard')}
          </Button>
        </div>
      )}
    </div>
  );
}
