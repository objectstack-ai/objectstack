/**
 * Tests for useActionEngine hook
 */

import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { ActionLocationSchema } from '@objectstack/spec/ui';
import type { ActionDef } from '@object-ui/core';
import { useActionEngine } from '../useActionEngine';

describe('useActionEngine', () => {
  // Annotated rather than inferred: without it every `useActionEngine({ actions:
  // sampleActions })` below re-reported the same widening as a call-site error
  // once this package started type-checking its tests (objectui#4040), and the
  // one entry that is deliberately off-spec could not be told apart from an
  // accident.
  const sampleActions: ActionDef[] = [
    {
      name: 'mark_complete',
      type: 'script',
      target: 'true',
      locations: ['list_toolbar', 'record_header'],
      // @ts-expect-error `bulkEnabled` is a retired key on `ActionDef`, kept
      // here as the only input that can prove `getBulkActions()` does not
      // harvest it (see the inverse test below). The directive is
      // self-invalidating: un-retiring the key makes it unused, i.e. TS2578.
      bulkEnabled: true,
    },
    {
      name: 'delete_record',
      type: 'api',
      endpoint: '/api/delete',
      locations: ['record_more'],
    },
    {
      name: 'view_details',
      type: 'url',
      target: '/details',
      locations: ['list_item'],
    },
    {
      // Deliberately STALE, in the same posture as the `bulkEnabled` and
      // `shortcut` keys this fixture also keeps: `global_nav` was retired from
      // the spec's `ACTION_LOCATIONS` in @objectstack/spec 17.0.0-rc.6
      // (objectstack#6888), so metadata like this can no longer be authored.
      // Kept rather than deleted because the coverage that matters now is the
      // INVERSE — see 'does not offer an action declaring the retired
      // global_nav location' below. Deleting the entry would delete the only
      // input that can prove the retired location leaks nowhere.
      name: 'global_search',
      type: 'script',
      target: 'true',
      // @ts-expect-error `global_nav` is no longer an `ActionLocation` — that
      // rejection IS the premise of the inverse test below, so the directive
      // pins it: were the location ever re-admitted to the spec, this line
      // would stop erroring and TS2578 would report the now-unused directive.
      locations: ['global_nav'],
      // @ts-expect-error `shortcut` is retired on `ActionDef` too, and for the
      // same reason as `bulkEnabled` above: the inverse test needs metadata
      // that still declares one.
      shortcut: 'ctrl+k',
    },
  ];

  /** The six locations `ACTION_LOCATIONS` declares as of 17.0.0-rc.6. */
  const LIVE_LOCATIONS = [
    'list_toolbar',
    'list_item',
    'record_header',
    'record_more',
    'record_related',
    'record_section',
  ] as const;

  describe('getActionsForLocation', () => {
    it('returns actions for list_toolbar', () => {
      const { result } = renderHook(() =>
        useActionEngine({ actions: sampleActions }),
      );

      const actions = result.current.getActionsForLocation('list_toolbar');
      expect(actions.length).toBe(1);
      expect(actions[0].name).toBe('mark_complete');
    });

    it('returns actions for record_header', () => {
      const { result } = renderHook(() =>
        useActionEngine({ actions: sampleActions }),
      );

      const actions = result.current.getActionsForLocation('record_header');
      expect(actions.length).toBe(1);
      expect(actions[0].name).toBe('mark_complete');
    });

    it('returns actions for record_more', () => {
      const { result } = renderHook(() =>
        useActionEngine({ actions: sampleActions }),
      );

      const actions = result.current.getActionsForLocation('record_more');
      expect(actions.length).toBe(1);
      expect(actions[0].name).toBe('delete_record');
    });

    it('returns empty array for location with no actions', () => {
      const { result } = renderHook(() =>
        useActionEngine({ actions: sampleActions }),
      );

      const actions = result.current.getActionsForLocation('record_related');
      expect(actions.length).toBe(0);
    });

    // `global_nav` was retired from `ACTION_LOCATIONS` in @objectstack/spec
    // 17.0.0-rc.6 (objectstack#6888) because no running-app surface ever
    // rendered it. `sampleActions` still declares it, so this pins what a stale
    // declaration can and cannot do: it must surface at NONE of the six live
    // locations.
    it('does not offer an action declaring the retired global_nav location', () => {
      const { result } = renderHook(() =>
        useActionEngine({ actions: sampleActions }),
      );

      for (const location of LIVE_LOCATIONS) {
        const names = result.current
          .getActionsForLocation(location)
          .map((a) => a.name);
        expect(names, `global_search leaked into ${location}`).not.toContain(
          'global_search',
        );
      }
    });

    // The OTHER half, and it is deliberately NOT the symmetric one. Asking the
    // engine for `'global_nav'` still returns the stale action, and that is
    // correct: `ActionEngine.getActionsForLocation` is a literal string match
    // over whatever a host registered, not a vocabulary filter. Narrowing it to
    // the six live members would be renderer-side enforcement of a spec
    // vocabulary — precisely the tolerant/lenient consumer shape AGENTS.md #0.1
    // forbids, and it would put a SECOND rejection point beside the schema's.
    //
    // Enforcement lives in two places instead, both pinned here:
    //   1. the TYPE — `getActionsForLocation(location: ActionLocation)` is now
    //      six-membered, so no type-correct caller can spell the retired value
    //      at all (the cast below is what a stale caller would have to write);
    //   2. the SCHEMA — `ActionLocationSchema` rejects it by name at authoring
    //      and publish time, with the retirement message pointing at the fix.
    // Between them, metadata carrying `global_nav` cannot be saved, and no live
    // caller can ask for it. This test was written expecting the engine to
    // return `[]` and measured otherwise; the measurement is what it now pins.
    it('leaves the retired location to the schema, not to a runtime filter', () => {
      const { result } = renderHook(() =>
        useActionEngine({ actions: sampleActions }),
      );

      const retired = result.current.getActionsForLocation(
        'global_nav' as (typeof LIVE_LOCATIONS)[number],
      );
      expect(retired.map((a) => a.name)).toEqual(['global_search']);

      const rejected = ActionLocationSchema.safeParse('global_nav');
      expect(rejected.success).toBe(false);
      expect(rejected.error?.issues?.[0]?.message).toContain(
        'was removed from `ACTION_LOCATIONS`',
      );
      expect(ActionLocationSchema.safeParse('record_header').success).toBe(true);
    });
  });

  describe('getBulkActions', () => {
    // Deliberately INVERTED. `sampleActions` still carries the stale
    // `bulkEnabled: true` — spec 17 retired the key as a `retiredKey()`
    // tombstone, so metadata like this no longer parses at all, and harvesting
    // it here made a dead registration option look load-bearing. Same posture
    // as plugin-grid's "ignores a stale bulkEnabled flag on an object action".
    // The engine's bulk mechanics keep their coverage in ActionEngine.test.ts,
    // where a HOST passes `{ bulkEnabled: true }` to `registerAction`
    // explicitly — which is still supported.
    it('does not harvest the retired bulkEnabled key from metadata', () => {
      const { result } = renderHook(() =>
        useActionEngine({ actions: sampleActions }),
      );

      expect(result.current.getBulkActions()).toEqual([]);
    });
  });

  describe('executeAction', () => {
    it('executes a registered action by name', async () => {
      const { result } = renderHook(() =>
        useActionEngine({ actions: sampleActions }),
      );

      let actionResult: any;
      await act(async () => {
        actionResult = await result.current.executeAction('mark_complete');
      });

      expect(actionResult.success).toBe(true);
    });

    it('returns error for unregistered action', async () => {
      const { result } = renderHook(() =>
        useActionEngine({ actions: sampleActions }),
      );

      let actionResult: any;
      await act(async () => {
        actionResult = await result.current.executeAction('nonexistent');
      });

      expect(actionResult.success).toBe(false);
      expect(actionResult.error).toContain('not found');
    });
  });

  describe('handleShortcut', () => {
    // Deliberately INVERTED, for the same reason as getBulkActions above:
    // `sampleActions` still declares the stale `shortcut: 'ctrl+k'`, which
    // spec 17 retired. Its tombstone is explicit that nothing ever consumed it
    // ("no keydown listener feeds ActionEngine.getShortcuts(), and objectui's
    // keyboard stack is hand-registered and never consults action metadata"),
    // so harvesting it only kept a dead path looking alive. A host that wants
    // a shortcut still passes one to `registerAction` explicitly.
    it('does not harvest the retired shortcut key from metadata', async () => {
      const { result } = renderHook(() =>
        useActionEngine({ actions: sampleActions }),
      );

      let shortcutResult: any;
      await act(async () => {
        shortcutResult = await result.current.handleShortcut('ctrl+k');
      });

      expect(shortcutResult).toBeNull();
    });

    it('returns null for unregistered shortcut', async () => {
      const { result } = renderHook(() =>
        useActionEngine({ actions: sampleActions }),
      );

      let shortcutResult: any;
      await act(async () => {
        shortcutResult = await result.current.handleShortcut('ctrl+z');
      });

      expect(shortcutResult).toBeNull();
    });
  });

  describe('defaults', () => {
    it('works with no options', () => {
      const { result } = renderHook(() => useActionEngine());

      expect(result.current.engine).toBeDefined();
      expect(typeof result.current.getActionsForLocation).toBe('function');
      expect(typeof result.current.getBulkActions).toBe('function');
      expect(typeof result.current.executeAction).toBe('function');
      expect(typeof result.current.handleShortcut).toBe('function');
    });

    it('works with empty actions array', () => {
      const { result } = renderHook(() =>
        useActionEngine({ actions: [] }),
      );

      const actions = result.current.getActionsForLocation('list_toolbar');
      expect(actions).toEqual([]);
    });
  });
});
