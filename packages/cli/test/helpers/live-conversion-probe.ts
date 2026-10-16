// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A live ADR-0087 D2 conversion for the door suites that spawn the CLI — the
 * `--import` preload `fixtures/live-conversion-probe.mjs` (its header says why
 * it exists and what it touches) and the names a suite asserts on.
 *
 * Until #23543 F5-http these suites drove `flow-node-http-callout-rename`, the
 * last real entry below 18 left live on the load path. It retired, so a fixture
 * types its converting node {@link LIVE_PROBE.from} instead and the child runs
 * with {@link liveProbeNodeOptions}.
 */
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = resolve(fileURLToPath(import.meta.url), '..');

/** The probe's identity, site spelling and direction — what a notice carries. */
export const LIVE_PROBE = {
  conversionId: 'cli-live-conversion-probe',
  from: 'probe_old_callout',
  to: 'http',
} as const;

/** The preload, as the URL `--import` takes. */
export const LIVE_PROBE_HOOK = pathToFileURL(resolve(HERE, '../fixtures/live-conversion-probe.mjs')).href;

/**
 * `NODE_OPTIONS` for a child that must see the probe: whatever the runner was
 * started with, plus the preload. Stated on every call that wants it; a child
 * spawned without it sees only the published registry.
 */
export function liveProbeNodeOptions(): string {
  return [process.env.NODE_OPTIONS, `--import ${LIVE_PROBE_HOOK}`].filter(Boolean).join(' ');
}
