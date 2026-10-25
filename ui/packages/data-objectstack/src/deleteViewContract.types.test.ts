/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, vi } from 'vitest';
import type { DataSource, DeleteViewResult, ViewHomeDeleteOutcome } from '@object-ui/types';
import {
  ObjectStackAdapter,
  type DeleteViewResult as AdapterDeleteViewResult,
  type ViewHomeDeleteOutcome as AdapterViewHomeDeleteOutcome,
} from './index';

/**
 * The shared `DataSource` contract carries `deleteView`'s per-home outcomes
 * (#4564).
 *
 * #4479 / PR #4562 widened THIS adapter's `deleteView` to return
 * `DeleteViewResult { deleted, draft?, published? }`, but the shared interface
 * in `@object-ui/types` still declared the narrow `{ deleted: boolean }`. The
 * adapter's wider return is assignable to the narrower declaration, so nothing
 * failed to compile — which is exactly what made the gap invisible: a consumer
 * reaching the adapter THROUGH `DataSource` was handed a type that had already
 * thrown the per-home outcomes away. The one real call site today (app-shell's
 * `ObjectView` delete handler) reads nothing off the receipt, so the loss was
 * latent rather than broken.
 *
 * #4564's ruling moved the canonical shapes DOWN to `@object-ui/types` beside
 * the interface (the dependency runs data-objectstack -> types, so the shapes
 * could not be imported upward), widened `DataSource.deleteView?`'s declared
 * return to `DeleteViewResult`, and left this package re-exporting both names
 * so every existing importer keeps compiling.
 *
 * ## Where these pins get their colour
 *
 * Most of this file is COMPILE-time. That is not a weaker pin, it is the only
 * pin that can observe this defect: the bug was never a wrong value at runtime,
 * it was a declaration that could not describe the value. `vitest` transpiles
 * with esbuild and erases types, so the runtime case below passed just as
 * happily against the narrow declaration — its `receipt.draft` read was a
 * `tsc` error and a green test at the same time. The colour therefore comes
 * from `pnpm --filter @object-ui/data-objectstack type-check`, and this
 * package's `tsconfig.json` includes its whole `src/**` (tests included), so
 * these assertions are checked there and by CI's Type Check job with no
 * separate `tsconfig.typetests.json` — the same property `queryDataset.test.ts`
 * and `spec-symbol-batch6.test.ts` document and rely on.
 *
 * ## The discrimination control
 *
 * `NarrowLegacyResult` below is `deleteView`'s declared return BEFORE #4564,
 * kept as a live control rather than described in prose. Every "the contract
 * carries the per-home outcomes" assertion is paired with the control failing
 * to carry them. Undo the move and the paired assertions go red together,
 * which is what stops this file from degrading into a restatement of whatever
 * the interface happens to say.
 */

const VIEW = 'account.my_pipeline';

/** Framework receipt: a draft row existed and was discarded. */
const DRAFT_DISCARDED = {
  success: true,
  reset: true,
  seq: 41,
  message: `Draft discarded — view/${VIEW}. [seq=41]`,
};

/** Framework receipt: no published row. A 200 carrying `reset:false`, not a 404. */
const NO_PUBLISHED = {
  success: true,
  reset: false,
  message: `No view '${VIEW}' found — nothing to delete.`,
};

/**
 * The smallest adapter that can answer both view-delete addresses.
 *
 * Deliberately NOT a second copy of `deleteView.homes.test.ts`'s harness: that
 * file owns the behaviour (15 pins over both homes, the ordering, the failure
 * paths) and stays untouched. This one exists only to drive one call through a
 * `DataSource`-typed handle, so the per-home read below is served by the shared
 * declaration and by nothing else.
 */
function makeAdapter(): ObjectStackAdapter {
  const baseUrl = 'http://test.local';
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/meta/view/') && (init?.method ?? 'GET') === 'DELETE') {
      return json(url.includes('state=draft') ? DRAFT_DISCARDED : NO_PUBLISHED);
    }
    return json({ success: true, data: { capabilities: {}, routes: {} } });
  });

  const adapter = new ObjectStackAdapter({ baseUrl, fetch: fetchImpl });
  const poke = adapter as any;
  poke.connected = true;
  poke.connectionState = 'connected';
  poke.metadataCache = {
    get: async (_key: string, loader: () => Promise<any>) => loader(),
    invalidate: () => undefined,
    getCachedSync: () => undefined,
    getStats: () => ({}),
  };
  return adapter;
}

/* -------------------------------------------------------------------------- */
/* Compile-time vocabulary — the repo's idiom (queryDataset.test.ts).          */
/* -------------------------------------------------------------------------- */

type Assert<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? true
  : false;
type HasKey<T, K extends PropertyKey> = K extends keyof T ? true : false;

/** The shared contract's declared return, read off the interface itself. */
type ContractDeleteView = NonNullable<DataSource['deleteView']>;
type ContractReturn = Awaited<ReturnType<ContractDeleteView>>;

/**
 * `DataSource.deleteView`'s declared return BEFORE #4564 — the control.
 * Kept as a type, not a comment, so "the contract used to lose the per-home
 * outcomes" is an assertion the compiler re-checks on every run.
 */
interface NarrowLegacyResult {
  deleted: boolean;
}

