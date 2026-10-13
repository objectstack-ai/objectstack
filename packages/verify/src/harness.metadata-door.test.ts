// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #23088: `bootStack` fills its `metadata` slot the way `objectstack serve`
 * fills it for a host configuration (#22989): `@objectstack/metadata`'s
 * `MetadataPlugin` with no artifact. Before, the slot was the kernel's
 * in-memory fallback, which has no `matchEndpoint`, so every `apis` endpoint a
 * stack declared answered `404 ENDPOINT_NOT_FOUND` under the harness while
 * `serve` served it, and the boot logged `AppPlugin`'s no-matcher warning.
 *
 * Two boots:
 *
 *  - the harness's own composition (nothing in `extraPlugins`): the declared
 *    path answers 401 without a session and 200 with one, an undeclared path
 *    under the same mount keeps the bare 404, and the no-matcher warning is
 *    not logged;
 *  - a caller's own `MetadataPlugin` in `extraPlugins`: that instance holds
 *    the slot, and the composed one is never registered (no supersede).
 *
 * Warnings are identified by their named subjects and structured fields (the
 * app id, the remedy plugin, the superseded plugin's name), never by prose.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { MetadataPlugin } from '@objectstack/metadata';
import { defineStack } from '@objectstack/spec';
import { bootStack, type VerifyStack } from './harness.js';

const BOOT_TIMEOUT = 120_000;
const APP_ID = 'com.example.mdoor';
const FEED = '/apps/mdoor/notes';

/** A fresh configuration per boot: the instance rule keys on identity. */
const stackWithApi = () =>
  defineStack({
    manifest: { id: APP_ID, name: 'Metadata Door', version: '1.0.0', type: 'app', namespace: 'mdoor' },
    objects: [
      {
        name: 'mdoor_note',
        label: 'Note',
        pluralLabel: 'Notes',
        sharingModel: 'public_read_write',
        fields: { title: { name: 'title', type: 'text', label: 'Title' } },
      },
    ],
    apis: [
      {
        name: 'mdoor_note_feed',
        path: `/api/v1${FEED}`,
        method: 'GET',
        summary: 'Note feed',
        type: 'object_operation',
        objectParams: { object: 'mdoor_note', operation: 'find' },
        authRequired: true,
      },
    ],
  } as never) as unknown as Record<string, unknown>;

/** Every structured kernel-log line the boot wrote to stdout, ANSI stripped. */
async function bootCapturing(config: unknown, extraPlugins?: unknown[]): Promise<{ stack: VerifyStack; lines: string[] }> {
  const lines: string[] = [];
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown) => {
    lines.push(...String(chunk).replace(/\u001b\[[0-9;]*m/g, '').split('\n'));
    return true;
  }) as never);
  try {
    const stack = await bootStack(config, extraPlugins ? { extraPlugins } : {});
    return { stack, lines };
  } finally {
    spy.mockRestore();
  }
}

/** The structured fields a kernel `WARN` line carries, or undefined for any other line. */
function warnFields(line: string): Record<string, unknown> | undefined {
  if (!/ WARN /.test(line)) return undefined;
  const at = line.indexOf(' {');
  if (at < 0) return undefined;
  try {
    return JSON.parse(line.slice(at + 1)) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

let stack: VerifyStack | undefined;
afterEach(async () => {
  await stack?.stop();
  stack = undefined;
});

describe('#23088 bootStack serves a declared endpoint, as objectstack serve does', () => {
  it('composes a matcher, so the declared path is gated and served, and no matcher warning is logged', async () => {
    const booted = await bootCapturing(stackWithApi());
    stack = booted.stack;
    const token = await stack.signIn();

    const answer = async (res: Response) => ({
      status: res.status,
      code: ((await res.json()) as { error?: { code?: string } }).error?.code,
    });
    const observed = {
      // The slot carries the endpoint matcher.
      matcher: typeof stack.kernel.getService<{ matchEndpoint?: unknown }>('metadata').matchEndpoint,
      anonymous: await answer(await stack.api(FEED, { method: 'GET' })),
      signedIn: (await stack.apiAs(token, 'GET', FEED)).status,
      // CONTROL: an undeclared path under the same mount keeps the bare 404.
      undeclared: await answer(await stack.apiAs(token, 'GET', '/apps/mdoor/no-such-endpoint')),
      matcherWarnings: booted.lines.filter((line) => {
        const fields = warnFields(line);
        return fields?.appId === APP_ID && line.includes('MetadataPlugin');
      }),
    };
    // One composite, so a failure shows every observation at once.
    expect(observed).toEqual({
      matcher: 'function',
      anonymous: { status: 401, code: 'UNAUTHENTICATED' },
      signedIn: 200,
      undeclared: { status: 404, code: 'ENDPOINT_NOT_FOUND' },
      matcherWarnings: [],
    });
  }, BOOT_TIMEOUT);

  it("a caller's own MetadataPlugin in extraPlugins holds the slot, and the composed one is never registered", async () => {
    const own = new MetadataPlugin({ watch: false, config: { bootstrap: 'lazy' } });
    const booted = await bootCapturing(stackWithApi(), [own]);
    stack = booted.stack;

    // The slot is the caller's instance's manager — by identity.
    const ownManager = (own as unknown as { manager: unknown }).manager;
    expect(stack.kernel.getService('metadata')).toBe(ownManager);

    // Composed and then superseded would log the kernel's supersede warning
    // for this name; not composed logs none.
    const superseded = booted.lines.filter((line) => warnFields(line)?.plugin === own.name);
    expect(superseded).toEqual([]);

    // And the caller's instance serves the declared path.
    const anonymous = await stack.api(FEED, { method: 'GET' });
    expect(anonymous.status).toBe(401);
  }, BOOT_TIMEOUT);
});
