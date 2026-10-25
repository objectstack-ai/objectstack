// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Type-level pin for objectui#11583's contract review (record `5977112283`,
 * item ①.1): `ViewConfigPanelProps.onSave` admits every host the `void`-typed
 * prop admitted.
 *
 * ## What the defect was
 *
 * `ViewConfigPanel` is exported from the package entry. objectui#11583 made
 * the panel wait for `onSave`'s outcome and widened the prop's return type
 * from `void` to `void | Promise<boolean>`. TypeScript ignores a function's
 * return type only when the target's return type is exactly `void`; against
 * the union it checks it, and refused (TS2322) hosts the published prop had
 * admitted: an `async` host that returns nothing, a host resolving to a
 * record, a sync host returning a value. Every in-repo host returns a boolean,
 * so the package's own type-check stayed green; the review's out-of-repo probe
 * found it. Remedy (a), the seat's call (`5977119047`): the prop returns
 * `unknown`, and the runtime keeps reading one signal,
 * `(await onSave?.(flat)) !== false`.
 *
 * ## Why the instrument is `tsc`
 *
 * The assignments below are checked by `packages/app-shell/tsconfig.test.json`,
 * which compiles every `src/**\/*.test.ts` in the package and is chained off
 * the package's `type-check` script (CI's `Type Check`). With the prop typed
 * back to `void | Promise<boolean>`, the three host rows each fail with TS2322
 * and the return-type equation fails too. The runtime half (what the panel
 * does with each outcome) is pinned in `ViewConfigPanel.saveOutcome-11583.test.tsx`.
 *
 * `ReportConfigPanelProps.onSave` is unpublished, and is aligned to the same
 * shape in the same stroke, so it is held to the same rows.
 */

import { describe, it, expect } from 'vitest';
import type { ViewConfigPanelProps } from './ViewConfigPanel';
import type { ReportConfigPanelProps } from './ReportConfigPanel';

type Assert<T extends true> = T;
type IsAny<T> = 0 extends 1 & T ? true : false;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

type ViewOnSave = NonNullable<ViewConfigPanelProps['onSave']>;
type ReportOnSave = ReportConfigPanelProps['onSave'];

// Guard against the probe lying: were the prop `any`, every row below would
// pass for the wrong reason.
type _ViewOnSaveNotAny = Assert<Equal<IsAny<ViewOnSave>, false>>;
type _ReportOnSaveNotAny = Assert<Equal<IsAny<ReportOnSave>, false>>;
/** The ruled shape: the return is `unknown`, so no host's return is checked. */
type _ViewOnSaveReturnsUnknown = Assert<Equal<ReturnType<ViewOnSave>, unknown>>;
type _ReportOnSaveReturnsUnknown = Assert<Equal<ReturnType<ReportOnSave>, unknown>>;

/** A host's own persistence call; never reaches a network. */
const persist = async (_draft: Record<string, unknown>): Promise<void> => {};

// The hosts the `void` prop admitted. Each row is a TS2322 under a union return.
const asyncVoidHost: ViewConfigPanelProps['onSave'] = async (draft) => {
  await persist(draft);
};
const recordHost: ViewConfigPanelProps['onSave'] = async (draft) => ({ ...draft, savedAt: 'now' });
const syncValueHost: ViewConfigPanelProps['onSave'] = (draft) => Object.keys(draft).length;
// And the two the union admitted, which `unknown` keeps.
const voidHost: ViewConfigPanelProps['onSave'] = () => {};
const signalHost: ViewConfigPanelProps['onSave'] = async () => false;

const reportHosts: ReportOnSave[] = [
  async (config) => {
    await persist(config);
  },
  async (config) => ({ ...config, savedAt: 'now' }),
  (config) => Object.keys(config).length,
  () => {},
  async () => false,
];

describe('ViewConfigPanelProps.onSave admits every host the void prop admitted (objectui#11583, contract review ①.1)', () => {
  it('each host is a callable the panel can await', async () => {
    const hosts = [asyncVoidHost, recordHost, syncValueHost, voidHost, signalHost, ...reportHosts];
    for (const host of hosts) {
      expect(typeof host).toBe('function');
      await expect(Promise.resolve(host!({ label: 'x' }))).resolves.not.toBeInstanceOf(Error);
    }
  });
});
