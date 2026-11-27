// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Load the audience catalog the `ref-multi:capability` picker offers — the
 * capabilities the environment knows, the permission sets granting each and
 * the positions holding them (objectstack#34908) — as a {@link LoadState}, so
 * a failed read reaches the picker as a failure, not as an empty catalog.
 *
 * `enabled` false sends no request and answers `idle`: a host passes
 * `formDeclaresWidget(form, 'ref-multi:capability')`, so only an editor whose
 * form carries the audience row reads the three registries.
 */

import * as React from 'react';
import {
  loadCapabilityAudience,
  type CapabilityAudience,
  type CapabilityAudienceSource,
} from '../capabilityAudience.js';
import { usePickerLoad, type LoadState } from './loadState.js';

export function useCapabilityAudienceLoad(
  source: CapabilityAudienceSource | null | undefined,
  enabled: boolean,
): LoadState<CapabilityAudience> {
  return usePickerLoad<CapabilityAudience>(
    React.useMemo(
      () => (enabled && source ? () => loadCapabilityAudience(source) : null),
      [enabled, source],
    ),
  );
}
