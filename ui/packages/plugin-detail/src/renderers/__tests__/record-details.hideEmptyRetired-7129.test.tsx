/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `DetailViewSection.hideEmpty` — the FOUR-PARTY alignment pin (objectui#7129,
 * objectui#8603).
 *
 * ⚠️ The filename says `hideEmptyRetired-7129` and is deliberately kept. This
 * file is this key's lineage pin, not a pin on one verdict: the ruling that
 * created it was superseded for this key, and a rename would cost the history
 * that makes the supersession legible. What the four parties SAY is below and
 * is the only thing to read for today's contract.
 *
 * | party                                          | says                 |
 * |------------------------------------------------|----------------------|
 * | `@objectstack/spec` `RecordDetailsProps`        | ✅ DECLARES it (17.3.0+) |
 * | `@object-ui/types` `DetailViewSection`          | ✅ declares it        |
 * | `./zod/views.zod.ts` `DetailViewSectionSchema`  | ✅ mirrors it         |
 * | `RecordDetailsRenderer` + `DetailSection`       | ✅ READS it           |
 *
 * ## How the four got here
 *
 * They disagreed three ways, measured on PR #7123: the spec REFUSED the key at
 * 17.2.0, `@object-ui/types` declared it, the mirror omitted it, the renderer
 * honoured it — and the declaration was the only thing that made the key
 * writable, so on a spec-validated page the "author escape hatch" the
 * 2026-08-31 ruling described existed nowhere. The maintainer converged the
 * four on the spec's answer (2026-09-01, director-seat batch #28): retire the
 * declaration and the read, keep the spec refusing, keep the mirror absent.
 *
 * `@objectstack/spec` 17.3.0 then RE-DECLARED `hideEmpty` on the
 * `record:details` section entry (upstream #11289, maintainer ruling
 * 2026-08-23 direction 1, written from a measured symptom and with "the
 * renderer is unchanged" written into the declaration). The clause "keep the spec
 * refusing" thereby described nothing, through no act of this repo — and the
 * premise it rested on had been false upstream since before the ruling was
 * written.
 *
 * objectui#8603 (director seat batch #137 item 3, with the maintainer's
 * assent, 2026-09-15) ruled the protocol correct and RESTORED the read, superseding
 * #7129's Q1-A for this key. Q2-C — `DetailSection`'s auto-hide heuristic
 * owning the empty ROWS of a section that still has a filled one — is
 * untouched, and `record-details.emptySectionDefault.test.tsx` is where that
 * boundary is pinned on both sides.
 *
 * ⇒ The decision this file used to route to objectui#7122 has been taken.
 * That card closed `completed` on 2026-09-07 on an unrelated subject
 * (`CalendarConfigSchema.titleField`), so the routing pointed at a closed card
 * on a different question; the target is now objectui#8603, where the ruling
 * is.
 *
 * ## Why one file
 *
 * Alignment is a claim about FOUR sources at once, and each of them is green on
 * its own while the set disagrees — which is exactly how the divergence
 * survived. Pinning them separately reproduces that blind spot; pinning them
 * together makes any one party moving a single red test.
 *
 * ⚠️ Two same-named keys are NOT in scope here and must stay untouched:
 *   - `record:reference_rail`'s own `hideEmpty` prop (`../record-reference-rail.tsx`)
 *     — a different surface, a different renderer, its own component-level
 *     semantics, still registered as its own input in `../../index.tsx`;
 *   - the `detail.hideEmptyFields` i18n label (the "Show N empty fields"
 *     toggle's copy, in all ten locale packs) — a PREFIX match on the name,
 *     not this key.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import * as React from 'react';
import { RecordContextProvider } from '@object-ui/react';
import { RecordDetailsProps } from '@objectstack/spec/ui';
import { DetailViewSectionSchema } from '@object-ui/types/zod';
import type { DetailViewSection } from '@object-ui/types';
import { RecordDetailsRenderer } from '../record-details';

/* ── Party 3: `@object-ui/types` no longer DECLARES it ────────────────────── */

type Assert<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? true
  : false;

type Declares<K extends string> = K extends keyof DetailViewSection ? true : false;

/**
 * Erased at runtime, so `tsc` is the only thing that can see it — this package's
 * `tsconfig.test.json` is what compiles it, reading `@object-ui/types` through
 * the workspace dependency's BUILT `.d.ts` (its `paths` are empty). Deleting
 * `hideEmpty?: boolean` from `DetailViewSection` turns this red and nothing
 * else in this file moves. It asserted `false` while objectui#7129 held.
 */
export type assertionHideEmptyIsDeclared = Assert<Equal<Declares<'hideEmpty'>, true>>;

/**
 * Non-vacuity for the assertion above: a key the interface does NOT declare
 * resolves `false` through the same `Declares<…>`, so `true` above is a
 * measurement and not a conditional that answers `true` for everything. The
 * probe key is minted for this file and verified absent from the interface.
 */
export type assertionDeclaresProbeWorks = Assert<Equal<Declares<'os8603AbsentProbeQhx'>, false>>;

/* ── The three runtime parties ────────────────────────────────────────────── */

const objectSchema = {
  fields: {
    // DECLARED and left UNSET on the record below, so the `record:details`
    // dedupe ladder resolves its page-H1 candidate to `name`, finds no value
    // there and hides nothing (objectui#8175). Without it the ladder's ADR-0079
    // derivation rung ends in "first title-eligible field by declaration
    // order" — `industry` — and the H1 eats the one filled field, which is the
    // CONTROL section below. Measured: the control section then renders no
    // fields, takes `DetailSection`'s all-fields-hidden exit, and the absence
    // assertions in 4/4 pass against a body that rendered nothing at all —
    // exactly the vacuous green the control exists to make impossible.
    name: { type: 'text', label: 'Name' },
    industry: { type: 'text', label: 'Industry' },
    stage: { type: 'text', label: 'Stage' },
    amount: { type: 'text', label: 'Amount' },
    close_date: { type: 'text', label: 'Close Date' },
  },
};

beforeEach(() => {
  // `useRecordEditable` probes `POST /api/v1/security/explain` for the
  // ROW-level verdict, and happy-dom resolves that relative URL to a REAL
  // socket, which the repo's network-escape guard fails the file for
  // (objectui#6640). Serve it from a double instead. Its answer is orthogonal
  // to everything below — this file observes an EMPTY section's skeleton, and
  // the inline-edit affordance is not part of that.
  //
  // ⛔ There is no list to join instead: the guard's `KNOWN_ESCAPES` burn-down
  // reached zero and was retired on objectui#7307, so serving the probe from a
  // double is the ONLY way a file that reaches a socket goes green.
  //
  // WHAT IT ANSWERS, and why it is shaped this way (objectui#7996). The body
  // this double used to serve was `{ allowed: true }`, and NEITHER hook that
  // reaches this endpoint reads an `allowed` key: `useRecordEditable` reads
  // `decision?.record?.visible` and returns early when it is not a boolean,
  // and `useRecordCrudVerdicts` reads `decision.records` and `continue`s when
  // it is not an array. ⇒ Both fell to their fail-open branch, so the double
  // took EXACTLY the path it takes on `ECONNREFUSED` — measured by replacing
  // the body with `{}`, which left this file green. The response body was
  // inert, and its cost was forward-looking: this is one of the few landed
  // examples of answering this endpoint, so a reader copying it inherits a
  // body the product ignores, and a future test meaning to pin a SPECIFIC
  // verdict writes `allowed` and quietly measures the fail-open branch.
  //
  // The shapes below are the ones the hooks actually read, converged on the
  // in-repo example objectui#7307 batch 1 landed: `{ record: { visible } }` for
  // a single `recordId`, `{ records: [{ recordId, visible }] }` for a batched
  // `recordIds`.
  //
  // ⚠ This does NOT move this file's verdict, and that is the point rather
  // than a problem: `useRecordEditable` initialises `allowed` to `true` and its
  // fail-open path leaves it there, and the only consumer of the batched lookup
  // rules on `recordVerdict !== false` — so `true` and the absent verdict are
  // the same value at every read site. Measured on this file: the only requests
  // it makes are single-`recordId` (`update` and `delete` on
  // `crm_opportunity`), so the batched branch answers the reader who copies
  // this double into a grid suite, not this file's own render.
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
      let request: Record<string, unknown> = {};
      try {
        request = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      } catch {
        /* a non-JSON body is not a request this route can answer */
      }
      const recordIds = Array.isArray(request.recordIds)
        ? (request.recordIds as string[])
        : null;
      // One payload feeds both readers, so `json()` and `text()` cannot drift
      // into disagreeing about what this route answered.
      const payload = recordIds
        ? { records: recordIds.map((recordId) => ({ recordId, visible: true })) }
        : { record: { visible: true } };
      return {
        ok: true,
        status: 200,
        json: async () => payload,
        text: async () => JSON.stringify(payload),
      };
    }) as never,
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('DetailViewSection.hideEmpty — all four parties declare and honour it again (#7129 → #8603)', () => {
  it('1/4 — `@objectstack/spec` DECLARES the key on the `record:details` section entry', () => {
    // ⭐ READ THIS BEFORE CHANGING ANYTHING ELSE IN THIS FILE.
    //
    // This is the party objectui does not control, and it is why the other
    // three below say what they say. The 2026-09-01 ruling (batch #28)
    // converged four disagreeing contracts on the spec's answer, in these
    // words: "retire the declaration and the read, keep the spec refusing,
    // keep the mirror absent". `@objectstack/spec` 17.3.0 then declared
    // `hideEmpty` on this entry — one of eight keys it gained (4 → 12 members,
    // lost set empty) — so that clause described nothing, through no act of
    // this repo, and objectui#8603 realigned the other three onto it.
    //
    // ⛔ The key's `describe()` text is NOT asserted here. It is the promise
    // this renderer's behaviour must keep — 4/4 below is where that is
    // measured — but nothing in this repo PARSES that prose, so pinning it
    // would fail on an upstream rewording that changed no contract.
    const parsed = RecordDetailsProps.safeParse({
      sections: [{ label: 'Contact', fields: ['phone'], hideEmpty: true }],
    });

    expect(parsed.success).toBe(true);
    // Value reachability, not just key presence: a declared-but-unusable key
    // would leave the divergence smaller than this comment claims.
    expect(
      (parsed.data as { sections?: { hideEmpty?: boolean }[] })?.sections?.[0]?.hideEmpty,
    ).toBe(true);

    // CONTROL, and it is what stops this from reading as "the spec went soft":
    // the section object is still STRICT, so an undeclared key is still refused
    // by name. `hideEmpty` parses because it was DECLARED, not because
    // unrecognized keys stopped being refused.
    const undeclared = RecordDetailsProps.safeParse({
      sections: [{ label: 'Contact', fields: ['phone'], __objectui_7129_probe__: true }],
    });
    expect(undeclared.success).toBe(false);
    expect(undeclared.error?.issues.map((i) => i.code)).toContain('unrecognized_keys');
    const refused = undeclared.error?.issues.flatMap(
      (i) => (i as unknown as { keys?: string[] }).keys ?? [],
    );
    expect(refused).toContain('__objectui_7129_probe__');

    // CONTROL: a declared section key parses AND its value survives, so the
    // reading above is about the section object the probe built and not about
    // a probe that built one wrong.
    const control = RecordDetailsProps.safeParse({
      sections: [{ label: 'Contact', fields: ['phone'], columns: 2 }],
    });
    expect(control.success).toBe(true);
    expect((control.data as { sections?: { columns?: number }[] })?.sections?.[0]?.columns).toBe(2);
  });

  it('2/4 — the `DetailViewSectionSchema` zod mirror CARRIES the key', () => {
    const mirrored = Object.keys(DetailViewSectionSchema.shape);

    expect(mirrored).toContain('hideEmpty');
    // CONTROL: the mirror really was read, and reading it can still answer NO —
    // `headerColor` is a key it carries, and a minted key it does not.
    expect(mirrored).toContain('headerColor');
    expect(mirrored).not.toContain('os8603AbsentProbeQhx');
  });

  // 3/4 is the compile-time pair above; `vitest` proves nothing about it.

  it('4/4 — `record:details` READS the key end to end, in BOTH directions', () => {
    // An all-empty section is the case this key owns and the case the read
    // decides: `hideEmpty: true` (and the renderer default) makes the whole
    // section disappear, `false` keeps its heading and label skeleton.
    //
    // ⚠️ Deliberately end-to-end rather than "the renderer passes it on".
    // Measured on #7129's ablation: `RecordDetailsRenderer` spreads `...s`, so
    // deleting its explicit `hideEmpty: s.hideEmpty` slot left the value still
    // reaching `DetailSection` and that suite GREEN. The read that decides
    // anything is `DetailSection`'s, and this is the assertion that moves when
    // it moves. A pin written against the renderer's slot alone would be a pin
    // that cannot fail.
    //
    // ⚠️ NON-VACUITY: every render below carries a sibling CONTROL section that
    // must appear. "Nothing rendered" is the verdict of the first case, and
    // without a control it is also what a render that never happened looks
    // like — a crashed or empty tree would satisfy the absence assertions on
    // its own.
    const renderWith = (section: Record<string, unknown>) =>
      render(
        <RecordContextProvider
          objectName="crm_opportunity"
          recordId="O1"
          data={{ industry: 'Manufacturing' }}
          objectSchema={objectSchema}
        >
          <RecordDetailsRenderer
            schema={
              {
                sections: [
                  { name: 'deal_terms', label: 'Deal Terms', fields: ['stage', 'amount', 'close_date'], ...section },
                  // CONTROL: `industry` is the one filled field on the record,
                  // so this section renders in every case below.
                  { name: 'firmographics', label: 'Firmographics', fields: ['industry'] },
                ],
              } as never
            }
          />
        </RecordContextProvider>,
      );

    // (a) authored `true` — the section renders nothing at all.
    const hidden = renderWith({ hideEmpty: true });
    expect(screen.getByText('Firmographics')).toBeInTheDocument();
    expect(screen.getByText('Manufacturing')).toBeInTheDocument();
    expect(screen.queryByText('Deal Terms')).not.toBeInTheDocument();
    for (const label of ['Stage', 'Amount', 'Close Date']) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
    expect(screen.queryAllByTitle('No value')).toHaveLength(0);
    hidden.unmount();

    // (b) authored `false` — heading and skeleton stay. Same fixture, same
    // control, so the pair isolates the key and nothing else.
    const kept = renderWith({ hideEmpty: false });
    expect(screen.getByText('Firmographics')).toBeInTheDocument();
    expect(screen.getByText('Deal Terms')).toBeInTheDocument();
    for (const label of ['Stage', 'Amount', 'Close Date']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.queryAllByTitle('No value')).toHaveLength(3);
    kept.unmount();
  });
});
