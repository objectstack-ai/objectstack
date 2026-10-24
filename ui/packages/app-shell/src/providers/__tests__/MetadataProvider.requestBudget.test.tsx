/**
 * objectui#4042 — one `/meta/<type>` request per type per mount.
 *
 * The card reported that opening the console produced, in a single render
 * round, `meta/object` and `meta/view` TWICE each alongside a single
 * `meta/app`. It surfaced as pre-login 401 noise, but the doubling is not an
 * unauthenticated artefact — these tests pin BOTH directions (the 200 path and
 * the 401 path) because the wasted round trip happened just as much signed in.
 *
 * Mechanism, for whoever breaks this next: consumers read metadata during the
 * FIRST render (`useActionModal` reads `objects`, whose getter kicks
 * `ensureType('object')` and `ensureType('view')` from the render phase), which
 * is before any effect runs. MetadataProvider's preview-mode effect used to
 * clear the whole cache unconditionally on mount, throwing those two entries
 * away mid-flight; the next render found them `idle` and refetched both. The
 * effect now skips its mount run — there is nothing to drop on mount anyway.
 */

import { describe, it, expect, vi } from 'vitest';
import { useEffect } from 'react';
import { render, waitFor, act } from '@testing-library/react';
import { MetadataProvider, useMetadata } from '../MetadataProvider';

/** Records every `meta.getItems(type)` the provider issues, in order. */
function makeRecordingAdapter(calls: string[], mode: 'ok' | 'unauthorized') {
  return {
    clearCache: vi.fn(),
    // objectui#13044 — the real MetadataProvider reads an object by name through
    // the adapter's `getObjectSchema`; this double answers it from its own by-name door.
    getObjectSchema(this: { getClient(): any }, name: string) {
      return this.getClient()
        .meta.getItem('object', name)
        .then((res: any) => (res && typeof res === 'object' && 'item' in res ? res.item : res));
    },
    getClient: () => ({
      meta: {
        getItems: (type: string) => {
          calls.push(type);
          if (mode === 'unauthorized') {
            return Promise.reject(
              Object.assign(new Error('Unauthorized'), { httpStatus: 401, code: 'UNAUTHORIZED' }),
            );
          }
          return Promise.resolve({ type, items: [] });
        },
        getItem: (type: string, name: string) => {
          calls.push(`${type}/${name}`);
          return Promise.resolve({ item: null });
        },
      },
    }),
  } as unknown as Parameters<typeof MetadataProvider>[0]['adapter'];
}

/**
 * A first-render consumer that reads `objects` on EVERY render, as
 * `useActionModal` did until objectui#12811 (it now reads it only while an
 * object's form modal is open). The `objects` getter reads both the `object`
 * and the `view` type.
 */
function ObjectsConsumer() {
  const ctx = useMetadata();
  return <div data-testid="count">{ctx.objects.length}</div>;
}

async function countCalls(mode: 'ok' | 'unauthorized'): Promise<string[]> {
  const calls: string[] = [];
  render(
    <MetadataProvider adapter={makeRecordingAdapter(calls, mode)}>
      <ObjectsConsumer />
    </MetadataProvider>,
  );
  // Wait for the eager types to have been requested, then let every pending
  // microtask/timer settle so a late duplicate would still be recorded.
  await waitFor(() => expect(calls).toContain('app'));
  await new Promise((resolve) => setTimeout(resolve, 100));
  return calls;
}

describe('MetadataProvider request budget (objectui#4042)', () => {
  it('fetches each metadata type exactly once per mount on the success path', async () => {
    const calls = await countCalls('ok');

    expect(calls.filter((c) => c === 'object')).toHaveLength(1);
    expect(calls.filter((c) => c === 'view')).toHaveLength(1);
    expect(calls.filter((c) => c === 'app')).toHaveLength(1);
    // Nothing else — no stray type, no third request.
    expect([...calls].sort()).toEqual(['app', 'object', 'view']);
  });

  it('does not retry-storm when every metadata read is refused (401)', async () => {
    const calls = await countCalls('unauthorized');

    // A refused read must not become a louder read. Same budget as the success
    // path: one attempt per type, then the entry parks in `error`.
    expect([...calls].sort()).toEqual(['app', 'object', 'view']);
  });

  it('still retries a failed type immediately on an EXPLICIT refresh()', async () => {
    // The failure cooldown collapses the mount-time burst; it must not turn
    // `refresh()` — the console's recover-from-error path — into a no-op.
    const calls: string[] = [];
    // Holder + effect, not a bare outer assignment during render — the same
    // pattern the other console tests use, and what the react-compiler lint
    // rule requires.
    const captured: { current: ReturnType<typeof useMetadata> | null } = { current: null };

    function Capture() {
      const ctx = useMetadata();
      useEffect(() => {
        captured.current = ctx;
      }, [ctx]);
      return <div>{ctx.objects.length}</div>;
    }

    render(
      <MetadataProvider adapter={makeRecordingAdapter(calls, 'unauthorized')}>
        <Capture />
      </MetadataProvider>,
    );
    await waitFor(() => expect(calls).toContain('app'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    const beforeRefresh = calls.length;

    // Well inside ERROR_RETRY_COOLDOWN_MS — an explicit refresh must fetch anyway.
    await act(async () => {
      await captured.current!.refresh('object');
    });

    expect(calls.filter((c) => c === 'object')).toHaveLength(2);
    expect(calls.length).toBe(beforeRefresh + 1);
  });
});
