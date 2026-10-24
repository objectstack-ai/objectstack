/**
 * ObjectStack Console Plugin
 *
 * Serves the pre-built Console SPA as a static UI plugin.
 * HonoServerPlugin auto-discovers this plugin via `type: 'ui-plugin'`
 * and mounts it at `/<slug>` (i.e. `/console`).
 *
 * The SPA is built with base path '/'.
 *
 * Usage in any ObjectStack application:
 *
 *   import { ConsolePlugin } from '@object-ui/console';
 *
 *   export default {
 *     plugins: [
 *       new HonoServerPlugin({ port: 3000 }),
 *       new ConsolePlugin(),
 *     ],
 *   };
 *
 * @see https://github.com/objectstack-ai/objectui
 */

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Absolute path to the built SPA assets (dist/) */
export const staticPath = resolve(__dirname, 'dist');

export class ConsolePlugin {
  readonly name = '@object-ui/console';
  readonly version = '1.0.0';
  readonly type = 'ui-plugin' as const;
  readonly slug = 'console';
  readonly staticPath = staticPath;
  readonly default = true;
  readonly description = 'ObjectStack Console - The standard runtime UI for ObjectStack applications';

  readonly metadata = {
    author: 'ObjectUI Team',
    license: 'MIT',
    homepage: 'https://www.objectui.org',
    repository: 'https://github.com/objectstack-ai/objectui',
    capabilities: [
      'ui-rendering',
      'crud-operations',
      'multi-app-support',
      'dynamic-navigation',
      'theme-support',
    ],
  };

  init() {
    // No initialization needed — HonoServerPlugin handles static serving & SPA fallback
  }

  async start(_ctx: any) {
    // Static file serving and SPA fallback are handled automatically by
    // HonoServerPlugin's auto-discovery (type: 'ui-plugin', slug: 'console').
    // No custom route registration needed.
  }
}

export default ConsolePlugin;
