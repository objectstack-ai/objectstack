// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// The shared preset (see its header), merged with this package's one setting.
import { mergeConfig } from 'vitest/config';
import preset from '../../../vitest.preset.mts';

export default mergeConfig(preset, {
  test: {
    // #13517: quiet the registry's per-item registration chatter — the
    // engine's own `OS_REGISTRY_LOG` seam, not a change to its shipped
    // default. Enforced by scripts/check-registry-log-declared.mjs, which
    // reads this suite as engine-booting since `template-loader.test.ts`
    // resolves email template names through a real `SchemaRegistry`
    // (ADR-0150 D3).
    env: { OS_REGISTRY_LOG: 'warn' },
  },
});
