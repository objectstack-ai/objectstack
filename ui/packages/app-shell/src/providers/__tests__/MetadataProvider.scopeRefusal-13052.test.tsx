// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#13052 — the by-name object scope read, driven through a REAL
 * `ObjectStackAdapter` (its error-envelope reader included) by a fake `fetch`.
 *
 *   (a) `404 OBJECT_PACKAGE_DISABLED`, in the flat and in the wrapped
 *       envelope, is an ANSWER: the name is missing, the scope settles, and the
 *       scope names the refusal;
 *   (b) CONTROL: `404 RESOURCE_NOT_FOUND` is the plain absence it was, with no
 *       refusal named;
 *   (c) a 5xx, a network drop, and a 404 carrying a code this build does not
 *       know are failed reads: the scope stays unsettled (`useObjectPresence`
 *       keeps reading `unknown`, objectui#13009) and names the failure once
 *       nothing else is in flight. A re-render asks nothing more; an
 *       `invalidate` of the name asks it exactly once more;
 *   (d) CONTROL: a served object is present, nothing failed, nothing refused,
 *       one request.
 */

import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ObjectStackAdapter } from '@object-ui/data-objectstack';
import { useMetadata } from '@object-ui/react';
import { MetadataProvider } from '../MetadataProvider';

type Ctx = ReturnType<typeof useMetadata>;
type Answer =
  | 'served'
  | 'disabled-flat'
  | 'disabled-wrapped'
  | 'absent'
  | 'server-error'
  | 'network'
  | 'unknown-code';

const NAME = 'qaprobe_widget';
const BY_NAME = `/api/v1/meta/object/${NAME}`;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function respond(answer: Answer): Response {
  switch (answer) {
    case 'served':
      return json(200, { success: true, data: { type: 'object', name: NAME, item: { name: NAME, fields: {} } } });
    case 'disabled-flat':
      // The body the server answers today (the card's reproduction).
      return json(404, {
        error: `Object '${NAME}' belongs to a disabled package and is not being served.`,
        code: 'OBJECT_PACKAGE_DISABLED',
      });
    case 'disabled-wrapped':
      return json(404, { success: false, error: { code: 'OBJECT_PACKAGE_DISABLED', message: 'disabled package' } });
    case 'absent':
      return json(404, { success: false, error: { code: 'RESOURCE_NOT_FOUND', message: 'not found' } });
    case 'server-error':
      return json(503, { success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'unavailable' } });
    case 'unknown-code':
      return json(404, { success: false, error: { code: 'SOME_FUTURE_REFUSAL', message: 'refused' } });
    case 'network':
      throw new TypeError('Failed to fetch');
  }
}

let seq = 0;

function mount(first: Answer) {
  const server = { calls: [] as string[], next: first };
  const adapter = new ObjectStackAdapter({
    baseUrl: `http://refusal-13052-${(seq += 1)}.test`,
    autoReconnect: false,
    fetch: (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/discovery')) return json(200, { success: true, data: {} });
      server.calls.push(url.pathname);
      if (url.pathname === BY_NAME) return respond(server.next);
      const list = /^\/api\/v1\/meta\/([a-z_]+)$/.exec(url.pathname);
      if (list) return json(200, { success: true, data: { type: list[1], items: [] } });
      return json(404, { success: false, error: { message: `no route ${url.pathname}` } });
    }) as typeof fetch,
  });
  let latest: Ctx | null = null;
  function Probe() {
    latest = useMetadata();
    // The route's read, made on every render as `AppContent` makes it.
    latest.readObjectScope!({ names: [NAME] });
    return null;
  }
  const tree = (
    <MetadataProvider adapter={adapter}>
      <Probe />
    </MetadataProvider>
  );
  const view = render(tree);
  return {
    server,
    ctx: () => latest as unknown as Ctx,
    rerender: () => view.rerender(tree),
  };
}

/** The scope read with this package's hand-off fields (see `appObjectScope.ts`). */
const scopeOf = (ctx: Ctx) =>
  ctx.readObjectScope!({ names: [NAME] }) as ReturnType<NonNullable<Ctx['readObjectScope']>> & {
    failed?: readonly string[];
    refused?: Readonly<Record<string, string>>;
  };
const byName = (calls: string[]) => calls.filter((c) => c === BY_NAME).length;
const settle = (ms = 40) =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });

afterEach(() => cleanup());

describe('a definite refusal is an answer; a failed read settles once (objectui#13052)', () => {
  for (const envelope of ['disabled-flat', 'disabled-wrapped'] as const) {
    it(`(a) 404 OBJECT_PACKAGE_DISABLED (${envelope}) settles the scope and names the refusal`, async () => {
      const m = mount(envelope);
      await waitFor(() => expect(scopeOf(m.ctx()).settled).toBe(true));
      const scope = scopeOf(m.ctx());
      expect(scope.missing).toEqual([NAME]);
      expect(scope.refused).toEqual({ [NAME]: 'OBJECT_PACKAGE_DISABLED' });
      expect(scope.failed).toEqual([]);
      await settle();
      expect(byName(m.server.calls)).toBe(1);
    });
  }

  it('(b) CONTROL: 404 RESOURCE_NOT_FOUND is the plain absence, no refusal named', async () => {
    const m = mount('absent');
    await waitFor(() => expect(scopeOf(m.ctx()).settled).toBe(true));
    const scope = scopeOf(m.ctx());
    expect(scope.missing).toEqual([NAME]);
    expect(scope.refused).toEqual({});
    expect(scope.failed).toEqual([]);
  });

  for (const failure of ['server-error', 'network', 'unknown-code'] as const) {
    it(`(c) a ${failure} read stays unsettled and is named failed, asked once`, async () => {
      const m = mount(failure);
      await waitFor(() => expect(scopeOf(m.ctx()).failed).toEqual([NAME]));
      const scope = scopeOf(m.ctx());
      expect(scope.settled).toBe(false);
      expect(scope.missing).toEqual([]);
      expect(scope.refused).toEqual({});
      // No loop: the failure's own re-render, and later ones, ask nothing.
      await settle(150);
      m.rerender();
      await settle();
      expect(byName(m.server.calls)).toBe(1);
    });
  }

  it('(c) invalidating a failed name asks it exactly once more, and an answer settles it', async () => {
    const m = mount('server-error');
    await waitFor(() => expect(scopeOf(m.ctx()).failed).toEqual([NAME]));
    expect(byName(m.server.calls)).toBe(1);

    m.server.next = 'served';
    act(() => m.ctx().invalidate('object', NAME));
    await waitFor(() => expect(scopeOf(m.ctx()).settled).toBe(true));
    await settle();
    expect(byName(m.server.calls)).toBe(2);
    const scope = scopeOf(m.ctx());
    expect(scope.failed).toEqual([]);
    expect(scope.objects.map((o: any) => o.name)).toEqual([NAME]);
  });

  it('(d) CONTROL: a served object is present, nothing failed or refused, one request', async () => {
    const m = mount('served');
    await waitFor(() => expect(scopeOf(m.ctx()).settled).toBe(true));
    const scope = scopeOf(m.ctx());
    expect(scope.objects.map((o: any) => o.name)).toEqual([NAME]);
    expect(scope.missing).toEqual([]);
    expect(scope.failed).toEqual([]);
    expect(scope.refused).toEqual({});
    await settle();
    expect(byName(m.server.calls)).toBe(1);
  });
});
