/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from 'react';
import { Dialog, DialogContent, DialogTitle, DIALOG_VIEWPORT_GUTTER } from '@object-ui/components';
import { useObjectTranslation } from '@object-ui/i18n';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export interface LightboxImage {
  url: string;
  name?: string;
}

export interface ImageLightboxProps {
  images: LightboxImage[];
  /** Index of the image shown when the lightbox opens. */
  index: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called when the user navigates to another image (prev/next, arrow keys). */
  onIndexChange?: (index: number) => void;
}

/**
 * Full-screen image preview with prev/next navigation for a set of images.
 *
 * Controlled: the caller owns `open` and the current `index`. Built on the
 * shared `Dialog`, so backdrop-click and Escape close it for free; this adds
 * left/right arrow-key navigation and a position counter for the multi-image
 * case. A single image simply omits the arrows and counter.
 */
export function ImageLightbox({ images, index, open, onOpenChange, onIndexChange }: ImageLightboxProps) {
  const { t } = useObjectTranslation();
  const count = images.length;
  const current = images[index];

  const go = React.useCallback(
    (delta: number) => {
      if (count <= 1) return;
      const next = (index + delta + count) % count;
      onIndexChange?.(next);
    },
    [count, index, onIndexChange],
  );

  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        go(1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        go(-1);
      }
    },
    [go],
  );

  if (!current) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={`max-w-[92vw] sm:max-w-4xl ${DIALOG_VIEWPORT_GUTTER} p-0 bg-transparent border-0 shadow-none`}
        onKeyDown={handleKeyDown}
      >
        {/* Title is required for a labelled dialog but visually redundant here. */}
        <DialogTitle className="sr-only">{current.name || t('fields.image.preview')}</DialogTitle>
        <div className="relative flex items-center justify-center">
          <img
            src={current.url}
            alt={current.name || t('fields.image.imageAlt', { index: index + 1 })}
            className="max-h-[85vh] max-w-full rounded-md object-contain"
          />

          {count > 1 && (
            <>
              <button
                type="button"
                onClick={() => go(-1)}
                aria-label={t('fields.image.previous')}
                className="absolute left-2 top-1/2 -translate-y-1/2 flex size-9 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
              >
                <ChevronLeft className="size-5" />
              </button>
              <button
                type="button"
                onClick={() => go(1)}
                aria-label={t('fields.image.next')}
                className="absolute right-2 top-1/2 -translate-y-1/2 flex size-9 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
              >
                <ChevronRight className="size-5" />
              </button>
              <div className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/50 px-2.5 py-1 text-xs font-medium text-white">
                {t('fields.image.counter', { current: index + 1, total: count })}
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
