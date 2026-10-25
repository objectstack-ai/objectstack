/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { ComponentRegistry } from '@object-ui/core';
import type { ToasterSchema } from '@object-ui/types';
import { Toaster as SonnerToaster } from '../../ui/sonner';

/**
 * Spec `NotificationPositionSchema` (`ui/notification.zod.ts`, underscore
 * spellings) → sonner's hyphenated position ids. The hyphen spellings are
 * `ToasterSchema`'s own dialect and map through as identities, so both
 * registers work. Before #2942 the renderer mounted `<SonnerToaster />` bare
 * (`inputs: []`) and every authored position — all six spec values — plus
 * `limit` validated and changed nothing. Exported for the spec-parity test.
 */
export const TOASTER_POSITIONS: Record<
  string,
  'top-left' | 'top-center' | 'top-right' | 'bottom-left' | 'bottom-center' | 'bottom-right'
> = {
  top_left: 'top-left',
  top_center: 'top-center',
  top_right: 'top-right',
  bottom_left: 'bottom-left',
  bottom_center: 'bottom-center',
  bottom_right: 'bottom-right',
  // ToasterSchema's hyphen dialect — identity entries.
  'top-left': 'top-left',
  'top-center': 'top-center',
  'top-right': 'top-right',
  'bottom-left': 'bottom-left',
  'bottom-center': 'bottom-center',
  'bottom-right': 'bottom-right',
};

ComponentRegistry.register(
  'toaster',
  ({ schema }: { schema: ToasterSchema }) => {
    const position = schema?.position ? TOASTER_POSITIONS[schema.position] : undefined;
    const limit = typeof schema?.limit === 'number' && schema.limit > 0 ? schema.limit : undefined;
    return (
      <SonnerToaster
        {...(position ? { position } : {})}
        {...(limit ? { visibleToasts: limit } : {})}
      />
    );
  },
  {
    namespace: 'ui',
    label: 'Toaster',
    inputs: [
      {
        name: 'position',
        type: 'enum',
        enum: ['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right'],
      },
      { name: 'limit', type: 'number' },
    ],
    defaultProps: {},
  },
);
