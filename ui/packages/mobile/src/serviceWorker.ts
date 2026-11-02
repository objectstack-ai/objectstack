/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { SERVICE_WORKER_CACHE_URLS_MESSAGE } from './serviceWorkerSource.js';

export interface ServiceWorkerConfig {
  /** URL of the service worker script */
  url?: string;
  /** Registration scope */
  scope?: string;
  /** Callback on successful registration */
  onSuccess?: (registration: ServiceWorkerRegistration) => void;
  /** Callback on update available */
  onUpdate?: (registration: ServiceWorkerRegistration) => void;
  /** Callback on error */
  onError?: (error: Error) => void;
}

/**
 * Registers a service worker for PWA support.
 * Safe to call in non-browser environments (no-op).
 */
export async function registerServiceWorker(
  config: ServiceWorkerConfig = {},
): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return null;
  }

  const swUrl = config.url ?? '/service-worker.js';

  try {
    const registration = await navigator.serviceWorker.register(swUrl, {
      scope: config.scope ?? '/',
    });

    registration.onupdatefound = () => {
      const installingWorker = registration.installing;
      if (!installingWorker) return;

      installingWorker.onstatechange = () => {
        if (installingWorker.state === 'installed') {
          if (navigator.serviceWorker.controller) {
            // Update available
            config.onUpdate?.(registration);
          } else {
            // First install
            config.onSuccess?.(registration);
          }
        }
      };
    };

    return registration;
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    config.onError?.(err);
    return null;
  }
}

/**
 * Asks an `'app-shell'` worker (`getServiceWorkerSource({ strategy: 'app-shell' })`)
 * to cache the files this page loaded before the worker controlled it, so the
 * first visit's lazy chunks are there for an offline start. The worker keeps
 * only same-origin files in its scope and never one under its API prefix.
 * No-op without a worker or the Performance API.
 */
export function cacheLoadedResources(worker: ServiceWorker | null | undefined): void {
  if (!worker || typeof performance === 'undefined' || typeof performance.getEntriesByType !== 'function') return;
  const urls = performance.getEntriesByType('resource').map((entry) => entry.name);
  worker.postMessage({ type: SERVICE_WORKER_CACHE_URLS_MESSAGE, urls });
}
