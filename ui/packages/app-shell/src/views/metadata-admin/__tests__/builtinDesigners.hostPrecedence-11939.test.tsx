// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11939 step 2 — a host's own designer registration survives the
 * built-in designers arriving late, in BOTH orders.
 *
 * The package entry now registers the built-in previews and inspectors from a
 * chunk it loads with a dynamic `import()`, so the built-ins land AFTER the
 * host's start-up code has run. objectui#11798 measured what a naive lazy door
 * does to the override `previews/index.ts` documents: a host override
 * registered after the entry import "is overwritten under a lazy door". The
 * built-in pass (`registerAsBuiltIns`, run by `registerBuiltinDesigners`) fills
 * only a type that has no entry, so:
 *
 *   - host FIRST, built-ins later: the host's entry is kept (module scope
 *     below, in all three registries);
 *   - built-ins FIRST, host later: the host replaces the built-in, and a reader
 *     re-renders with it — `register*` is last-write-wins, as always.
 *
 * Controls: every type the host did not register gets its built-in, and a
 * second built-in pass changes no entry and re-renders no reader.
 *
 * Order-independent: the host-first registrations and the built-ins' arrival
 * happen once, at module scope, before any test; each test then owns its own
 * types (host-first: `flow` / `action`; host-after: `page`; the second pass:
 * `dashboard`).
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';

import {
  getMetadataPreview,
  listMetadataPreviewTypes,
  registerMetadataPreview,
  useRegisteredMetadataPreview,
  type MetadataPreviewProps,
} from '../preview-registry';
import {
  getMetadataInspector,
  registerMetadataInspector,
  type MetadataInspectorProps,
} from '../inspector-registry';
import {
  getMetadataDefaultInspector,
  registerMetadataDefaultInspector,
  type MetadataDefaultInspectorProps,
} from '../default-inspector-registry';
import { registerBuiltinDesigners } from '../register-builtin-designers';
import { DashboardPreview } from '../previews/DashboardPreview';
import { PagePreview } from '../previews/PagePreview';
import { ViewInspector } from '../inspectors/ViewInspector';
import { HookDefaultInspector } from '../inspectors/HookDefaultInspector';

afterEach(cleanup);

function HostFlowPreview(_props: MetadataPreviewProps) {
  return <div data-testid="host-flow-preview" />;
}
function HostFlowInspector(_props: MetadataInspectorProps) {
  return <div data-testid="host-flow-inspector" />;
}
function HostActionInspector(_props: MetadataDefaultInspectorProps) {
  return <div data-testid="host-action-inspector" />;
}
function HostPagePreview(_props: MetadataPreviewProps) {
  return <div data-testid="host-page-preview" />;
}

// ── Host FIRST: the host registers, then the built-ins arrive. ──────────────
// The registries are empty before the host writes: stated, not assumed, so the
// host-first case below cannot pass because something else filled them.
const typesBeforeTheHost = listMetadataPreviewTypes();
registerMetadataPreview('flow', HostFlowPreview);
registerMetadataInspector('flow', HostFlowInspector);
registerMetadataDefaultInspector('action', HostActionInspector);
// …and then the built-in designers land, as the package entry's `.then` does.
registerBuiltinDesigners();

/** Prints which component the observed read returns for `type`. */
function Probe({ type }: { type: string }) {
  const Preview = useRegisteredMetadataPreview(type);
  const name = Preview ? (Preview.name || 'anonymous') : 'none';
  return <div data-testid={`probe-${type}`}>{name}</div>;
}

describe('built-in designers and a host registration (objectui#11939 step 2)', () => {
  it('a host designer registered BEFORE the built-ins arrive is kept, in all three registries', () => {
    expect(typesBeforeTheHost).toEqual([]);

    expect(getMetadataPreview('flow')).toBe(HostFlowPreview);
    expect(getMetadataInspector('flow')).toBe(HostFlowInspector);
    expect(getMetadataDefaultInspector('action')).toBe(HostActionInspector);

    // Control: the pass did run — every type the host left alone got its built-in.
    expect(getMetadataPreview('dashboard')).toBe(DashboardPreview);
    expect(getMetadataInspector('view')).toBe(ViewInspector);
    expect(getMetadataDefaultInspector('hook')).toBe(HookDefaultInspector);
  });

  it('a host designer registered AFTER the built-ins arrived replaces the built-in, and its reader re-renders', () => {
    expect(getMetadataPreview('page')).toBe(PagePreview);
    render(<Probe type="page" />);
    expect(screen.getByTestId('probe-page')).toHaveTextContent('PagePreview');

    act(() => registerMetadataPreview('page', HostPagePreview));
    expect(getMetadataPreview('page')).toBe(HostPagePreview);
    expect(screen.getByTestId('probe-page')).toHaveTextContent('HostPagePreview');
  });

  it('a second built-in pass changes no entry and re-renders no reader', () => {
    const before = new Map(listMetadataPreviewTypes().map((t) => [t, getMetadataPreview(t)]));
    // Every commit of the reader's subtree, counted by React itself.
    let commits = 0;
    render(
      <React.Profiler id="dashboard-reader" onRender={() => { commits += 1; }}>
        <Probe type="dashboard" />
      </React.Profiler>,
    );
    expect(screen.getByTestId('probe-dashboard')).toHaveTextContent('DashboardPreview');
    const commitsBefore = commits;
    expect(commitsBefore).toBeGreaterThan(0);

    act(() => registerBuiltinDesigners());

    expect(new Map(listMetadataPreviewTypes().map((t) => [t, getMetadataPreview(t)]))).toEqual(before);
    expect(commits).toBe(commitsBefore);
  });
});
