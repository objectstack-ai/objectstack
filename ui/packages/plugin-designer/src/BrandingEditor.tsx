/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * BrandingEditor Component
 *
 * Visual editor for application branding and theme configuration.
 * Supports logo upload, theme color selection with preset palettes,
 * favicon management, font family selection, light/dark mode preview,
 * undo/redo, and JSON export/import.
 *
 * Outputs to BrandingConfig (AppSchema.branding) and ThemeSchema protocol.
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import type { BrandingConfig } from '@object-ui/types';
import {
  Download,
  Image,
  Moon,
  Palette,
  Redo2,
  Sun,
  Type,
  Undo2,
  Upload,
  Globe,
} from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@object-ui/components';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { useDesignerTranslation } from './hooks/useDesignerTranslation';
import { useUndoRedo } from './hooks/useUndoRedo';

function cn(...inputs: (string | undefined | false)[]) {
  return twMerge(clsx(inputs));
}

// ============================================================================
// Types
// ============================================================================

export interface BrandingEditorProps {
  /** Current branding configuration */
  branding: BrandingConfig;
  /** Callback when branding changes */
  onChange: (branding: BrandingConfig) => void;
  /** Application title for preview */
  appTitle?: string;
  /** Read-only mode */
  readOnly?: boolean;
  /** CSS class */
  className?: string;
  /** Callback to export branding config */
  onExport?: (branding: BrandingConfig) => void;
  /** Callback to import branding config */
  onImport?: (branding: BrandingConfig) => void;
}

// ============================================================================
// Constants
// ============================================================================

/** Common brand color palette */
const COLOR_PALETTE = [
  { hex: '#3b82f6', name: 'Blue' },
  { hex: '#6366f1', name: 'Indigo' },
  { hex: '#8b5cf6', name: 'Violet' },
  { hex: '#a855f7', name: 'Purple' },
  { hex: '#ec4899', name: 'Pink' },
  { hex: '#ef4444', name: 'Red' },
  { hex: '#f97316', name: 'Orange' },
  { hex: '#f59e0b', name: 'Amber' },
  { hex: '#eab308', name: 'Yellow' },
  { hex: '#22c55e', name: 'Green' },
  { hex: '#14b8a6', name: 'Teal' },
  { hex: '#06b6d4', name: 'Cyan' },
  { hex: '#0ea5e9', name: 'Sky' },
  { hex: '#64748b', name: 'Slate' },
  { hex: '#1e293b', name: 'Dark' },
  { hex: '#0f172a', name: 'Navy' },
];

/** Common font families */
const FONT_FAMILIES = [
  'Inter',
  'Roboto',
  'Open Sans',
  'Lato',
  'Montserrat',
  'Poppins',
  'Source Sans Pro',
  'Noto Sans',
  'system-ui',
];

/** The item a font none of the options carries is shown by. */
const OUTSIDE_OPTIONS = 'outside';

/**
 * objectui#11865 — the font family picker, drawn with the shared `Select`, the
 * control the rest of the designer picks with. It used to be a browser-native
 * `<select>`. What a pick writes is unchanged: `onPick` receives the picked
 * option's own value, the string the native control's `change` carried, and
 * the caller turns it into the same `fontFamily` as before. Re-picking the
 * current option writes nothing, as it did there.
 *
 * - Items carry their option's INDEX, not its value: "Default (System)" is the
 *   option whose value is `''`, which `SelectItem` refuses.
 * - A font none of the options carries gets an item of its own, labelled with
 *   the font, so the trigger shows what the branding holds. The native control
 *   showed "Default (System)" there. Picking that item writes nothing.
 * - `disabled` reaches the trigger through the primitive, as it reached the
 *   native control.
 * - `id` goes on the trigger, so the `<label htmlFor>` names it as it named the
 *   native control.
 */
