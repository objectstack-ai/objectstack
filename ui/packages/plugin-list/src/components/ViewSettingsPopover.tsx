/**
 * ViewSettingsPopover — the list toolbar's "Display" control.
 *
 * Since objectui#12423 this is the DEFAULT desktop shape of the list toolbar:
 * the bar keeps Filter, Sort, Display and Search, and everything else sits
 * here, in this order —
 *   - Layout (the visualization switcher; only when the list offers a choice)
 *   - Group, Row color, Hide fields
 *   - Density
 *   - Row numbers (a session-only switch, grid only)
 *   - Edit inline (a switch, grid only, when the principal may edit)
 *   - footer: Reset to view default · Refresh · Export
 *
 * It began as UX Sprint 2 (P1-4)'s "View settings" gear behind
 * `compactToolbar: true`; the wide form — one toolbar button per control — is
 * what a host gets with `compactToolbar: false`, and ListView.tsx keeps it.
 * Content is duplicated between the two forms: change one, change both.
 *
 * Every control persists exactly what its wide-form twin persists; this
 * component writes nothing itself. The trigger's count is the number of
 * settings that differ from the view's own (the host computes it), and Reset
 * hands every one of them back.
 *
 * @module
 */

import * as React from 'react';
import {
  cn,
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
  GroupingEditor,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from '@object-ui/components';
import {
  SlidersHorizontal,
  Rows4,
  Rows3,
  Rows2,
  ChevronDown,
  RotateCw,
  Download,
  Loader2,
  Undo2,
} from 'lucide-react';

export interface ViewSettingsField {
  name: string;
  label?: string;
}

export interface ViewSettingsDensity {
  mode: 'compact' | 'comfortable' | 'spacious';
  cycle: () => void;
}

export interface ViewSettingsPopoverProps {
  t: (key: string, opts?: any) => string;
  allFields: ViewSettingsField[];

  /**
   * The Layout row: the visualization switcher. The host passes it only when
   * the list offers more than one visualization, as a function of `closeMenu`:
   * choosing a layout completes the choice, so the host's switcher calls
   * `closeMenu` when a layout is picked (objectui#12621). The panel's toggles
   * (row numbers, inline edit, density, hidden fields) never close it.
   */
  layout?: (closeMenu: () => void) => React.ReactNode;

  showGroup?: boolean;
  groupingConfig?: any;
  setGroupingConfig?: (next: any) => void;

  showColor?: boolean;
  rowColorConfig?: { field: string; colors?: Record<string, string> } | undefined;
  setRowColorConfig?: (next: { field: string; colors: Record<string, string> } | undefined) => void;

  showDensity?: boolean;
  density?: ViewSettingsDensity;

  showHideFields?: boolean;
  hiddenFields?: Set<string>;
  updateHiddenFields?: (next: Set<string>) => void;

  /**
   * Row numbers on the grid's leading cell — a session-only setting the host
   * holds in memory (objectui#12423). Offered only when `setRowNumbers` is.
   */
  rowNumbers?: boolean;
  setRowNumbers?: (next: boolean) => void;

  /**
   * Record editing — toggle the grid's inline-edit mode. `setInlineEdit` hands
   * the change to the host, which decides what it does with it; the console
   * keeps it session-only and writes nothing to the view (objectui#5144,
   * ruling E).
   */
  showInlineEdit?: boolean;
  inlineEdit?: boolean;
  setInlineEdit?: (next: boolean) => void;

  /**
   * How many of the settings above differ from the view's own. Drawn as the
   * trigger's count; zero draws none. The host computes it — only it knows
   * what the view declared.
   */
  changedCount?: number;
  /** Hand every changed setting back to the view's own. Drawn when wired. */
  onReset?: () => void;

  /** Footer: re-fetch the list. Drawn when wired. */
  onRefresh?: () => void;
  refreshing?: boolean;

  /** Footer: one export entry per format. Drawn when there is a format. */
  exportFormats?: string[];
  onExport?: (format: string) => void;
  exportBusy?: boolean;
  exportError?: string | null;
}

interface SectionProps {
  title: string;
  badge?: number;
  onClear?: () => void;
  clearLabel?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

function Section({ title, badge, onClear, clearLabel, defaultOpen = true, children }: SectionProps) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <div className="border-b last:border-b-0">
      <div className="flex items-center justify-between px-3 py-2">
        <button
          type="button"
          onClick={() => setOpen((x) => !x)}
          className="flex items-center gap-1.5 text-xs font-medium text-foreground/80 hover:text-foreground"
        >
          <ChevronDown
            className={cn('h-3.5 w-3.5 transition-transform', !open && '-rotate-90')}
          />
          {title}
          {typeof badge === 'number' && badge > 0 && (
            <span className="ml-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-primary/10 px-1 text-[10px] text-primary tabular-nums">
              {badge}
            </span>
          )}
        </button>
        {onClear && (
          <button
            type="button"
            onClick={onClear}
            className="text-[11px] text-muted-foreground hover:text-foreground"
          >
            {clearLabel}
          </button>
        )}
      </div>
      {open && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}

/** The item a colour field none of the options carries is shown by. */
const OUTSIDE_OPTIONS = 'outside';

/**
 * objectui#11865 — the "Color by field" picker, drawn with the shared `Select`,
 * the control the rest of the console picks with. It used to be a
 * browser-native `<select>`. What a pick writes is unchanged: `onPick` receives
 * the picked option's own value, the string the native control's `change`
 * carried, and the caller turns it into the same row-colour config as before.
 * Re-picking the current option writes nothing, as it did there.
 *
 * - Items carry their option's INDEX, not its value: "None" is the option whose
 *   value is `''`, which `SelectItem` refuses.
 * - A colour field none of the options carries gets an item of its own,
 *   labelled with the field, so the trigger shows what the view holds. The
 *   native control showed "None" there. Picking that item writes nothing.
 */
function ColorFieldPicker({
  value,
  options,
  onPick,
}: {
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  onPick: (value: string) => void;
}) {
  const at = options.findIndex((o) => o.value === value);
  return (
    <Select
      value={at !== -1 ? String(at) : OUTSIDE_OPTIONS}
      onValueChange={(token) => {
        // `undefined` for the outside item: it is the view's own field, so there is nothing to write.
        const picked = options[Number(token)];
        if (picked) onPick(picked.value);
      }}
    >
      <SelectTrigger className="h-8 rounded px-2 text-xs" data-testid="color-field-select">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {at === -1 && <SelectItem value={OUTSIDE_OPTIONS}>{value}</SelectItem>}
        {options.map((o, i) => (
          <SelectItem key={`${i}:${o.value}`} value={String(i)}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * One on/off row of the panel: the words on the left, a `role="switch"` on the
 * right. The words are the switch's `<label>`, so a click on either toggles it
 * and the switch is named by them.
 */
function SwitchRow({
  label,
  checked,
  onCheckedChange,
  testId,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  testId: string;
}) {
  const id = React.useId();
  return (
    <div className="flex items-center justify-between gap-3 border-b px-3 py-2 last:border-b-0">
      <label htmlFor={id} className="text-xs font-medium text-foreground/80 cursor-pointer">
        {label}
      </label>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} data-testid={testId} />
    </div>
  );
}

export function ViewSettingsPopover(props: ViewSettingsPopoverProps) {
  const {
    t,
    allFields,
    layout,
    showGroup,
    groupingConfig,
    setGroupingConfig,
    showColor,
    rowColorConfig,
    setRowColorConfig,
    showDensity,
    density,
    showHideFields,
    hiddenFields,
    updateHiddenFields,
    rowNumbers,
    setRowNumbers,
    showInlineEdit,
    inlineEdit,
    setInlineEdit,
    changedCount = 0,
    onReset,
    onRefresh,
    refreshing,
    exportFormats,
    onExport,
    exportBusy,
    exportError,
  } = props;

  const [open, setOpen] = React.useState(false);
  // Closing through the controlled state lets Radix return focus to the
  // Display trigger, as Escape and an outside click do.
  const closeMenu = React.useCallback(() => setOpen(false), []);

  const DensityIcon =
    density?.mode === 'compact' ? Rows4 : density?.mode === 'comfortable' ? Rows3 : Rows2;

  const triggerLabel = t('list.display', { defaultValue: 'Display' });
  const hasExport = !!onExport && !!exportFormats && exportFormats.length > 0;
  const hasFooter = !!onReset || !!onRefresh || hasExport;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label={triggerLabel}
          title={triggerLabel}
          className={cn(
            'h-7 min-w-7 gap-1 px-1.5 text-muted-foreground hover:text-primary text-xs transition-colors duration-150',
            changedCount > 0 && 'text-foreground font-medium',
          )}
          data-testid="toolbar-display-trigger"
        >
          {/* Icon-only at every width, like Filter and Sort (objectui#12695). */}
          <SlidersHorizontal className="h-3.5 w-3.5" />
          {changedCount > 0 && (
            <span
              className="flex h-4 min-w-[16px] items-center justify-center text-[10px] font-medium text-muted-foreground tabular-nums"
              data-testid="toolbar-display-count"
            >
              {changedCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0" data-testid="view-settings-content">
        <div className="max-h-[min(70vh,560px)] overflow-y-auto">
          {layout && (
            <div className="flex items-center justify-between gap-3 border-b px-3 py-2" data-testid="display-layout-row">
              <span className="text-xs font-medium text-foreground/80">
                {t('list.layout', { defaultValue: 'Layout' })}
              </span>
              {layout(closeMenu)}
            </div>
          )}

          {showGroup && setGroupingConfig && (
            <Section
              title={t('list.group', { defaultValue: 'Group' })}
              badge={groupingConfig?.fields?.length || 0}
              onClear={groupingConfig ? () => setGroupingConfig(undefined) : undefined}
              clearLabel={t('list.clear', { defaultValue: 'Clear' })}
            >
              <GroupingEditor
                value={groupingConfig as any}
                fieldOptions={allFields.map((f) => ({ value: f.name, label: f.label || f.name }))}
                maxLevels={3}
                labels={{
                  addGroup: t('list.addGroup', 'Add group field'),
                  collapseTitle: t('list.collapsedByDefault', 'Collapsed by default'),
                  removeTitle: t('list.removeGroup', 'Remove'),
                }}
                onChange={(next) => setGroupingConfig(next as any)}
              />
            </Section>
          )}

          {/* `list.rowColor` names the SECTION; `list.color` is the wide
              toolbar-BUTTON label for the same feature — ListView renders the
              button with `list.color` and the panel it opens with
              `list.rowColor`. This Section is that panel's counterpart here,
              so it takes the panel's key (objectui#4118). */}
          {showColor && setRowColorConfig && (
            <Section
              title={t('list.rowColor', { defaultValue: 'Row Color' })}
              onClear={rowColorConfig ? () => setRowColorConfig(undefined) : undefined}
              clearLabel={t('list.clear', { defaultValue: 'Clear' })}
              defaultOpen={!!rowColorConfig}
            >
              <label className="block text-[11px] text-muted-foreground mb-1">
                {t('list.colorByField', { defaultValue: 'Color by field' })}
              </label>
              <ColorFieldPicker
                value={rowColorConfig?.field || ''}
                options={[
                  { value: '', label: t('list.none', { defaultValue: 'None' }) },
                  ...allFields.map((field) => ({ value: field.name, label: field.label || field.name })),
                ]}
                onPick={(field) => {
                  if (!field) {
                    setRowColorConfig(undefined);
                  } else {
                    setRowColorConfig({ field, colors: rowColorConfig?.colors || {} });
                  }
                }}
              />
            </Section>
          )}

          {showHideFields && hiddenFields && updateHiddenFields && (
            <Section
              title={t('list.hideFieldsTitle', { defaultValue: 'Hide Fields' })}
              badge={hiddenFields.size}
              onClear={hiddenFields.size > 0 ? () => updateHiddenFields(new Set()) : undefined}
              clearLabel={t('list.showAll', { defaultValue: 'Show all' })}
              defaultOpen={hiddenFields.size > 0}
            >
              <div className="max-h-48 overflow-y-auto space-y-0.5">
                {allFields.map((field) => (
                  <label
                    key={field.name}
                    className="flex items-center gap-2 text-xs py-1 px-1 rounded hover:bg-muted cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={!hiddenFields.has(field.name)}
                      onChange={() => {
                        const next = new Set(hiddenFields);
                        if (next.has(field.name)) next.delete(field.name);
                        else next.add(field.name);
                        updateHiddenFields(next);
                      }}
                      className="rounded border-input"
                    />
                    <span className="truncate">{field.label || field.name}</span>
                  </label>
                ))}
              </div>
            </Section>
          )}

          {showDensity && density && (
            <div className="flex items-center justify-between gap-3 border-b px-3 py-2">
              <span className="text-xs font-medium text-foreground/80">
                {t('grid.toolbar.densityMode', { defaultValue: 'Density' })}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1.5"
                onClick={density.cycle}
                title={t('grid.toolbar.densityCycleShortHint', { defaultValue: 'Click to cycle' })}
                data-testid="view-settings-density-cycle"
              >
                <DensityIcon className="h-3.5 w-3.5" />
                <span className="text-xs">
                  {density.mode === 'compact'
                    ? t('grid.toolbar.densityCompact', { defaultValue: 'Compact' })
                    : density.mode === 'comfortable'
                      ? t('grid.toolbar.densityComfortable', { defaultValue: 'Comfortable' })
                      : t('grid.toolbar.densitySpacious', { defaultValue: 'Spacious' })}
                </span>
              </Button>
            </div>
          )}

          {setRowNumbers && (
            <SwitchRow
              label={t('list.rowNumbers', { defaultValue: 'Row numbers' })}
              checked={!!rowNumbers}
              onCheckedChange={setRowNumbers}
              testId="display-row-numbers-toggle"
            />
          )}

          {showInlineEdit && setInlineEdit && (
            <SwitchRow
              label={t('list.inlineEditShort', { defaultValue: 'Edit inline' })}
              checked={!!inlineEdit}
              onCheckedChange={setInlineEdit}
              testId="toolbar-inline-edit-toggle"
            />
          )}
        </div>

        {hasFooter && (
          <div className="flex flex-wrap items-center gap-1 border-t bg-muted/30 px-2 py-1.5" data-testid="display-footer">
            {onReset && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                disabled={changedCount === 0}
                onClick={onReset}
                data-testid="display-reset-button"
              >
                <Undo2 className="h-3.5 w-3.5 mr-1.5" />
                {t('list.resetToViewDefault', { defaultValue: 'Reset to view default' })}
              </Button>
            )}
            <div className="ml-auto flex items-center gap-1">
              {onRefresh && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0 text-muted-foreground hover:text-primary"
                  onClick={onRefresh}
                  disabled={refreshing}
                  title={t('list.refresh', { defaultValue: 'Refresh' })}
                  aria-label={t('list.refresh', { defaultValue: 'Refresh' })}
                  data-testid="refresh-button"
                >
                  <RotateCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
                </Button>
              )}
              {hasExport &&
                exportFormats!.map((format) => (
                  <Button
                    key={format}
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    disabled={exportBusy}
                    onClick={() => onExport!(format)}
                    data-testid={`display-export-${format}`}
                  >
                    {exportBusy
                      ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                      : <Download className="h-3.5 w-3.5 mr-1.5" />}
                    {t('list.exportAs', { format: format.toUpperCase(), defaultValue: `Export as ${format.toUpperCase()}` })}
                  </Button>
                ))}
            </div>
            {exportError && (
              <div className="basis-full px-1 pt-1 text-xs text-destructive" role="alert">
                {exportError}
              </div>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
