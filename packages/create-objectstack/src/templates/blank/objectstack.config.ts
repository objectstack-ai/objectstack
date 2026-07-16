import { defineStack } from '@objectstack/spec';
import * as objects from './src/objects/index.js';

export default defineStack({
  manifest: {
    id: 'blank',
    namespace: 'blank',
    version: '0.1.0',
    type: 'app',
    name: 'Blank Starter',
    description: 'Minimal ObjectStack environment — a clean slate for building.',
    // Protocol compatibility range (ADR-0087 D1): lets an incompatible runtime
    // refuse this package at the boundary with the exact migration command,
    // instead of crashing later. Kept in lockstep with releases by
    // scripts/sync-template-versions.mjs.
    engines: { protocol: '^15' },
  },
  objects: Object.values(objects),
});