function FontPicker({
  id,
  value,
  options,
  onPick,
  disabled,
}: {
  id: string;
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  onPick: (value: string) => void;
  disabled: boolean;
}) {
  const at = options.findIndex((o) => o.value === value);
  return (
    <Select
      value={at !== -1 ? String(at) : OUTSIDE_OPTIONS}
      onValueChange={(token) => {
        // `undefined` for the outside item: it is the branding's own font, so there is nothing to write.
        const picked = options[Number(token)];
        if (picked) onPick(picked.value);
      }}
      disabled={disabled}
    >
      <SelectTrigger
        id={id}
        data-testid="branding-font-select"
        className="h-auto rounded-md border-gray-300 py-2 pl-9 pr-3 text-sm shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:ring-offset-0 disabled:bg-gray-50"
      >
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

// ============================================================================
// BrandingEditor Component
// ============================================================================

export function BrandingEditor({
  branding: initialBranding,
  onChange,
  appTitle = 'My App',
  readOnly = false,
  className,
  onExport,
  onImport,
}: BrandingEditorProps) {
  const { t } = useDesignerTranslation();
  const [previewMode, setPreviewMode] = useState<'light' | 'dark'>('light');
  const { current: branding, push, canUndo, canRedo, undo, redo } = useUndoRedo(initialBranding);

  // Flag to skip onChange when updateBranding already called it
  const skipOnChangeRef = useRef(true); // Start true to skip initial render

  // Sync undo/redo state changes back to parent
  useEffect(() => {
    if (skipOnChangeRef.current) {
      skipOnChangeRef.current = false;
      return;
    }
    // On undo/redo the current state changes without going through updateBranding
    onChange(branding);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branding]);

  // Sync changes to parent
  const updateBranding = useCallback(
    (partial: Partial<BrandingConfig>) => {
      const next = { ...branding, ...partial };
      skipOnChangeRef.current = true;
      push(next);
      onChange(next);
    },
    [branding, push, onChange],
  );

  // Export JSON
  const handleExport = useCallback(() => {
    if (onExport) {
      onExport(branding);
      return;
    }
    const blob = new Blob([JSON.stringify(branding, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'branding.json';
    a.click();
    URL.revokeObjectURL(url);
  }, [branding, onExport]);

  // Import JSON
  const handleImport = useCallback(() => {
    if (onImport) {
      // Let caller handle import
      onImport(branding);
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const imported = JSON.parse(ev.target?.result as string) as BrandingConfig;
          if (typeof imported === 'object' && imported !== null) {
            const next = { ...branding, ...imported };
            push(next);
            onChange(next);
          }
        } catch {
          // Invalid JSON — silently ignore
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }, [branding, push, onChange, onImport]);

  // Keyboard shortcuts
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (readOnly) return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          redo();
        } else {
          undo();
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        e.preventDefault();
        redo();
      }
    },
    [readOnly, undo, redo],
  );

  const primaryColor = branding.primaryColor || '#3b82f6';
  const isDark = previewMode === 'dark';

  return (
    <div
      data-testid="branding-editor"
      className={cn('flex flex-col gap-4 sm:gap-6', className)}
      onKeyDown={handleKeyDown}
      tabIndex={0}
    >
      {/* Toolbar */}
      <div
        data-testid="branding-editor-toolbar"
        className="flex flex-wrap items-center gap-2"
      >
        <h2 className="text-lg font-semibold text-gray-800 mr-auto">
          {t('appDesigner.brandingEditor')}
        </h2>

        {/* Undo / Redo */}
        <button
          data-testid="branding-undo"
          type="button"
          onClick={undo}
          disabled={!canUndo || readOnly}
          className={cn(
            'inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium shadow-sm transition-colors',
            canUndo && !readOnly
              ? 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
              : 'border-gray-200 bg-gray-50 text-gray-400 cursor-not-allowed',
          )}
          title={t('appDesigner.undo')}
        >
          <Undo2 className="h-3.5 w-3.5" />
          {t('appDesigner.undo')}
        </button>

        <button
          data-testid="branding-redo"
          type="button"
          onClick={redo}
          disabled={!canRedo || readOnly}
          className={cn(
            'inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium shadow-sm transition-colors',
            canRedo && !readOnly
              ? 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
              : 'border-gray-200 bg-gray-50 text-gray-400 cursor-not-allowed',
          )}
          title={t('appDesigner.redo')}
        >
          <Redo2 className="h-3.5 w-3.5" />
          {t('appDesigner.redo')}
        </button>

        {/* Export / Import */}
        <button
          data-testid="branding-export"
          type="button"
          onClick={handleExport}
          className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50"
          title={t('appDesigner.brandingExport')}
        >
          <Download className="h-3.5 w-3.5" />
          {t('appDesigner.brandingExport')}
        </button>

        <button
          data-testid="branding-import"
          type="button"
          onClick={handleImport}
          disabled={readOnly}
          className={cn(
            'inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium shadow-sm transition-colors',
            readOnly
              ? 'border-gray-200 bg-gray-50 text-gray-400 cursor-not-allowed'
              : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50',
          )}
          title={t('appDesigner.brandingImport')}
        >
          <Upload className="h-3.5 w-3.5" />
          {t('appDesigner.brandingImport')}
        </button>
      </div>

      {/* Main content: editor + preview side-by-side on desktop */}
      <div className="flex flex-col gap-4 sm:flex-row sm:gap-6">
        {/* Left: form fields */}
        <div className="flex-1 space-y-5">
          {/* Logo URL */}
          <div className="space-y-1.5">
            <label htmlFor="be-logo" className="block text-sm font-medium text-gray-700">
              {t('appDesigner.logoUrl')}
            </label>
            <div className="relative">
              <Image className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
              <input
                id="be-logo"
                data-testid="branding-logo-input"
                type="text"
                value={branding.logo ?? ''}
                onChange={(e) => updateBranding({ logo: e.target.value })}
                placeholder="https://example.com/logo.svg"
                disabled={readOnly}
                className="block w-full rounded-md border border-gray-300 py-2 pl-9 pr-3 text-sm shadow-sm outline-none transition-colors focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:cursor-not-allowed disabled:bg-gray-50"
              />
            </div>
          </div>

          {/* Primary Color */}
          <div className="space-y-1.5">
            <label htmlFor="be-color" className="block text-sm font-medium text-gray-700">
              {t('appDesigner.primaryColor')}
            </label>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Palette className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
                <input
                  id="be-color"
                  data-testid="branding-color-input"
                  type="text"
                  value={branding.primaryColor ?? '#3b82f6'}
                  onChange={(e) => updateBranding({ primaryColor: e.target.value })}
                  placeholder="#3b82f6"
                  disabled={readOnly}
                  className="block w-full rounded-md border border-gray-300 py-2 pl-9 pr-3 text-sm shadow-sm outline-none transition-colors focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:cursor-not-allowed disabled:bg-gray-50"
                />
              </div>
              <input
                data-testid="branding-color-picker"
                type="color"
                value={primaryColor}
                onChange={(e) => updateBranding({ primaryColor: e.target.value })}
                disabled={readOnly}
                className="h-9 w-9 cursor-pointer rounded-md border border-gray-300 p-0.5 disabled:cursor-not-allowed"
              />
            </div>

            {/* Color Palette Swatches */}
            <div className="space-y-1">
              <span className="text-xs text-gray-500">{t('appDesigner.colorPalette')}</span>
              <div
                data-testid="branding-color-palette"
                className="flex flex-wrap gap-1.5"
              >
                {COLOR_PALETTE.map((color) => (
                  <button
                    key={color.hex}
                    data-testid={`branding-swatch-${color.hex.slice(1)}`}
                    type="button"
                    onClick={() => !readOnly && updateBranding({ primaryColor: color.hex })}
                    disabled={readOnly}
                    className={cn(
                      'h-6 w-6 rounded-full border-2 transition-transform hover:scale-110 disabled:cursor-not-allowed',
                      primaryColor === color.hex
                        ? 'border-gray-800 ring-2 ring-offset-1 ring-gray-400'
                        : 'border-transparent',
                    )}
                    style={{ backgroundColor: color.hex }}
                    title={color.name}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Favicon URL */}
          <div className="space-y-1.5">
            <label htmlFor="be-favicon" className="block text-sm font-medium text-gray-700">
              {t('appDesigner.faviconUrl')}
            </label>
            <div className="relative">
              <Globe className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
              <input
                id="be-favicon"
                data-testid="branding-favicon-input"
                type="text"
                value={branding.favicon ?? ''}
                onChange={(e) => updateBranding({ favicon: e.target.value })}
                placeholder="https://example.com/favicon.ico"
                disabled={readOnly}
                className="block w-full rounded-md border border-gray-300 py-2 pl-9 pr-3 text-sm shadow-sm outline-none transition-colors focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:cursor-not-allowed disabled:bg-gray-50"
              />
            </div>
          </div>

          {/* Font Family */}
          <div className="space-y-1.5">
            <label htmlFor="be-font" className="block text-sm font-medium text-gray-700">
              {t('appDesigner.fontFamily')}
            </label>
            <div className="relative">
              <Type className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
              <FontPicker
                id="be-font"
                value={branding.fontFamily ?? ''}
                options={[
                  { value: '', label: t('appDesigner.fontDefault') },
                  ...FONT_FAMILIES.map((font) => ({ value: font, label: font })),
                ]}
                onPick={(font) => updateBranding({ fontFamily: font || undefined })}
                disabled={readOnly}
              />
            </div>
          </div>
        </div>

        {/* Right: live preview */}
        <div className="flex-1 space-y-3">
          {/* Mode toggle */}
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700">
              {t('appDesigner.brandingPreview')}
            </span>
            <div data-testid="branding-mode-toggle" className="flex rounded-md border border-gray-300 overflow-hidden">
              <button
                data-testid="branding-mode-light"
                type="button"
                onClick={() => setPreviewMode('light')}
                className={cn(
                  'inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium transition-colors',
                  previewMode === 'light'
                    ? 'bg-blue-50 text-blue-700'
                    : 'bg-white text-gray-600 hover:bg-gray-50',
                )}
              >
                <Sun className="h-3.5 w-3.5" />
                {t('appDesigner.modeLight')}
              </button>
              <button
                data-testid="branding-mode-dark"
                type="button"
                onClick={() => setPreviewMode('dark')}
                className={cn(
                  'inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium transition-colors',
                  previewMode === 'dark'
                    ? 'bg-gray-800 text-gray-100'
                    : 'bg-white text-gray-600 hover:bg-gray-50',
                )}
              >
                <Moon className="h-3.5 w-3.5" />
                {t('appDesigner.modeDark')}
              </button>
            </div>
          </div>

          {/* Preview card */}
          <div
            data-testid="branding-preview"
            className={cn(
              'rounded-lg border p-4 transition-colors',
              isDark
                ? 'border-gray-700 bg-gray-900 text-gray-100'
                : 'border-gray-200 bg-white text-gray-800',
            )}
            style={{ fontFamily: branding.fontFamily || 'inherit' }}
          >
            {/* Header preview */}
            <div
              className="rounded-md p-3 mb-3"
              style={{ backgroundColor: primaryColor }}
            >
              <div className="flex items-center gap-3">
                {branding.logo ? (
                  <img
                    src={branding.logo}
                    alt="Logo"
                    className="h-8 w-8 rounded object-contain bg-white/20"
                  />
                ) : (
                  <div className="flex h-8 w-8 items-center justify-center rounded bg-white/20 text-xs text-white">
                    Logo
                  </div>
                )}
                <span className="text-sm font-semibold text-white">
                  {appTitle}
                </span>
              </div>
            </div>

            {/* Body preview */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <div
                  className="h-4 w-4 rounded-full border border-gray-200"
                  style={{ backgroundColor: primaryColor }}
                />
                <span className={cn('text-xs', isDark ? 'text-gray-400' : 'text-gray-500')}>
                  {primaryColor}
                </span>
              </div>

              {/* Button preview */}
              <button
                type="button"
                className="rounded-md px-3 py-1.5 text-xs font-medium text-white transition-colors"
                style={{ backgroundColor: primaryColor }}
                tabIndex={-1}
              >
                {t('appDesigner.brandingSampleButton')}
              </button>

              {/* Text preview */}
              <p className={cn('text-xs', isDark ? 'text-gray-400' : 'text-gray-500')}>
                {t('appDesigner.brandingSampleText')}
              </p>

              {/* Favicon preview */}
              {branding.favicon && (
                <div className="flex items-center gap-2">
                  <img
                    src={branding.favicon}
                    alt="Favicon"
                    className="h-4 w-4 rounded object-contain"
                  />
                  <span className={cn('text-xs', isDark ? 'text-gray-400' : 'text-gray-500')}>Favicon</span>
                </div>
              )}

              {/* Font preview */}
              {branding.fontFamily && (
                <div className={cn('text-xs', isDark ? 'text-gray-400' : 'text-gray-500')}>
                  {t('appDesigner.fontFamily')}: {branding.fontFamily}
                </div>
              )}
            </div>
          </div>

          {/* Mobile preview */}
          <div
            data-testid="branding-preview-mobile"
            className={cn(
              'mx-auto w-48 rounded-xl border-2 p-2 transition-colors',
              isDark
                ? 'border-gray-700 bg-gray-900'
                : 'border-gray-300 bg-white',
            )}
            style={{ fontFamily: branding.fontFamily || 'inherit' }}
          >
            <div className="text-center text-[10px] font-medium text-gray-400 mb-1">
              {t('appDesigner.mobilePreview')}
            </div>
            <div
              className="rounded-md p-2 mb-1"
              style={{ backgroundColor: primaryColor }}
            >
              <div className="flex items-center gap-1.5">
                {branding.logo ? (
                  <img
                    src={branding.logo}
                    alt="Logo"
                    className="h-4 w-4 rounded object-contain bg-white/20"
                  />
                ) : (
                  <div className="flex h-4 w-4 items-center justify-center rounded bg-white/20 text-[6px] text-white">
                    L
                  </div>
                )}
                <span className="text-[9px] font-semibold text-white truncate">
                  {appTitle}
                </span>
              </div>
            </div>
            <div className="space-y-1 px-1">
              <div className={cn('h-2 w-3/4 rounded', isDark ? 'bg-gray-700' : 'bg-gray-200')} />
              <div className={cn('h-2 w-1/2 rounded', isDark ? 'bg-gray-700' : 'bg-gray-200')} />
              <div className={cn('h-2 w-2/3 rounded', isDark ? 'bg-gray-700' : 'bg-gray-200')} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
