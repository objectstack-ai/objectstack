/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { PWAConfig } from '@object-ui/types';

/**
 * Generates a Web App Manifest object from PWAConfig.
 * Can be serialized to JSON and served at /manifest.json.
 */
export function generatePWAManifest(config: PWAConfig): Record<string, unknown> {
  return {
    name: config.name,
    short_name: config.shortName,
    description: config.description,
    theme_color: config.themeColor ?? '#3b82f6',
    background_color: config.backgroundColor ?? '#ffffff',
    display: config.display ?? 'standalone',
    start_url: config.startUrl ?? '/',
    scope: config.scope ?? '/',
    orientation: config.orientation ?? 'any',
    icons: config.icons?.map((icon) => ({
      src: icon.src,
      sizes: icon.sizes,
      type: icon.type ?? 'image/png',
      purpose: icon.purpose ?? 'any',
    })) ?? [],
  };
}
