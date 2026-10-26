/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { AppComponentSchema, PageNodeSchema } from '@object-ui/types';

export interface MetadataLoader {
  loadAppConfig(): Promise<AppComponentSchema | null>;
  loadPage(path: string): Promise<PageNodeSchema | null>;
}

/**
 * Strategy A: Local Bundle Loader (Vite Glob)
 *
 * Reads metadata bundled at build time from `packages/runner/src/app-data/`.
 * That directory is gitignored and absent from a fresh checkout, so the globs
 * below compile to an empty map and every load returns null until something
 * populates it — no script in this repo does. Use `NetworkLoader` to fetch the
 * same metadata from an API instead.
 */
export class LocalBundleLoader implements MetadataLoader {
  private appGlob = import.meta.glob('../app-data/app.json');
  private pagesGlob = import.meta.glob('../app-data/pages/**/*.json');
  private rootGlob = import.meta.glob('../app-data/*.json');

  async loadAppConfig(): Promise<AppComponentSchema | null> {
    const key = '../app-data/app.json';
    if (this.appGlob[key]) {
      const mod: any = await this.appGlob[key]();
      return mod.default || mod;
    }
    return null;
  }

  async loadPage(path: string): Promise<PageNodeSchema | null> {
    // 1. Normalize Path
    const normalizedPath = path.replace(/^\//, '') || 'index';

    // 2. Try Exact Match in Pages
    if (await this.tryLoad(`../app-data/pages/${normalizedPath}.json`)) {
       return await this.loadKey(`../app-data/pages/${normalizedPath}.json`);
    }

    // 3. Try Index Match
    if (await this.tryLoad(`../app-data/pages/${normalizedPath}/index.json`)) {
       return await this.loadKey(`../app-data/pages/${normalizedPath}/index.json`);
    }

    // 4. Try Root fallback
    if (normalizedPath === 'index' && await this.tryLoad(`../app-data/index.json`)) {
        return await this.loadKey(`../app-data/index.json`);
    }

    // 5. Dynamic Routing (Basic Mock)
    // TODO: Implement proper glob matching for dynamic routes if needed here, 
    // but usually exact paths are enough for this loader demo.
    return null; 
  }

  private async tryLoad(key: string) {
    return !!(this.pagesGlob[key] || this.rootGlob[key]);
  }

  private async loadKey(key: string) {
    const loader = this.pagesGlob[key] || this.rootGlob[key];
    if (!loader) return null;
    const mod: any = await loader();
    return mod.default || mod;
  }
}

/**
 * Strategy B: Network Loader (Fetch API)
 * Used in production to fetch JSONs from an API endpoint
 */
export class NetworkLoader implements MetadataLoader {
  private baseUrl: string;

  constructor(baseUrl: string = '/api') {
    this.baseUrl = baseUrl;
  }

  async loadAppConfig(): Promise<AppComponentSchema | null> {
    try {
      const res = await fetch(`${this.baseUrl}/app.json`);
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  async loadPage(path: string): Promise<PageNodeSchema | null> {
    try {
      // Maps /customers -> /api/pages/customers.json
      const jsonPath = path === '/' ? '/index' : path;
      const res = await fetch(`${this.baseUrl}/pages${jsonPath}.json`);
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }
}