describe('DataSource.deleteView declares the per-home outcomes (#4564)', () => {
  it('the shared contract returns the canonical DeleteViewResult, not a restatement', () => {
    // `Equal` rather than a two-way `extends`: a structurally overlapping
    // re-declaration in `types` would satisfy mutual assignability while
    // drifting, and a hand copy is precisely what the one-resolver rule and
    // this card's ruling rejected in favour of moving the declaration.
    type _IsTheCanonicalShape = Assert<Equal<ContractReturn, DeleteViewResult>>;

    expect(true).toBe(true);
  });

  it('carries `draft` and `published`, where the pre-#4564 declaration carried neither', () => {
    type _CarriesDraft = Assert<Equal<HasKey<ContractReturn, 'draft'>, true>>;
    type _CarriesPublished = Assert<Equal<HasKey<ContractReturn, 'published'>, true>>;

    // The control, and the whole reason this file is a pin rather than an echo:
    // the shape the interface used to declare cannot answer either read. If the
    // move is reverted, the two assertions above go red and these two stay
    // green — the difference between them IS #4564's delta.
    type _ControlHasNoDraft = Assert<Equal<HasKey<NarrowLegacyResult, 'draft'>, false>>;
    type _ControlHasNoPublished = Assert<Equal<HasKey<NarrowLegacyResult, 'published'>, false>>;
    type _ContractIsNotTheNarrowShape = Assert<
      Equal<Equal<ContractReturn, NarrowLegacyResult>, false>
    >;

    expect(true).toBe(true);
  });

  it('types the per-home outcomes as ViewHomeDeleteOutcome, optional on both homes', () => {
    type _DraftIsTheOutcome = Assert<Equal<ContractReturn['draft'], ViewHomeDeleteOutcome | undefined>>;
    type _PublishedIsTheOutcome = Assert<
      Equal<ContractReturn['published'], ViewHomeDeleteOutcome | undefined>
    >;
    // `deleted` is unchanged — the growth is additive, so a consumer reading
    // only `deleted` is untouched by the widening.
    type _DeletedUnchanged = Assert<Equal<ContractReturn['deleted'], boolean>>;

    expect(true).toBe(true);
  });

  it('MUST NOT CHANGE: deleteView stays OPTIONAL, with the same two parameters', () => {
    // The widening is to the RETURN only. An adapter that never implemented
    // `deleteView` must stay a legal `DataSource`.
    type _StillOptional = Assert<undefined extends DataSource['deleteView'] ? true : false>;
    type _SameParameters = Assert<Equal<Parameters<ContractDeleteView>, [string, string]>>;

    expect(true).toBe(true);
  });
});

describe('the data-objectstack spellings survive the move (#4564)', () => {
  it('re-exports both names as the SAME declaration, not a structural twin', () => {
    // The re-export contract: every importer that PR #4562 left pointing at
    // `@object-ui/data-objectstack` keeps compiling, and keeps getting the type
    // the shared interface now speaks. `Equal` is the assertion that matters —
    // two identical-looking declarations are mutually assignable, so only
    // identity can tell a re-export from a copy that will drift.
    type _ResultIsTheTypesSpelling = Assert<Equal<AdapterDeleteViewResult, DeleteViewResult>>;
    type _OutcomeIsTheTypesSpelling = Assert<
      Equal<AdapterViewHomeDeleteOutcome, ViewHomeDeleteOutcome>
    >;

    expect(true).toBe(true);
  });

  it('the adapter method still satisfies the widened contract', () => {
    const adapter = makeAdapter();

    // Explicit, because `class ObjectStackAdapter implements DataSource` would
    // have gone on compiling with the NARROW declaration too — a wider return
    // is assignable to a narrower one, which is how the gap survived #4562's
    // review in the first place. This states the direction the card cares
    // about instead of inheriting it from the class heritage clause.
    const deleteView = adapter.deleteView.bind(adapter) satisfies ContractDeleteView;
    expect(typeof deleteView).toBe('function');

    type _AdapterAssignableToContract = Assert<
      ObjectStackAdapter['deleteView'] extends ContractDeleteView ? true : false
    >;
    // ...and no longer merely assignable: the two returns are now one type, so
    // the adapter cannot widen further without the contract following it.
    type _ReturnsAreOneType = Assert<
      Equal<Awaited<ReturnType<ObjectStackAdapter['deleteView']>>, ContractReturn>
    >;

    expect(true).toBe(true);
  });
});

describe('a consumer holding only the shared DataSource (#4564)', () => {
  it('reads the per-home outcomes the adapter actually returns', async () => {
    const adapter = makeAdapter();

    // The narrowing that makes this a #4564 pin rather than a duplicate of
    // `deleteView.homes.test.ts`: the receipt below is typed by `DataSource`,
    // not by `ObjectStackAdapter`. Before the move this assignment compiled
    // just as well and threw the per-home outcomes away on the way through.
    const ds: DataSource = adapter;

    const receipt = await ds.deleteView!('account', VIEW);

    // Draft-only view: the draft home held the row, the published one did not.
    expect(receipt.deleted).toBe(true);
    expect(receipt.draft?.removed).toBe(true);
    expect(receipt.published?.removed).toBe(false);
    expect(receipt.draft?.message).toContain('Draft discarded');
  });
});
