// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * MetadataDetailDrawer — slide-over editor for a related metadata item.
 *
 * Opens from the parent's Related tab without taking the user away
 * from the parent's context. Internally we mount the same
 * `MetadataResourceEditPage` used by the full-page route, so all the
 * Save / Reset / Validate behaviour is shared. The drawer just frames
 * it and adds a "Open full page ↗" affordance.
 *
 * Width is wide enough for forms (max 1100px) but capped at 92vw to
 * leave a thin strip of the parent visible behind, reinforcing the
 * "still in the same object" feel.
 */

import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  Button,
  Badge,
  cn,
} from '@object-ui/components';
import { MetadataResourceEditPage } from './ResourceEditPage.js';
import { EmbeddedItemEditor } from './EmbeddedItemEditor.js';
import type { RelatedTarget } from './RelatedPanel.js';

export interface MetadataDetailDrawerProps {
  /** When non-null, drawer is open and shows this target. */
  target: RelatedTarget | null;
  /** Called when the drawer requests close (overlay click, esc, close btn). */
  onClose: () => void;
  /** Optional context: parent's type / name, shown in the title. */
  parentContext?: { type: string; name: string };
}

export function MetadataDetailDrawer({
  target,
  onClose,
  parentContext,
}: MetadataDetailDrawerProps) {
  const navigate = useNavigate();

  const isMetadata = target?.kind === 'metadata';
  const isEmbedded = target?.kind === 'embedded';
  const headerType = isMetadata
    ? target.type
    : isEmbedded
      ? target.groupLabel
      : '';
  const headerName = isMetadata
    ? target.name
    : isEmbedded
      ? target.itemName
      : '';

  return (
    <Sheet
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent
        side="right"
        className={cn(
          'w-[92vw] sm:max-w-[1100px] p-0 flex flex-col gap-0',
        )}
      >
        <SheetHeader className="px-4 py-3 border-b space-y-1">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-mono text-[10px]">
              {headerType}
            </Badge>
            <SheetTitle className="font-mono text-base truncate">
              {headerName}
            </SheetTitle>
            <div className="ml-auto flex items-center gap-1">
              {isMetadata && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    navigate(
                      `../../${encodeURIComponent(target.type)}/${encodeURIComponent(target.name)}`,
                    );
                    onClose();
                  }}
                  title="Open in full page"
                >
                  <ExternalLink className="h-3.5 w-3.5 mr-1" />
                  Open full page
                </Button>
              )}
            </div>
          </div>
          {parentContext && (
            <SheetDescription className="text-xs">
              {isEmbedded ? 'Embedded in ' : 'Related to '}
              <span className="font-mono">
                {parentContext.type}/{parentContext.name}
              </span>
            </SheetDescription>
          )}
        </SheetHeader>

        <div className="flex-1 min-h-0 overflow-auto">
          {isMetadata && (
            <MetadataResourceEditPage
              key={`${target.type}/${target.name}`}
              type={target.type}
              name={target.name}
              embedded
            />
          )}
          {isEmbedded && (
            <EmbeddedItemEditor
              key={`${target.parentType}/${target.parentName}/${target.embeddedPath}/${target.itemName}`}
              parentType={target.parentType}
              parentName={target.parentName}
              embeddedPath={target.embeddedPath}
              itemName={target.itemName}
              editAs={target.editAs}
              initialRaw={target.raw}
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
