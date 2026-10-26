/**
 * Legacy entry — re-exports from the DOM setup file. Keeps existing
 * `setupFiles: ['vitest.setup.tsx']` references working. New configs should
 * point at either `vitest.setup.base.ts` (node-env unit tests) or
 * `vitest.setup.dom.tsx` (component render tests) directly.
 */
import './vitest.setup.dom';
