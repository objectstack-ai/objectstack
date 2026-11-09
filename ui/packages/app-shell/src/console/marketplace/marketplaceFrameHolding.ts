// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Whether the marketplace pages' strings frame (`MarketplaceNamespaceGate`) is
 * holding its page back right now (objectstack#30588).
 *
 * A language switch sends the frame back to its load skeleton until that
 * language's catalogue has arrived, which unmounts the page body while the
 * visitor stays on the page. An unmount cleanup that means "the visitor left
 * the page" (`SampleDataLeaveBanner`) calls this first.
 *
 * The answer is a function, read in the cleanup, never during render. The
 * frame sets it in the layout phase of the commit that swaps the page out, and
 * that runs before the commit's passive cleanups. It stays false when the
 * route itself is left, since the frame then unmounts without re-rendering.
 * `null` outside a frame.
 */

import { createContext, useContext } from 'react';

export const MarketplaceFrameHolding = createContext<(() => boolean) | null>(null);

export function useMarketplaceFrameHolding(): (() => boolean) | null {
  return useContext(MarketplaceFrameHolding);
}
