/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The post-save advisory affordance (objectui#4133).
 *
 * The save SUCCEEDED, so the whole point of these pins is the tier: the
 * findings land on the WARNING channel and never the error one. A successful
 * save that reads as a failure is the specific defect this surface must not
 * ship — the card says so, and the sibling write-warning toast
 * (`writeWarningToast.ts`) learned the same lesson at objectui#3484 point B.
 *
 * The sink is handed over rather than mocked, exactly as its sibling does, so
 * nothing here depends on vitest project isolation.
 */

import { describe, it, expect, vi } from 'vitest';
import type { MetadataSaveAdvisoryEvent } from '@object-ui/data-objectstack';
import { emitSaveAdvisories, type TranslateFn } from './saveAdvisoryToast';

/** i18next-shaped `t` that renders the inline default with its holes filled. */
const t: TranslateFn = (key, options) => {
  const raw = (options?.defaultValue as string) ?? key;
  let out = raw;
  for (const [k, v] of Object.entries(options ?? {})) {
    if (k === 'defaultValue') continue;
    out = out.split(`{{${k}}}`).join(String(v));
  }
  return out;
};

function makeSink() {
  return {
    warning: vi.fn<(title: string, opts?: { description?: string; duration?: number }) => void>(),
    // Present so a mistaken `sink.error(...)` would be observable rather than
    // a TypeError — the assertion below is that it is never reached.
    error: vi.fn(),
    success: vi.fn(),
  };
}

const FINDING = {
  severity: 'warning' as const,
  rule: 'flow/delete-without-filter',
  where: 'flow "nightly_purge" · node "purge old rows"',
  path: 'flows[0].nodes[2].config.filters',
  message: 'this delete_record node sets multi: true with no filter, so it deletes every row',
  hint: 'add a filter, or set multi: false to delete a single record',
};

function event(overrides: Partial<MetadataSaveAdvisoryEvent> = {}): MetadataSaveAdvisoryEvent {
  return {
    type: 'flow',
    name: 'nightly_purge',
    door: 'save',
    mode: 'publish',
    advisories: [FINDING],
    ...overrides,
  };
}

describe('emitSaveAdvisories (#4133)', () => {
  it('renders the findings on the WARNING channel, never the error one', () => {
    const sink = makeSink();

    emitSaveAdvisories(event(), t, sink);

    expect(sink.warning).toHaveBeenCalledTimes(1);
    expect(sink.error).not.toHaveBeenCalled();
  });

  it('acknowledges the save in the title — it succeeded', () => {
    const sink = makeSink();

    emitSaveAdvisories(event(), t, sink);

    const [title] = sink.warning.mock.calls[0]!;
    expect(title).toMatch(/^Saved/);
    expect(title).toContain('1');
  });

  it('lists rule, message and hint for each finding', () => {
    const sink = makeSink();

    emitSaveAdvisories(event(), t, sink);

    const description = sink.warning.mock.calls[0]![1]!.description!;
    expect(description).toContain('flow/delete-without-filter');
    expect(description).toContain(FINDING.message);
    expect(description).toContain(FINDING.hint);
  });

  it('renders `where` as secondary context and omits the machine `path`', () => {
    const sink = makeSink();

    emitSaveAdvisories(event(), t, sink);

    const description = sink.warning.mock.calls[0]![1]!.description!;
    expect(description).toContain('flow "nightly_purge" · node "purge old rows"');
    expect(description).not.toContain('flows[0].nodes[2].config.filters');
  });

  it('renders server prose verbatim — message and hint are not translated', () => {
    const sink = makeSink();
    // A `t` that mangles everything it is given. The finding text must survive
    // it untouched, because it is server data and not an i18n key.
    const shoutingT: TranslateFn = () => 'TRANSLATED-TITLE';

    emitSaveAdvisories(event(), shoutingT, sink);

    const [title, opts] = sink.warning.mock.calls[0]!;
    expect(title).toBe('TRANSLATED-TITLE');
    expect(opts!.description).toContain(FINDING.message);
    expect(opts!.description).toContain(FINDING.hint);
  });

  it('lists every finding when the gate returned several', () => {
    const sink = makeSink();
    const second = { ...FINDING, rule: 'flow/unreachable-node', message: 'node 4 is unreachable' };

    emitSaveAdvisories(event({ advisories: [FINDING, second] }), t, sink);

    const [title, opts] = sink.warning.mock.calls[0]!;
    expect(title).toContain('2');
    expect(opts!.description).toContain('flow/delete-without-filter');
    expect(opts!.description).toContain('flow/unreachable-node');
    expect(opts!.description!.split('\n')).toHaveLength(2);
  });

  it('stays on screen long enough to be read', () => {
    const sink = makeSink();

    emitSaveAdvisories(event(), t, sink);

    expect(sink.warning.mock.calls[0]![1]!.duration).toBeGreaterThanOrEqual(10_000);
  });

  it('says nothing when there is nothing to say — a clean save renders no new UI', () => {
    const sink = makeSink();

    emitSaveAdvisories(event({ advisories: [] }), t, sink);

    expect(sink.warning).not.toHaveBeenCalled();
    expect(sink.error).not.toHaveBeenCalled();
    expect(sink.success).not.toHaveBeenCalled();
  });

  it('tolerates a finding with no `where`', () => {
    const sink = makeSink();
    const bare = { ...FINDING, where: '' };

    emitSaveAdvisories(event({ advisories: [bare] }), t, sink);

    const description = sink.warning.mock.calls[0]![1]!.description!;
    expect(description).toContain('[flow/delete-without-filter]');
    expect(description).toContain(FINDING.message);
  });
});

/**
 * The publish door renders through this SAME function (objectui#5026) — same
 * warning tier, same duration, same per-finding formatting. One source more,
 * not one surface more. What must differ is the frame's verb, because in this
 * product Save and Publish are two different buttons: a toast that says "Saved"
 * after a Publish tells the author their change is still a draft, which is the
 * opposite of what happened.
 */
describe('emitSaveAdvisories — the publish door (#5026)', () => {
  const published = () => event({ door: 'publish' });

  it('says "Published", not "Saved", when the findings came through the publish door', () => {
    const sink = makeSink();

    emitSaveAdvisories(published(), t, sink);

    const [title] = sink.warning.mock.calls[0]!;
    expect(title).toContain('Published');
    expect(title).not.toContain('Saved');
  });

  it('keeps saying "Saved" for the save door — the existing wording is untouched', () => {
    const sink = makeSink();

    emitSaveAdvisories(event({ door: 'save' }), t, sink);

    expect(sink.warning.mock.calls[0]![0]).toContain('Saved');
  });

  it('reads the DOOR, not the mode — both doors report `mode: "publish"`', () => {
    // The discriminating case: a direct active save also carries
    // `mode: 'publish'`, so a renderer that branched on `mode` would call it a
    // publish. Same mode on both events here; only `door` differs.
    const saveSink = makeSink();
    const publishSink = makeSink();

    emitSaveAdvisories(event({ door: 'save', mode: 'publish' }), t, saveSink);
    emitSaveAdvisories(event({ door: 'publish', mode: 'publish' }), t, publishSink);

    expect(saveSink.warning.mock.calls[0]![0]).toContain('Saved');
    expect(publishSink.warning.mock.calls[0]![0]).toContain('Published');
  });

  it('is the same surface otherwise — warning tier, same body, same duration', () => {
    const sink = makeSink();

    emitSaveAdvisories(published(), t, sink);

    expect(sink.warning).toHaveBeenCalledTimes(1);
    expect(sink.error).not.toHaveBeenCalled();
    const [, opts] = sink.warning.mock.calls[0]!;
    expect(opts!.description).toContain(FINDING.message);
    expect(opts!.description).toContain(FINDING.hint);
    expect(opts!.duration).toBeGreaterThanOrEqual(10_000);
  });

  it('says nothing on a clean publish', () => {
    const sink = makeSink();

    emitSaveAdvisories(event({ door: 'publish', advisories: [] }), t, sink);

    expect(sink.warning).not.toHaveBeenCalled();
  });
});

/**
 * The exhaustiveness guarantee (#5026, contract-review condition 2).
 *
 * `door` being REQUIRED buys "every type-checked constructor must state a
 * door". It does NOT by itself buy "the renderer handles the door it was
 * given" — with a two-way ternary, a third union member would compile at its
 * constructor, declare itself honestly, and still silently render "Saved",
 * which is the exact class `door` exists to kill, reintroduced one level up.
 *
 * The compile-time half of the fix is the `never` check in `advisoryTitle`,
 * enforced by `tsc` and not expressible here. What IS pinned here is its
 * runtime consequence, which is what an untyped consumer would hit: an
 * unhandled door must NOT come out wearing the save wording.
 */
describe('emitSaveAdvisories — the door union is handled exhaustively', () => {
  it('refuses an unhandled door instead of silently calling it "Saved"', () => {
    const sink = makeSink();
    // An untyped consumer's event. The cast is the point: inside the type
    // system this is unreachable, which is what the `never` check enforces.
    const rogue = event({ door: 'rollback' as unknown as MetadataSaveAdvisoryEvent['door'] });

    expect(() => emitSaveAdvisories(rogue, t, sink)).toThrow(/advisory door/);

    // The load-bearing assertion: nothing was rendered. A wrong verb about a
    // write that already touched the author's data is worse than no toast,
    // and both emitters swallow this throw, so "no toast" is what ships.
    expect(sink.warning).not.toHaveBeenCalled();
    expect(sink.error).not.toHaveBeenCalled();
  });

  it('still handles every door the union actually declares', () => {
    // The control for the case above: the refusal must be specific to an
    // unhandled member, not a renderer that throws at everything.
    for (const door of ['save', 'publish'] as const) {
      const sink = makeSink();
      emitSaveAdvisories(event({ door }), t, sink);
      expect(sink.warning).toHaveBeenCalledTimes(1);
    }
  });
});
