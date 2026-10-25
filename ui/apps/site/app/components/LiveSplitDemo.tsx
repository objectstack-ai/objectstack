'use client';

/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React, {
  Component,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { SchemaRenderer, SchemaRendererContext, toRenderableSchema } from '@object-ui/react';
import { SidebarProvider } from '@object-ui/components';
import type { SchemaNode } from '@object-ui/core';
import {
  getExample,
  type Example,
} from '@object-ui/example-schema-catalog';
// Registers `@object-ui/layout`'s blocks — see the module header (objectui#3787).
import './registerLayoutBlocks';

const PRESET_IDS = [
  'auth/login-simple',
  'dashboard/stats-cards-grid',
  'components-form-form/contact-form',
  'blocks-gallery/block-gallery-stats-card',
  'components-complex-table/basic-table',
] as const;

const PRESET_LABELS: Record<(typeof PRESET_IDS)[number], string> = {
  'auth/login-simple': 'Login',
  'dashboard/stats-cards-grid': 'Dashboard',
  'components-form-form/contact-form': 'Form',
  'blocks-gallery/block-gallery-stats-card': 'Stats Card',
  'components-complex-table/basic-table': 'Table',
};

/**
 * The provider value these demos render under. Every preset in `PRESET_IDS` is
 * a STATIC schema — the object-bound examples live in `InteractiveDemo` /
 * `SchemaThumbnail`, which inject `galleryDataSource` — so this surface has no
 * adapter to hand over and says so with `undefined` (objectui#7912).
 *
 * It used to say `{}`. An empty object is TRUTHY, so it walked past the
 * `if (!dataSource)` guard every reader writes for exactly this state; the seam
 * now declares `DataSource | null | undefined`, so the absence is stated rather
 * than smuggled. Still a module constant, for the same reason as before: the
 * memo below keys on its identity, and `undefined` is render-stable.
 */
const defaultCtx = { dataSource: undefined };

class PreviewErrorBoundary extends Component<
  { children: ReactNode; signal: unknown },
  { hasError: boolean; message: string }
> {
  state = { hasError: false, message: '' };

  static getDerivedStateFromError(err: unknown) {
    return {
      hasError: true,
      message: err instanceof Error ? err.message : String(err),
    };
  }

  componentDidUpdate(prev: { signal: unknown }) {
    if (prev.signal !== this.props.signal && this.state.hasError) {
      this.setState({ hasError: false, message: '' });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-6 text-center">
          <div className="text-sm font-medium text-fd-foreground">
            Could not render this schema
          </div>
          <code className="max-w-sm break-words text-xs text-fd-muted-foreground">
            {this.state.message}
          </code>
        </div>
      );
    }
    return this.props.children;
  }
}

interface LiveSplitDemoProps {
  /** Preset ids to expose as tabs. Defaults to a curated selection. */
  presetIds?: ReadonlyArray<string>;
}

/**
 * Hero-style live split view: editable JSON on the left, rendered ObjectUI
 * on the right. Used on the marketing homepage to communicate the
 * "JSON-to-UI" pitch in the first three seconds.
 *
 * - Tab strip of preset ids drawn from the schema catalog.
 * - Debounced JSON parse: bad JSON shows an inline error and keeps the
 *   last good preview visible (no flicker).
 * - Reset button restores the active preset to its catalog source.
 * - "Open in Playground" deep-links to /playground (TODO: param wiring
 *   for shareable URLs is part of P4).
 */
