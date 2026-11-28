// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The loader of the audience catalog the `ref-multi:capability` picker offers
 * — the capabilities the environment knows, the permission sets granting each
 * and the positions holding them (objectstack#34908).
 *
 * A host hands the loader down on {@link WidgetContext}; it does not call it.
 * The picker itself reads the three registries, once it is on screen, so an
 * editor whose audience row sits in a closed section, or whose form declares
 * no such row, sends no request. The loader is stable per source, so the
 * picker's read runs once per mount, not once per render.
 */

import * as React from 'react';
import {
  loadCapabilityAudience,
  type CapabilityAudience,
  type CapabilityAudienceSource,
} from '../capabilityAudience.js';

export function useCapabilityAudienceLoader(
  source: CapabilityAudienceSource | null | undefined,
): (() => Promise<CapabilityAudience>) | undefined {
  return React.useMemo(() => (source ? () => loadCapabilityAudience(source) : undefined), [source]);
}
