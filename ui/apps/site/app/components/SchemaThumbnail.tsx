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
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { SchemaRenderer, SchemaRendererContext, toRenderableSchema } from '@object-ui/react';
import { SidebarProvider } from '@object-ui/components';
import type { SchemaNode } from '@object-ui/core';
// Registers `@object-ui/layout`'s blocks — see the module header (objectui#3787).
// Named directly, not reached through the module below: `scripts/__tests__/
// site-playground-layout-registration-3904.test.ts` discovers every
// `SchemaRenderer` host and requires it to import THIS module, and a host that
// pulled it in transitively would read to that guard as a host that registers
// nothing (measured — it went red on exactly that).
import './registerLayoutBlocks';
// Registers the dashboard + chart blocks the gallery draws (objectui#4600).
import './registerCatalogBlocks';
import { galleryDataSource } from './galleryDataSource';

// The gallery's data source. It is handed to `SchemaRenderer` BOTH ways on
// purpose: the context is what nested blocks read, while `DashboardRenderer`
// takes `dataSource` as a React prop — a context-only value never reaches it,
// which is why its dataset-bound widgets rendered "This data source does not
// support dataset queries." while the context already held one (objectui#4600).
const defaultCtx = { dataSource: galleryDataSource };

/**
 * Tiny class-based error boundary so a single bad schema doesn't take down
 * the whole gallery. Errors fall back to a quiet placeholder.
 */
class ThumbnailErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch() {
    // Intentionally swallow — gallery context only.
  }

  render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}

interface SchemaThumbnailProps {
  schema: SchemaNode;
  /** Scale factor applied to the rendered schema (e.g. 0.4 = 40%). */
  scale?: number;
  /** Logical viewport width fed to the scaled child. */
  viewportWidth?: number;
  /** CSS aspect-ratio for the thumbnail frame. */
  aspect?: string;
  className?: string;
}

/**
 * A scaled, non-interactive preview of a SchemaRenderer. Mount is deferred
 * until the thumbnail scrolls near the viewport (IntersectionObserver) so a
 * page with hundreds of thumbnails stays responsive.
 */
export function SchemaThumbnail({
  schema,
  scale = 0.4,
  viewportWidth = 900,
  aspect = '4 / 3',
  className,
}: SchemaThumbnailProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);
  const ctx = useMemo(() => defaultCtx, []);

  useEffect(() => {
    if (visible || !ref.current) return;
    const el = ref.current;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true);
            io.disconnect();
            break;
          }
        }
      },
      { rootMargin: '200px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  const inv = 1 / scale;

  return (
    <div
      ref={ref}
      className={
        'relative w-full overflow-hidden rounded-md border border-fd-border bg-fd-background ' +
        (className ?? '')
      }
      style={{ aspectRatio: aspect }}
      aria-hidden
    >
      {visible ? (
        <ThumbnailErrorBoundary
          fallback={
            <div className="flex h-full w-full items-center justify-center p-4 text-center text-xs text-fd-muted-foreground">
              Preview unavailable
            </div>
          }
        >
          <div
            // `inert`, not just `pointer-events: none`: the preview renders the
            // example's own controls, and this frame is `aria-hidden`. A
            // focusable node inside an `aria-hidden` subtree is itself a
            // violation (axe `aria-hidden-focus`), and because the preview
            // precedes the card's open button in DOM order, a keyboard user
            // otherwise tabs through every example's internal buttons before
            // reaching the card (measured: Tab from card 1 stopped on Submit,
            // Save Draft, Delete, Cancel — objectui#3903). `inert` removes the
            // subtree from focus order and hit-testing, which is what makes the
            // "non-interactive preview" in this component's contract true.
            inert
            className="pointer-events-none absolute left-0 top-0 origin-top-left select-none"
            style={{
              width: `${viewportWidth}px`,
              height: `${inv * 100}%`,
              transform: `scale(${scale})`,
            }}
          >
            <SchemaRendererContext.Provider value={ctx}>
              <SidebarProvider className="min-h-0 w-full" defaultOpen={false}>
                <div className="w-full p-4">
                  <SchemaRenderer
                    schema={toRenderableSchema(schema)}
                    dataSource={galleryDataSource}
                  />
                </div>
              </SidebarProvider>
            </SchemaRendererContext.Provider>
          </div>
        </ThumbnailErrorBoundary>
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-fd-muted/40">
          <div className="h-2 w-16 animate-pulse rounded bg-fd-muted-foreground/30" />
        </div>
      )}
    </div>
  );
}
