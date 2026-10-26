/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `breadcrumbs` on a `page` NODE is refused at parse, and
 * `content/docs/guide/layout.md` no longer teaches it (objectui#8871, ADR-0049
 * enforce-or-remove).
 *
 * ## What this is, and what it deliberately is NOT
 *
 * objectui#7926 refused `actions` on this same node and, in the same breath,
 * LEFT `breadcrumbs` parsing on purpose — its census had found both, its ruling
 * covered only the first, and `page-actions-refusal-7926.test.ts` carried a pin
 * saying so out loud precisely so that a later retirement could not happen by
 * accident. This file is that retirement; that pin is FLIPPED, not deleted, so
 * the closure stays asserted rather than becoming a silent absence.
 *
 * ⛔ objectui#7926's maintainer ruling is NOT borrowed. By its own comments it
 * covers `actions` and nothing else. What governs this key is the standing
 * ADR-0049 enforce-or-remove discipline, which this repository applies to this
 * exact face: `zod/tombstone.zod.ts`'s `retirementTombstone` is documented as
 * the "ADR-0049 RETIREMENT TOMBSTONE" helper and is internal to these zod
 * modules; 63 changesets cite the ADR; and `PageNodeSchema` already carries one
 * of its refusal arms one member up.
 *
 * ## What was measured — the frame is BASE `93127bd6f`, stated out loud
 *
 * ZERO readers, ⛔ measured with a POINT-ACCESS probe rather than a bare word.
 * On the base, `\.breadcrumbs` scores 0 over the whole tree (exit 1) against 12
 * files tree-wide (10 under `packages/`) for `\.breadcrumb\b` as the lit
 * control. At HEAD those two become 16 and 13, and `\.breadcrumbs` itself turns
 * exit 0 over 4 files / 6 lines — every one of those hits is one of THIS
 * branch's own four files (the changeset, this pin, `layout.ts`,
 * `zod/layout.zod.ts`) matching only because it QUOTES the probe string, and
 * the eight exclusions spelled out at the tree-scoped pin below take HEAD back
 * to exit 1. ⛔ Do not mix the two frames: the base numbers are the
 * measurement, the head numbers are this branch's own echo of it, and no
 * single tree satisfies a sentence that pairs one with the other.
 * The bare word would have lied: it also names Sentry's own unrelated concept
 * (`app-shell/src/observability/sentry.ts`) and appears in two comments
 * listing UI surfaces (`core/src/utils/record-title.ts`,
 * `layout/src/NavigationRenderer.tsx`) — three prose sites, no reader, no
 * declaration, and a bare probe reports "5 readers" that do not exist.
 *
 * THREE author sites, all teaching passages in one file, and the count CORRECTS
 * objectui#7926's "1 site": that census reads every git-tracked JSON file,
 * every `json` fence in `.md`/`.mdx`, and every TS/TSX object literal via the
 * TypeScript AST (PR #8870), and it missed two of the three passages for two
 * DIFFERENT reasons — one passage's literal does carry `type: 'page'` but sits
 * inside a markdown `typescript` fence, a fence LANGUAGE the census's
 * `json`-fence reader never visits, and the other is a `json`-fenced fragment
 * that never writes `type` at all. `the guide teaches the node, not the key`
 * below is that correction as an assertion — it reads the guide by TEXT rather
 * than by parsed page nodes, which sidesteps both blind spots that produced
 * the undercount.
 *
 * ## Why a refusal rather than a reader
 *
 * The remedy already ships as a node: `breadcrumb` is registered
 * (`packages/components/src/renderers/data-display/breadcrumb.tsx`) and its
 * `items` take the very `{ label, href }` shape these passages authored. Growing
 * a second road to the same trail would mint a rival spelling for a vocabulary
 * that already renders.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { PageNodeSchema } from '../zod/layout.zod.js';
import type { PageNodeSchema as TsPageNodeSchema } from '../layout.js';

const REPO_ROOT = resolve(__dirname, '../../../..');
const GUIDE_PATH = resolve(REPO_ROOT, 'content/docs/guide/layout.md');

/** The document the guide used to teach, verbatim in shape. */
const RETIRED_DOC = {
  type: 'page',
  title: 'Acme Corporation',
  breadcrumbs: [
    { label: 'Home', href: '/' },
    { label: 'Customers', href: '/customers' },
    { label: 'Acme Corporation' },
  ],
};

describe('objectui#8871 — the `page` node refuses `breadcrumbs` (contract half)', () => {
  it('the key is DECLARED, which is what makes the refusal loud rather than a strip', () => {
    // The whole defect was that it was NOT in the shape: an undeclared key on a
    // `.passthrough()` object is kept in silence. A refusal has to be declared.
    // This is also why a bare DELETION was never on the table — there was
    // nothing to delete.
    expect(Object.keys(PageNodeSchema.shape)).toContain('breadcrumbs');
  });

  it('refuses the retired document at parse, at the `breadcrumbs` path', () => {
    const r = PageNodeSchema.safeParse(RETIRED_DOC);
    expect(r.success).toBe(false);
    const issues = r.success ? [] : r.error.issues;
    expect(issues.map((i) => i.path.join('.'))).toContain('breadcrumbs');
  });

  it('the refusal reports `invalid_type` — the tombstone code, not a custom arm', () => {
    // `retirementTombstone` is a `z.never` arm: the CODE and PATH are what a bare
    // `z.never()` reports, and only the MESSAGE is customised. Its sibling
    // `handlerKeyRefusal` reports `custom` instead, and the two are deliberately
    // distinguishable — asserting the code is what keeps them from drifting into
    // each other.
    const r = PageNodeSchema.safeParse(RETIRED_DOC);
    const issue = (r.success ? [] : r.error.issues).find((i) => i.path.join('.') === 'breadcrumbs');
    expect(issue).toBeDefined();
    expect(issue!.code).toBe('invalid_type');
  });

  it('the refusal message carries the remedy, not just a type name', () => {
    const r = PageNodeSchema.safeParse(RETIRED_DOC);
    const issue = (r.success ? [] : r.error.issues).find((i) => i.path.join('.') === 'breadcrumbs');
    expect(issue).toBeDefined();
    const message = issue!.message;
    // Named subject + the node that actually draws + the key that is NOT the
    // answer. NOT the whole sentence: pinning prose byte-for-byte turns every
    // wording fix red for no gain (AGENTS.md — assert the named subject, not the
    // copy).
    expect(message).toContain('breadcrumbs');
    expect(message).toContain('breadcrumb');
    // The remedy key, which objectui#6771 moved from `body` to `children`.
    expect(message).toContain('children');
    expect(message).toContain('page:header');
    // Zod's own default for a `never` arm says none of this.
    expect(message).not.toBe('Invalid input: expected never, received array');
  });

  it('POSITIVE CONTROL — the same document without `breadcrumbs` parses green', () => {
    // Without this leg, a schema that refused EVERY page document would pass the
    // assertions above.
    const { breadcrumbs, ...withoutBreadcrumbs } = RETIRED_DOC;
    expect(breadcrumbs).toBeDefined();
    expect(PageNodeSchema.safeParse(withoutBreadcrumbs).success).toBe(true);
  });

  it('the remedy the message names actually parses — a `breadcrumb` node in `children`', () => {
    const r = PageNodeSchema.safeParse({
      type: 'page',
      title: 'Acme Corporation',
      children: [
        {
          type: 'breadcrumb',
          items: [
            { label: 'Home', href: '/' },
            { label: 'Customers', href: '/customers' },
            { label: 'Acme Corporation' },
          ],
        },
      ],
    });
    expect(r.success).toBe(true);
  });

  it('the refusal is TARGETED, not a strict node', () => {
    // Restated from the other card's side too (`page-actions-refusal-7926.test.ts`,
    // and `page-app-dashboard-spec-parity.test.ts` from the other direction). It
    // is restated HERE because this card is now the one that would break it: the
    // cheap way to refuse a second key is `.strict()`, and the census is the
    // reason that is the wrong shape — only two of the 23 passthrough-surviving
    // undeclared keys land on a real `page` node, and strictness would redden a
    // living pin.
    expect(PageNodeSchema.safeParse({ type: 'page', someRendererProp: 42 }).success).toBe(true);
  });

  it('the TypeScript twin refuses it too', () => {
    // `?: never` — the pair `zod-mirror-parity.test.ts` compares. The
    // `@ts-expect-error` IS the assertion: it fails to compile (packages/types
    // `type-check`) if the key ever becomes assignable again.
    const page: TsPageNodeSchema = {
      type: 'page',
      title: 'Acme Corporation',
      // @ts-expect-error `breadcrumbs` is refused by name on the page node (objectui#8871)
      breadcrumbs: [{ label: 'Home', href: '/' }],
    };
    expect(page.type).toBe('page');
  });
});

describe('objectui#8871 — the guide teaches the node, not the key', () => {
  const guide = readFileSync(GUIDE_PATH, 'utf8');

  it('LIT CONTROL — the guide is readable and still teaches page nodes', () => {
    // Three ways the assertions below could report a vacuous zero, so three
    // controls: the file is non-empty, it still declares page nodes, and it still
    // contains the SINGULAR spelling this card steers authors to.
    expect(guide.length).toBeGreaterThan(1000);
    expect(guide).toContain('"type": "page"');
    expect(guide).toContain('"type": "breadcrumb"');
  });

  it('no passage authors or declares `breadcrumbs` any more', () => {
    // Read by TEXT, not by parsed page nodes. That is deliberate, and the reason
    // is a FENCE-LANGUAGE blind spot — ⛔ not a missing `type` key. objectui#7926's
    // census (PR #8870) reads, in that PR's own words, "every git-tracked JSON
    // file, every `json` fence in `.md`/`.mdx`, and every TS/TSX object literal
    // (TypeScript AST)". It reported ONE site where there are three, for TWO
    // DIFFERENT reasons. The Schema API block's literal DOES carry `type: 'page'`
    // (guide `:201`, inside the fence opened at `:199` and closed at `:225`) —
    // but that fence is tagged `typescript`, a fence LANGUAGE that population
    // never visits, so the block was never read at all. Best Practices §2 does
    // sit in a `json` fence the census reads (`:680`), but that fragment never
    // writes `type` (`:682` is the bare `"breadcrumbs": [`), so a `page`-tagged
    // filter correctly excluded it. Only the "Detail Page with Actions" fence
    // (`:533`/`:535`/`:537`) is visible to both instruments. A text scan has
    // neither blind spot, which is why it is the shape that sees all three.
    const offenders = guide
      .split('\n')
      .map((line, i) => ({ line: i + 1, text: line }))
      // The refusal callout and the "not this key" warnings NAME the retired key
      // on purpose; what must be gone is the key being WRITTEN or DECLARED.
      .filter(({ text }) => /(^|[^`\w])"?breadcrumbs"?\s*[:?]/.test(text))
      .map(({ line, text }) => `${line}: ${text.trim()}`);
    expect(offenders).toEqual([]);
  });

  it('LIT CONTROL — that scan can see an authored key when one is there', () => {
    // Without this the assertion above passes on a broken regex. `title` is
    // authored in the same fences the retired key used to sit in.
    const seen = guide
      .split('\n')
      .filter((text) => /(^|[^`\w])"?title"?\s*[:?]/.test(text));
    expect(seen.length).toBeGreaterThan(3);
  });

  it('the retirement is EXPLAINED where it was taught, not silently dropped', () => {
    // A deletion that leaves no trace teaches the next author nothing — they
    // rewrite the key from memory. The guide must name the card and the remedy.
    expect(guide).toContain('objectui#8871');
    expect(guide).toMatch(/breadcrumb.*node.*`children`|`children`.*breadcrumb.*node/s);
  });
});

describe('objectui#8871 — the key is gone from the tree, not just from the guide', () => {
  /**
   * ⭐ TREE-SCOPED, never file-scoped. A file-scoped absence check only sees the
   * files its author thought of; what escapes is exactly the reference he did not
   * know about — including one written AFTER the removal. The scan therefore runs
   * over every tracked file and subtracts only what cannot be an author site:
   *
   *  - `CHANGELOG.md` / `.changeset/` — the historical record of this very
   *    retirement, which must keep naming the key;
   *  - this pin and its sibling `page-actions-refusal-7926.test.ts`, which assert
   *    the refusal and must therefore write the key to trip it;
   *  - `content/docs/guide/layout.md`, whose refusal callout names the key to
   *    steer authors off it (that the key is not AUTHORED there is asserted
   *    above, by a scan shaped for prose);
   *  - the two DECLARATION files, `zod/layout.zod.ts` and `layout.ts`. The
   *    tombstone and its `?: never` twin ARE the refusal — they are the only two
   *    places the key is SUPPOSED to be spelled, and a scan that reddened on them
   *    would be asserting the retirement had not landed. That they refuse rather
   *    than read is not taken on trust here: it is asserted by the parse legs and
   *    the `@ts-expect-error` leg above, which fail if either face ever accepts
   *    the key again.
   *  - `page-app-dashboard-spec-parity.test.ts`, whose `local` ledger row records
   *    that the key exists on this shape at all.
   *
   * ⛔ No allow-list FILE: a list that lives on disk outlives the reason for each
   * of its rows. The exclusions are spelled here, beside the reason.
   */
  const EXCLUDED = [
    ':!*CHANGELOG.md',
    ':!.changeset/',
    ':!packages/types/src/__tests__/page-breadcrumbs-refusal-8871.test.ts',
    ':!packages/types/src/__tests__/page-actions-refusal-7926.test.ts',
    ':!packages/types/src/__tests__/page-app-dashboard-spec-parity.test.ts',
    ':!content/docs/guide/layout.md',
    ':!packages/types/src/zod/layout.zod.ts',
    ':!packages/types/src/layout.ts',
  ];

  /** `git grep -n <pattern> -- . <exclusions>`, exit 1 (no match) normalised to an empty list. */
  const grepTree = (pattern: string): string[] => {
    try {
      const out = execFileSync('git', ['grep', '-nE', pattern, '--', '.', ...EXCLUDED], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
      });
      return out.split('\n').filter(Boolean);
    } catch (e) {
      // `git grep` exits 1 for "no matches" — that is the PASS case here, and it
      // is distinguished from a real failure (exit >1) rather than swallowed.
      const status = (e as { status?: number }).status;
      if (status === 1) return [];
      throw e;
    }
  };

  it('nothing outside the record and the pins AUTHORS `breadcrumbs`', () => {
    expect(grepTree('(^|[^a-zA-Z])("breadcrumbs"|\'breadcrumbs\'|breadcrumbs)\\s*[:?]')).toEqual([]);
  });

  it('nothing READS `.breadcrumbs` — the point-access probe, tree-wide', () => {
    // The measurement this retirement rests on, kept as a standing assertion so
    // a reader cannot be added without this line going red beside it.
    expect(grepTree('\\.breadcrumbs')).toEqual([]);
  });

  it('LIT CONTROL — the same probe one letter shorter still finds the LIVE singular key', () => {
    // Without this, both assertions above would pass on a broken `git grep`
    // invocation, a wrong cwd, or an exclusion list that swallowed the tree.
    // `.breadcrumb` (singular) is the live `page:header` toggle and the
    // config-panel segment list, and it must keep firing.
    expect(grepTree('\\.breadcrumb\\b').length).toBeGreaterThan(3);
  });
});
