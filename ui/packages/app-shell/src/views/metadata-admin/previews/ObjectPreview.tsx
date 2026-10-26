// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ObjectPreview — form-designer canvas for an Object metadata draft.
 *
 * Each field renders as the labeled input control it will become at
 * runtime. Clicking a field selects it and the host swaps the right
 * panel to {@link ObjectFieldInspector}. Trailing "+ Add field"
 * button opens a categorized type picker.
 *
 * Read/write of `draft.fields` is non-destructive: the original shape
 * (array vs record) and any unknown properties on each field are
 * preserved via `object-fields-io`.
 */

import * as React from 'react';
import type { MetadataPreviewProps } from '../preview-registry.js';
import { PreviewShell, PreviewMessage, PreviewErrorBoundary } from './PreviewShell.js';
import { ObjectFormCanvas } from './ObjectFormCanvas.js';
import { t } from '../i18n.js';

export function ObjectPreview({
  name,
  draft,
  baseline,
  onPatch,
  selection,
  onSelectionChange,
  locale,
}: MetadataPreviewProps) {
  const objectName = String((draft as any).name ?? name ?? '');

  if (!objectName) {
    return (
      <PreviewShell hint="object">
        <PreviewMessage>
          {t('designer.canvas.nameToStart', locale)}
        </PreviewMessage>
      </PreviewShell>
    );
  }

  return (
    <PreviewShell hint="object · designer">
      <PreviewErrorBoundary fallbackHint={t('engine.objectPreview.renderFailed', locale)}>
        <ObjectFormCanvas
          objectName={objectName}
          draft={draft}
          baseline={baseline}
          onPatch={onPatch}
          selection={selection}
          onSelectionChange={onSelectionChange}
          locale={locale}
        />
      </PreviewErrorBoundary>
    </PreviewShell>
  );
}
