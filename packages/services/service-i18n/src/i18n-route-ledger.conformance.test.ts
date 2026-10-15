// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * i18n route-ledger hygiene (#3636) — the rows `@objectstack/client`'s guards
 * and the dogfood live-mount parity gate read as relative source.
 *
 * [#23347] This file used to enumerate the routes `I18nServicePlugin` mounted
 * and hold the ledger equal to that set in both directions. The plugin mounts
 * none now — the dispatcher bridge is the one owner of `/api/v1/i18n/*` — so
 * the enumeration would hold the ledger equal to the EMPTY set, and the rows
 * would have to go with readers outside this package (see the ledger's
 * header). What stays here is what does not depend on a mount: the rows are
 * well-formed. The negative pin — the plugin mounts nothing on the HTTP
 * server it is given — lives in `i18n-service-plugin.test.ts`, next to the
 * plugin's other lifecycle facts.
 *
 * The client half — every `sdk` row resolving to a real method — lives in
 * `packages/client/src/service-route-ledger-coverage.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { I18N_ROUTE_LEDGER } from './i18n-route-ledger.js';

describe('i18n route ledger hygiene', () => {
  it('no route is ledgered twice', () => {
    const seen = new Set<string>();
    const dupes = I18N_ROUTE_LEDGER.map((e) => e.route).filter((r) => !seen.add(r));
    expect(dupes, `duplicate i18n-route-ledger rows: ${dupes.join(', ')}`).toEqual([]);
  });

  it('every `sdk` entry names its client method; every non-sdk entry carries a rationale', () => {
    const sdkWithout = I18N_ROUTE_LEDGER.filter((e) => e.disposition === 'sdk' && !e.client).map((e) => e.route);
    expect(sdkWithout, 'sdk-disposition entries missing a client method name').toEqual([]);

    const bareNonSdk = I18N_ROUTE_LEDGER.filter((e) => e.disposition !== 'sdk' && !e.note).map((e) => e.route);
    expect(bareNonSdk, 'non-sdk entries must say WHY they are not SDK surface').toEqual([]);
  });

  it('gap and mismatch counts only shrink — update the ledger (and these numbers) when closing them', () => {
    // Ratchet, not aspiration. This surface audited at TWO mismatches (#3636):
    // getTranslations and getFieldLabels each spoke a `?locale=` dialect no
    // server mounts. Both were closed in the same PR by moving the client to
    // the path form the spec declares, so all three routes are SDK-expressed
    // and these bounds stay 0.
    const gaps = I18N_ROUTE_LEDGER.filter((e) => e.disposition === 'gap').length;
    expect(gaps).toBeLessThanOrEqual(0);

    const mismatches = I18N_ROUTE_LEDGER.filter((e) => e.disposition === 'mismatch').length;
    expect(mismatches).toBeLessThanOrEqual(0);
  });
});
