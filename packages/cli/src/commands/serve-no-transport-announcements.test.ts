// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #23743 — a `serve` boot announces an address only when an HTTP transport is
 * composed, and the banner's `MCP:` row prints only when the route's owner is
 * composed.
 *
 * ## The two defects
 *
 * 1. `os serve <config> --no-server --preset minimal`, spawned with an `ipc`
 *    channel, received `{ type: 'objectstack:listening', port, url }` and
 *    found `runtime.<environment>.<project>.json` carrying the same `url`, and
 *    a `GET` to it answered `ECONNREFUSED`. `objectstack:listening` is
 *    documented as "The HTTP server is bound" (`content/docs/deployment/cli.mdx`).
 *    `resolveBoundPort` falls back to the REQUESTED port when no transport is
 *    registered, by design, and the publish site drove all three channels on
 *    every boot. PR #23741 had gated only the banner's address rows.
 * 2. Under `--no-server`, a config that mounts its own `HonoServerPlugin`
 *    printed `MCP: http://localhost:PORT/api/v1/mcp`, and that route answered
 *    404: its owner, the runtime dispatcher, is composed only under `--server`.
 *
 * ## What this file pins, and what it leaves to the boot
 *
 * The BEHAVIOUR of the new kernel read ({@link readComposedMcpRouteOwner}) is
 * driven against a real `ObjectKernel` and against fakes. The WIRING inside
 * `run()` (one ~3000-line method that needs a whole kernel to enter) is a
 * source pin with comments masked, the same way
 * `serve-bound-port-publication.test.ts` pins the bound-port call site.
 * `serve-no-transport-announcements.integration.test.ts` drives both through
 * real boots of the built CLI and reads the IPC messages and the state file.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ObjectKernel } from '@objectstack/core';
import { createDispatcherPlugin } from '@objectstack/runtime';

// The repo's ONE code/prose separator, as `serve-bound-port-publication.test.ts`
// uses it: a comment saying the publish is gated must not answer for code that
// is not.
import { maskComments } from '../../../../scripts/js-comment-mask.mjs';

import { MCP_ROUTE_OWNER_PLUGIN, readComposedMcpRouteOwner } from './serve.js';

/** …/packages/cli/src/commands — seeded from `import.meta.url`. */
const HERE = resolve(fileURLToPath(import.meta.url), '..');
const SERVE_RAW = readFileSync(resolve(HERE, 'serve.ts'), 'utf8');
/** `serve.ts`'s CODE, with every comment span blanked. */
const SERVE = maskComments(SERVE_RAW);

/** A plugin that registers nothing, under `name`. */
const bare = (name: string) => ({ name, version: '1.0.0', init: async () => {}, start: async () => {} });

const newKernel = () => new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });

describe('readComposedMcpRouteOwner — is the plugin that mounts /api/v1/mcp composed (#23743)', () => {
  it('names the runtime dispatcher — the plugin that mounts the route — by its real name', () => {
    // Read off the factory, not restated: a rename of the dispatcher would
    // otherwise leave this read asking for a plugin no kernel ever holds, and
    // the `MCP:` row would vanish from every boot with nothing failing.
    expect(createDispatcherPlugin().name).toBe(MCP_ROUTE_OWNER_PLUGIN);
  });

  it('a real kernel holding the dispatcher answers true', async () => {
    const kernel = newKernel();
    await kernel.use(createDispatcherPlugin());
    expect(readComposedMcpRouteOwner(kernel)).toBe(true);
  });

  it('a real kernel holding a transport-only composition answers false', async () => {
    // The card's shape: a config-mounted transport and no dispatcher. The
    // stand-in carries the Hono plugin's name; the read must not mistake "a
    // server is composed" for "the MCP route is mounted".
    const kernel = newKernel();
    await kernel.use(bare('com.objectstack.server.hono'));
    await kernel.use(bare('com.objectstack.rest.api'));
    expect(readComposedMcpRouteOwner(kernel)).toBe(false);
  });

  it('asks for exactly the dispatcher\'s name', () => {
    const asked: string[] = [];
    readComposedMcpRouteOwner({ hasPlugin: (name) => { asked.push(name); return false; } });
    expect(asked).toEqual([MCP_ROUTE_OWNER_PLUGIN]);
  });

  it('a kernel that cannot answer is "not composed" — never a URL printed on a guess', () => {
    expect(readComposedMcpRouteOwner(undefined)).toBe(false);
    expect(readComposedMcpRouteOwner({})).toBe(false);
    expect(readComposedMcpRouteOwner({ hasPlugin: () => { throw new Error('boom'); } })).toBe(false);
    // A truthy non-boolean is not a yes.
    expect(readComposedMcpRouteOwner({ hasPlugin: () => 'yes' as unknown as boolean })).toBe(false);
  });
});

describe('the wiring inside `run()` — one predicate for every announcement channel (#23743)', () => {
  it('drives the bound-port publication only when an HTTP server is composed, and prints the banner alone otherwise', () => {
    expect(
      SERVE,
      'the IPC message and the state file are no longer gated on the composed transport — a boot '
        + 'with none announces the requested port again',
    ).toMatch(
      /if \(httpServer === 'composed'\) \{\s*publishBoundPort\(boundPort, runtimeBoundPortChannels\(printBanner\), boundProtocol\);\s*\} else \{\s*printBanner\(\);\s*\}/,
    );
  });

  it('the gate reads the SAME composition the banner\'s address rows read, resolved once', () => {
    expect(SERVE).toContain('const httpServer = resolveHttpServerComposition(kernel, flags.server);');
    expect(SERVE.match(/const httpServer =/g) ?? [], 'a second read can disagree with the first').toHaveLength(1);
    expect(SERVE, 'the banner no longer reads that composition').toMatch(/\n\s*httpServer,\n/);
  });

  it('the banner\'s MCP: row needs the switch AND the route\'s owner AND a composed transport', () => {
    expect(SERVE).toContain("const mcpRouteMounted = httpServer === 'composed' && readComposedMcpRouteOwner(kernel);");
    expect(SERVE, 'the MCP: row is gated on the switch alone again').toContain(
      'mcpEnabled: isMcpServerEnabled() && mcpRouteMounted,',
    );
    expect(SERVE).not.toContain('mcpEnabled: isMcpServerEnabled(),');
  });

  it('the settle latch is still released after the gated publication, on both arms', () => {
    // `objectstack:seed-settled` is still sent on a boot with no transport —
    // it is then the only message — so the release must not move inside the
    // `composed` arm.
    const gate = SERVE.indexOf("if (httpServer === 'composed') {");
    const release = SERVE.indexOf('seedSettlement.release();');
    expect(gate).toBeGreaterThan(-1);
    expect(release, 'the settle latch is released before the publication').toBeGreaterThan(gate);
    const between = SERVE.slice(gate, release);
    expect(between.match(/\}/g)?.length ?? 0, 'the release moved inside one arm of the gate').toBeGreaterThanOrEqual(2);
    expect(SERVE.match(/seedSettlement\.release\(\);/g) ?? []).toHaveLength(1);
  });

  it('ANTI-VACUITY: the scan reads code, and a comment is invisible to it', () => {
    expect(SERVE.length).toBe(SERVE_RAW.length);
    const proseOnly = 'payload stays the one shape every reader already parses';
    expect(SERVE_RAW, 'the control sentence was reworded — pick another').toContain(proseOnly);
    expect(SERVE).not.toContain(proseOnly);
    expect(SERVE).toContain('export function readComposedMcpRouteOwner(');
  });
});
