// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { createMemoryCache } from './memory-cache.js';
import { createMemoryQueue } from './memory-queue.js';
import { createMemoryJob } from './memory-job.js';
import { createMemoryI18n } from './memory-i18n.js';
import { createMemoryMetadata } from './memory-metadata.js';

export { createMemoryCache } from './memory-cache.js';
export { createMemoryQueue } from './memory-queue.js';
export { createMemoryJob } from './memory-job.js';
export { createMemoryI18n, resolveLocale, deepMerge } from './memory-i18n.js';
export { createMemoryMetadata } from './memory-metadata.js';
export {
  wireAuthoredTranslationSync,
  readAuthoredTranslationLayer,
} from './authored-translation-sync.js';

/**
 * Map of core-criticality service names to their in-memory fallback factories.
 * Used by ObjectKernel.validateSystemRequirements() to auto-inject fallbacks
 * when no real plugin provides the service.
 */
export const CORE_FALLBACK_FACTORIES: Record<string, () => Record<string, any>> = {
  metadata: createMemoryMetadata,
  cache: createMemoryCache,
  queue: createMemoryQueue,
  job:   createMemoryJob,
  i18n:  createMemoryI18n,
};