export function LiveSplitDemo({
  presetIds = PRESET_IDS,
}: LiveSplitDemoProps) {
  const presets = useMemo(() => {
    const out: Example[] = [];
    for (const id of presetIds) {
      try {
        out.push(getExample(id));
      } catch {
        // Preset disappeared from the catalog — skip silently.
      }
    }
    return out;
  }, [presetIds]);

  const [activeId, setActiveId] = useState<string>(
    presets[0]?.id ?? presetIds[0] ?? '',
  );

  const active = useMemo(
    () => presets.find((p) => p.id === activeId) ?? presets[0],
    [presets, activeId],
  );

  const initialText = useMemo(
    () => (active ? JSON.stringify(active.schema, null, 2) : '{}'),
    [active],
  );

  const [text, setText] = useState(initialText);
  const [debouncedText, setDebouncedText] = useState(initialText);
  const [lastValidSchema, setLastValidSchema] = useState<SchemaNode>(
    (active?.schema as SchemaNode) ?? null,
  );
  const [parseError, setParseError] = useState<string | null>(null);

  useEffect(() => {
    setText(initialText);
    setDebouncedText(initialText);
    setLastValidSchema(active?.schema as SchemaNode);
    setParseError(null);
  }, [active, initialText]);

  // Debounce textarea -> live preview to keep typing responsive.
  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedText(text), 200);
    return () => window.clearTimeout(t);
  }, [text]);

  useEffect(() => {
    try {
      const parsed = JSON.parse(debouncedText);
      setLastValidSchema(parsed as SchemaNode);
      setParseError(null);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : String(err));
    }
  }, [debouncedText]);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const ctxValue = useMemo(() => defaultCtx, []);

  const handleReset = useCallback(() => {
    if (!active) return;
    const fresh = JSON.stringify(active.schema, null, 2);
    setText(fresh);
    setDebouncedText(fresh);
    setLastValidSchema(active.schema as SchemaNode);
    setParseError(null);
    textareaRef.current?.focus();
  }, [active]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // best-effort
    }
  }, [text]);

  if (!active) {
    return null;
  }

  return (
    <div className="not-prose flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          role="tablist"
          aria-label="Preset schemas"
          className="flex flex-wrap items-center gap-1 rounded-lg border border-fd-border bg-fd-card p-1"
        >
          {presets.map((p) => {
            const isActive = p.id === active.id;
            return (
              <button
                key={p.id}
                role="tab"
                aria-selected={isActive}
                type="button"
                onClick={() => setActiveId(p.id)}
                className={
                  'rounded-md px-3 py-1.5 text-xs font-medium transition ' +
                  (isActive
                    ? 'bg-fd-primary text-fd-primary-foreground shadow-sm'
                    : 'text-fd-muted-foreground hover:bg-fd-accent/60 hover:text-fd-foreground')
                }
              >
                {PRESET_LABELS[p.id as (typeof PRESET_IDS)[number]] ??
                  p.meta.title}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleCopy}
            className="rounded-md border border-fd-border bg-fd-background px-3 py-1.5 text-xs font-medium text-fd-muted-foreground transition hover:bg-fd-accent hover:text-fd-accent-foreground"
            title="Copy JSON"
          >
            Copy JSON
          </button>
          <button
            type="button"
            onClick={handleReset}
            className="rounded-md border border-fd-border bg-fd-background px-3 py-1.5 text-xs font-medium text-fd-muted-foreground transition hover:bg-fd-accent hover:text-fd-accent-foreground"
            title="Restore the original preset"
          >
            Reset
          </button>
        </div>
      </div>

      <div className="grid gap-3 overflow-hidden rounded-2xl border border-fd-border bg-fd-card shadow-2xl ring-1 ring-fd-border md:grid-cols-2 md:gap-0">
        {/* Editor */}
        <div className="flex flex-col border-fd-border md:border-r">
          <div className="flex items-center justify-between gap-2 border-b border-fd-border bg-fd-muted/40 px-4 py-2">
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-red-500" />
              <span className="h-2.5 w-2.5 rounded-full bg-yellow-500" />
              <span className="h-2.5 w-2.5 rounded-full bg-green-500" />
            </div>
            <code className="truncate text-[11px] text-fd-muted-foreground">
              {active.id}
            </code>
          </div>
          <div className="relative">
            <textarea
              ref={textareaRef}
              spellCheck={false}
              value={text}
              onChange={(e) => setText(e.target.value)}
              aria-label="Edit ObjectUI JSON schema"
              className="block h-[420px] w-full resize-none bg-fd-background p-4 font-mono text-[12px] leading-relaxed text-fd-foreground outline-none focus:ring-2 focus:ring-inset focus:ring-fd-ring/40"
            />
            {parseError && (
              <div
                role="status"
                className="absolute bottom-2 left-2 right-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-[11px] text-red-600 shadow-sm dark:text-red-300"
              >
                <span className="font-medium">JSON error:</span> {parseError}
              </div>
            )}
          </div>
        </div>

        {/* Preview */}
        <div className="flex flex-col">
          <div className="flex items-center justify-between gap-2 border-b border-fd-border bg-fd-muted/40 px-4 py-2">
            <span className="text-[11px] font-medium uppercase tracking-wide text-fd-muted-foreground">
              Live preview
            </span>
            <span className="text-[11px] text-fd-muted-foreground">
              Try editing the JSON →
            </span>
          </div>
          <div className="h-[420px] overflow-auto bg-fd-background p-4">
            <PreviewErrorBoundary signal={lastValidSchema}>
              <SchemaRendererContext.Provider value={ctxValue}>
                <SidebarProvider
                  className="min-h-0 w-full"
                  defaultOpen={false}
                >
                  <div className="w-full">
                    <SchemaRenderer schema={toRenderableSchema(lastValidSchema)} />
                  </div>
                </SidebarProvider>
              </SchemaRendererContext.Provider>
            </PreviewErrorBoundary>
          </div>
        </div>
      </div>
    </div>
  );
}
