// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Built-in Plugin: View Live Preview
 *
 * Renders `view` (and `page`/`report`/`dashboard`) metadata as a real
 * runtime preview via @object-ui — grid, kanban, calendar, form, detail.
 *
 * Lives at priority 50 so it beats the default JSON inspector (-1) but
 * stays below specialised viewers (object-explorer at 100, flow-viewer
 * at 10 isn't a conflict because we target different types).
 *
 * The viewer loads the metadata item using the (project-scoped if
 * available) client, then hands the spec to {@link MetadataPreview}.
 * `useMetadataHmr()` is read so previews remount when the developer
 * edits source — HMR is built in.
 */

import { useEffect, useMemo, useState } from 'react';
import { defineStudioPlugin } from '@objectstack/spec/studio';
import { useClient } from '@objectstack/client-react';
import { useParams } from '@tanstack/react-router';
import { useScopedClient } from '@/hooks/useObjectStackClient';
import { useMetadataHmr } from '@/hooks/useMetadataHmr';
import { MetadataPreview } from '@/components/MetadataPreview';
import type { StudioPlugin, MetadataViewerProps } from '../types';

function LivePreviewViewer({ metadataType, metadataName, data, packageId }: MetadataViewerProps) {
  const unscopedClient = useClient();
  const params = useParams({ strict: false }) as { projectId?: string };
  const scopedClient = useScopedClient(params.projectId);
  const client: any = scopedClient ?? unscopedClient;
  const { version: hmrVersion } = useMetadataHmr();

  const [item, setItem] = useState<any>(data ?? null);
  const [loading, setLoading] = useState(!data);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (data) {
      setItem(data);
      setLoading(false);
      return;
    }
    let mounted = true;
    setLoading(true);
    setError(null);
    client.meta
      .getItem(metadataType, metadataName, packageId ? { packageId } : undefined)
      .then((res: any) => {
        if (!mounted) return;
        setItem(res?.item ?? res ?? null);
      })
      .catch((err: unknown) => {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
    // hmrVersion intentionally included so a source edit re-fetches the spec
    // before MetadataPreview's own remount kicks in.
  }, [client, metadataType, metadataName, packageId, data, hmrVersion]);

  const { spec, objectName } = useMemo(() => {
    if (!item) return { spec: null, objectName: undefined };
    const s = item?.spec ?? item;
    const o =
      s?.data?.object ??
      s?.objectName ??
      s?.list?.data?.object ??
      s?.form?.data?.object ??
      undefined;
    return { spec: s, objectName: o };
  }, [item]);

  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading preview…</div>;
  }
  if (error || !spec) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="max-w-md rounded-md border border-dashed bg-muted/30 p-6 text-center text-sm text-muted-foreground">
          <p className="font-medium text-foreground">Nothing to preview</p>
          <p className="mt-1">
            We couldn't find a definition for{' '}
            <code className="font-mono text-xs">{metadataName}</code>. It may have been
            deleted or never existed in this package.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <MetadataPreview
        type={metadataType}
        name={metadataName}
        spec={spec}
        objectName={objectName}
      />
    </div>
  );
}

export const viewPreviewPlugin: StudioPlugin = {
  manifest: defineStudioPlugin({
    id: 'objectstack.view-preview',
    name: 'View Live Preview',
    version: '1.0.0',
    description: 'Renders view, page, report, and dashboard metadata as a live preview via @object-ui.',
    contributes: {
      metadataViewers: [
        {
          id: 'view-live-preview',
          metadataTypes: ['view', 'page', 'report', 'dashboard'],
          label: 'Live Preview',
          priority: 50,
          modes: ['preview'],
        },
      ],
    },
  }),

  activate(api) {
    api.registerViewer('view-live-preview', LivePreviewViewer);
  },
};
