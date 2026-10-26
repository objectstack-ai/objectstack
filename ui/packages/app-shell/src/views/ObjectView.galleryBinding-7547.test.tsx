/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7547 — the object page must not invent a GALLERY cover binding.
 *
 * The third sibling of `ObjectView.calendarBinding-7029` (calendar) and
 * `ObjectView.ganttBinding-7070` (gantt dates) next door, and the last member
 * of that class this face still carried: `imageField` was floored at `'image'`
 * for EVERY object view, declared or not.
 *
 * ⚠️ WHAT MAKES THIS ONE DIFFERENT, and why it still had to go. For calendar
 * and gantt the fabrication produced a WRONG SCREEN — records piled onto
 * today's cell, a chart drawn on names nobody wrote. Gallery does not:
 * `ObjectGallery` resolves the cover per record and collapses the cover area
 * when no record yields one, so the invented `'image'` degraded to a gallery of
 * coverless cards. The defect is one layer up, in the GATE.
 * `ListView.availableViews` asks `schema.options?.gallery?.imageField`, and a
 * key this file always supplied made that check answer YES for every object
 * view whitelisting `gallery` — so ADR-0047's whitelist ∩ resolvable, the
 * mechanism that exists to stop a visualization being offered with nothing
 * behind it, was answering about a name this face wrote. Gallery was offered
 * without a block and looked fine only because the renderer degrades politely.
 * A coincidence, not a design.
 *
 * ⚠️ THE PREMISE WAS MEASURED BEFORE THE DELETION — the discipline objectui#7070
 * wrote down. #7029's mechanic is only correct where the read site's own answer
 * is honest. `ObjectGallery` keeps its own `coverField … ?? 'image'` rung, and
 * that is CORRECT there: it is the component's decision about an unconfigured
 * record, and it is honest because the cover area collapses when the guess
 * yields nothing (`ObjectGallery.tsx`, the `anyItemHasCover` memo). What this
 * face must not do is pre-empt that decision and light the capability gate on
 * the way past.
 *
 * REVERSE VERIFICATION — direction predicted before running, then observed:
 * restore `imageField: viewDef.gallery?.imageField || viewDef.gallery?.coverField
 * || 'image'` and the "invents NO cover field" cases below go RED (they read the
 * fabricated name) while every declared-config CONTROL stays GREEN in either
 * world — the fabricated value is only ever observable when the view declared
 * nothing. That asymmetry is the point: a fix that emitted an empty config for
 * EVERY view would also pass an absence-only test.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { galleryViewOptions } from './ObjectView';

describe('galleryViewOptions — the object page forwards, it does not invent (objectui#7547)', () => {
  it('invents NO cover field for a view that declares no gallery config', () => {
    // THE DEFECT. This used to return `{ imageField: 'image', coverField:
    // undefined, titleField: 'name' }` — a complete-looking cover binding for a
    // view that configured nothing, which is what lit the Gallery toggle on
    // every object view in the product.
    expect(galleryViewOptions({})).toEqual({ titleField: 'name' });
    expect(galleryViewOptions(undefined)).toEqual({ titleField: 'name' });
    expect(galleryViewOptions({ label: 'All', columns: ['name'] })).toEqual({ titleField: 'name' });
  });

  it('invents no cover field for a view whose neighbouring blocks ARE declared', () => {
    // A view bound for kanban/calendar must not acquire a gallery cover by
    // proximity — the Gallery toggle it would light has nothing behind it.
    const out = galleryViewOptions({
      kanban: { groupByField: 'stage' },
      calendar: { startDateField: 'start_date' },
    });
    expect(out).not.toHaveProperty('imageField');
    expect(out).not.toHaveProperty('coverField');
  });

  it('invents no cover field for an EMPTY gallery block', () => {
    // The half-written declaration: `allowedVisualizations: ['gallery']` with
    // nothing under `gallery:`. It must stay half-written all the way down.
    const out = galleryViewOptions({ gallery: {} });
    expect(out).not.toHaveProperty('imageField');
    expect(out).not.toHaveProperty('coverField');
  });

  it('invents no cover field for a gallery block that declares only PRESENTATION', () => {
    // `cardSize` / `visibleFields` are gallery keys that say nothing about a
    // cover binding. They must survive, and they must not answer the gate.
    const out = galleryViewOptions({ gallery: { cardSize: 'large', visibleFields: ['name'] } });
    expect(out).toMatchObject({ cardSize: 'large', visibleFields: ['name'] });
    expect(out).not.toHaveProperty('imageField');
    expect(out).not.toHaveProperty('coverField');
  });

  it('CONTROL: a declared `coverField` goes out as `coverField` ALONE (objectui#6152 round 12)', () => {
    // The spec spelling is `coverField`. This used to cross-fill the legacy
    // `imageField` beside it, because `ListView`'s gate read only `imageField`
    // out of this bag. Since objectui#6152 round 12 the typed bag refuses
    // `options.gallery.imageField` by name and the gate reads `coverField` too,
    // so the cover goes out under the spec key only.
    const out = galleryViewOptions({ gallery: { coverField: 'photo' } });
    expect(out.coverField).toBe('photo');
    expect(out).not.toHaveProperty('imageField');
  });

  it('a stored legacy `imageField` answers nothing (objectui#6152 round 14)', () => {
    // Round 12 left the legacy READ in place for rows stored before the view
    // write door judged the bag; round 14 retired it. The cover binding is read
    // from `coverField` alone, so no `coverField` is synthesized from the alias.
    // The block spread still forwards the stored key as it was stored (a
    // carrier, not a reader): nothing downstream reads it any more.
    const out = galleryViewOptions({ gallery: { imageField: 'logo' } });
    expect(out).not.toHaveProperty('coverField');
    expect(out.imageField).toBe('logo');
  });

  it('CONTROL: both spellings stored — `coverField` keeps its own value', () => {
    // `coverField` is read from itself alone; the stored legacy key rides the
    // spread unchanged.
    const out = galleryViewOptions({ gallery: { imageField: 'logo', coverField: 'photo' } });
    expect(out.coverField).toBe('photo');
    expect(out.imageField).toBe('logo');
  });

  it('CONTROL: forwards a fully declared block verbatim — every spec key survives', () => {
    // A bare whitelist here would drop the presentation keys; the spread is
    // load-bearing, the same way it is in `ganttViewOptions`.
    const out = galleryViewOptions({
      gallery: {
        coverField: 'photo',
        coverFit: 'contain',
        cardSize: 'small',
        visibleFields: ['name', 'owner'],
        titleField: 'subject',
      },
    });
    expect(out).not.toHaveProperty('imageField');
    expect(out).toMatchObject({
      coverField: 'photo',
      coverFit: 'contain',
      cardSize: 'small',
      visibleFields: ['name', 'owner'],
      titleField: 'subject',
    });
  });

  it('keeps the `name` title floor — a display default is not a binding', () => {
    // Deliberately NOT removed by this card, and the same rung
    // `ganttViewOptions` and `timelineViewOptions` carry.
    expect(galleryViewOptions({}).titleField).toBe('name');
    expect(galleryViewOptions({ gallery: { titleField: 'subject' } }).titleField).toBe('subject');
  });
});

