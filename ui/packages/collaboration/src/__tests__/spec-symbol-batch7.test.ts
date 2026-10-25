/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `@object-ui/collaboration` ↔ `@objectstack/spec` symbol-collision guard
 * (objectui#3161, objectstack#4115 ledger batch 7).
 *
 * `RealtimeConfig` → `RealtimeSubscriptionConfig`. Batch 6's first method rule
 * — read the collision per SYMBOL, never per cluster — applies here in its
 * "looks like a dialect, is actually a different concept" direction, the same
 * verdict `SecurityPolicy` got: the spec's `RealtimeConfig` is the app's
 * realtime DECLARATION (`enabled`, one `transport`, a list of `subscriptions`
 * naming record events), and this is one browser socket's dial settings. The
 * `Extract<…> = never` pin below is what makes "they share nothing" a checked
 * fact rather than a claim in a comment — and it is also the tripwire: if the
 * spec grows a `url` or a `channel` at top level, the two concepts have started
 * to converge and this symbol needs re-triage.
 */

import { describe, it, expect } from 'vitest';
import { RealtimeConfigSchema } from '@objectstack/spec/api';
import type { RealtimeConfig as SpecRealtimeConfig } from '@objectstack/spec/api';

import type { RealtimeSubscriptionConfig } from '../useRealtimeSubscription';

type Assert<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Extends<A, B> = [A] extends [B] ? true : false;
type IsAny<T> = 0 extends 1 & T ? true : false;
type HasKey<T, K extends string> = K extends keyof T ? true : false;

/**
 * Every key of the local config, exhaustively — `Record<keyof …, true>` makes
 * tsc reject both a missing key and an invented one, so this list cannot drift
 * out of step with the interface the way a hand-written array would.
 */
const LOCAL_KEYS: Record<keyof RealtimeSubscriptionConfig, true> = {
  url: true,
  channel: true,
  autoReconnect: true,
  reconnectInterval: true,
  maxReconnectAttempts: true,
  authToken: true,
};

const specDeclaredKeys = Object.keys(
  (RealtimeConfigSchema as unknown as { shape?: Record<string, unknown> }).shape ?? {},
);

describe('the two configs describe different things', () => {
  it('reads the spec schema shape (the probe itself is not vacuous)', () => {
    expect(specDeclaredKeys.length).toBeGreaterThan(0);
  });

  it('shares not one declared key with the spec declaration', () => {
    // Read off the spec's own schema rather than restated here — the disjoint
    // key sets ARE the argument for the rename, so they have to be measured.
    for (const key of Object.keys(LOCAL_KEYS)) {
      expect(
        specDeclaredKeys,
        `the spec's RealtimeConfig now declares '${key}' too — the two concepts are converging, ` +
          `re-triage this symbol instead of leaving the rename standing on a stale reason`,
      ).not.toContain(key);
    }
  });
});

describe('RealtimeSubscriptionConfig is not a dialect of the spec RealtimeConfig', () => {
  it('is pinned at compile time', () => {
    // Load-bearing import: if the spec retires `RealtimeConfig`, this file
    // stops compiling and the local name is free to come back.
    type _SpecIsReal = Assert<Equal<IsAny<SpecRealtimeConfig>, false>>;

    // NOTE — why the key comparison above is a runtime one. The spec declares
    // `RealtimeConfigSchema` as a PASSTHROUGH object (`z.core.$loose`), so the
    // inferred type carries an index signature: `keyof SpecRealtimeConfig`
    // includes `string`, every `K extends keyof Spec` probe answers `true`, and
    // `Extract<keyof Local, keyof Spec>` collapses to all of `keyof Local`.
    // That is the objectstack#4075 mechanism on the SPEC's side — the same
    // reason `ObjectFieldLike` (plugin-detail, this batch) could not be derived
    // either. Deriving from a bag is not deriving.
    type _SpecIsALooseBag = Assert<Extends<string, keyof SpecRealtimeConfig>>;

    // What survives that: assignability, which still honours the REQUIRED keys.
    type _NotAssignableEitherWay = Assert<Equal<Extends<RealtimeSubscriptionConfig, SpecRealtimeConfig>, false>>;
    type _NorTheOtherWay = Assert<Equal<Extends<SpecRealtimeConfig, RealtimeSubscriptionConfig>, false>>;

    // And what the local one models, so the reason survives with the pin.
    type _LocalDialsASocket = Assert<HasKey<RealtimeSubscriptionConfig, 'reconnectInterval'>>;

    expect(true).toBe(true);
  });
});
