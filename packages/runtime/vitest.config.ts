// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      // Subpath before the bare package: the object form prefix-replaces, so
      // without this entry `@objectstack/core/logger` (imported by the built
      // client, see route-ledger.conformance.test.ts) resolves to the garbage
      // path `…/core/src/index.ts/logger`.
      '@objectstack/core/logger': path.resolve(__dirname, '../core/src/logger.ts'),
      '@objectstack/core': path.resolve(__dirname, '../core/src/index.ts'),
      '@objectstack/rest': path.resolve(__dirname, '../rest/src/index.ts'),
      '@objectstack/spec/ai': path.resolve(__dirname, '../spec/src/ai/index.ts'),
      '@objectstack/spec/api': path.resolve(__dirname, '../spec/src/api/index.ts'),
      // `AppPlugin` reads a bundle function's declared effect off this
      // namespace (#4396).
      '@objectstack/spec/automation': path.resolve(__dirname, '../spec/src/automation/index.ts'),
      '@objectstack/spec/contracts': path.resolve(__dirname, '../spec/src/contracts/index.ts'),
      '@objectstack/spec/data': path.resolve(__dirname, '../spec/src/data/index.ts'),
      // Reached via `@objectstack/platform-objects` (sys-user.object.ts), which
      // notifications.hono.integration.test.ts pulls in for the real
      // `sys_notification` declaration.
      '@objectstack/spec/identity': path.resolve(__dirname, '../spec/src/identity/index.ts'),
      '@objectstack/spec/kernel': path.resolve(__dirname, '../spec/src/kernel/index.ts'),
      '@objectstack/spec/shared': path.resolve(__dirname, '../spec/src/shared/index.ts'),
      '@objectstack/spec/system': path.resolve(__dirname, '../spec/src/system/index.ts'),
      '@objectstack/spec/ui': path.resolve(__dirname, '../spec/src/ui/index.ts'),
      // [ADR-0105 D1] Reached transitively via `@objectstack/types` (tenancy posture).
      '@objectstack/spec/security': path.resolve(__dirname, '../spec/src/security/index.ts'),
      '@objectstack/spec': path.resolve(__dirname, '../spec/src/index.ts'),
      '@objectstack/types': path.resolve(__dirname, '../types/src/index.ts'),
      // Dev-only: app-plugin.jobs.test.ts drives the REAL CronJobAdapter, so
      // the #4567 regression (croner rejecting the expression envelope) is
      // reproduced by the actual scheduler rather than by a double.
      '@objectstack/service-job': path.resolve(__dirname, '../services/service-job/src/index.ts'),
      // Dev-only: app-plugin.disabled-seed.test.ts drives the REAL
      // `sys_packages` → registry rehydration (#5047), so the empty-env seed
      // regression is proven against the actual hydration code rather than a
      // re-implementation of it.
      '@objectstack/service-package': path.resolve(__dirname, '../services/service-package/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
