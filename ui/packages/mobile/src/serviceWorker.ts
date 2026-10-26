/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

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