describe('no invented gallery cover name survives in the source (objectui#7547)', () => {
  const SOURCE = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'ObjectView.tsx'),
    'utf8',
  );

  /**
   * Executable lines only. The prose above this file's own seams names
   * `'image'` repeatedly — that is the record of what was deleted, and a scan
   * that counted it would be red on a correct tree. Same filter, and same
   * reason, as the objectui#7029 and objectui#7070 scans next door.
   */
  const CODE = SOURCE.split('\n').filter((l) => !/^\s*(\*|\/\*|\/\/)/.test(l));

  it("the fabricated 'image' floor is gone from this face's CODE", () => {
    // A structural tripwire, not a restatement of the cases above: this is what
    // a copy-paste from a sibling branch would reintroduce, and it is invisible
    // to a behavioural test on any object that happens to carry a real `image`
    // field.
    expect(CODE.filter((l) => l.includes("'image'"))).toEqual([]);
  });

  it('CONTROL (machinery): the scan can see a literal that IS there', () => {
    // Anchored on `'name'`, which is DELIBERATELY permanent here — the
    // display-name floor, not a fabricated binding, so no future card of this
    // family retires it and this control cannot go red as a side effect.
    expect(CODE.filter((l) => l.includes("'name'")).length).toBeGreaterThan(0);
  });

  it('CONVERTED (objectui#6152 round 15): NO fabricated field-name floor remains in this face', () => {
    // This case read "the scan still sees a REMAINING fabricated field name",
    // anchored on the chart branch's measure floor
    // (`chartConfig.yAxisFields[0] || 'value'`). objectui#6152 round 15 retired
    // that floor with the legacy chart axes, and with it the last one-rung
    // `|| 'literal'` binding floor in this file: what is left floors a display
    // title or label at `'name'` (the machinery control's anchor, not a
    // fabrication), a view `type` at `'grid'` or a chart family at `'bar'`.
    // So, as this case instructed, it now asserts that NONE remains — the scan
    // keeps making a claim about the tree, and a floor copied back in reds here.
    expect(CODE.filter((l) => /\|\| 'value'/.test(l))).toEqual([]);
    expect(CODE.filter((l) => /\b(?!titleField\b|labelField\b)\w*Field\b[^|\n]*\|\| '[A-Za-z_]+'/.test(l))).toEqual([]);
  });

  it('CONTROL: the scan reads CODE, not the prose that records the deletion', () => {
    // The filter's own correctness. The seam comments above `galleryViewOptions`
    // name the deleted literal; if the filter ever stopped stripping comment
    // lines, the case above would go red on a CORRECT tree and invite someone to
    // weaken it.
    expect(SOURCE.includes("`'image'`")).toBe(true);
    expect(CODE.filter((l) => l.includes("'image'"))).toEqual([]);
  });
});
