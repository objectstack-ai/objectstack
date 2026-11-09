/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * useNavTargetIcon — the console's answer to "which icon does the object this
 * navigation entry opens declare?", for `object` entries that name no `icon`,
 * as a {@link NavTargetIconResolver}.
 *
 * It reads the object by name from the metadata cache the shell already holds
 * (`readObjectsByName`, the same read `useNavTargetLabel({ byName: true })`
 * makes for the entry's text), so the sidebar loads no extra list for it.
 * Nothing is stored: a changed object icon shows on the next render. An object
 * with no `icon`, or one not loaded yet, answers `undefined` and the row keeps
 * the renderer's generic icon.
 */

import { useMemo } from 'react';
import type { NavIconTarget, NavTargetIconResolver } from '@object-ui/layout';
import { useMetadata } from '../providers/MetadataProvider.js';
import { readObjectsByName } from './useObjectPresence.js';

export function useNavTargetIcon(): NavTargetIconResolver {
  const metadata = useMetadata();
  return useMemo<NavTargetIconResolver>(
    () => (target: NavIconTarget) => {
      if (target.kind !== 'object') return undefined;
      const def = readObjectsByName(metadata, [target.objectName]).find(
        (item): item is { name: string; icon?: unknown } =>
          !!item && typeof item === 'object' && (item as { name?: unknown }).name === target.objectName,
      );
      return typeof def?.icon === 'string' && def.icon.trim() !== '' ? def.icon : undefined;
    },
    [metadata],
  );
}
