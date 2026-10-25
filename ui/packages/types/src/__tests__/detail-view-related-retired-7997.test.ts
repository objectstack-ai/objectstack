/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7997 — `DetailViewSchema.related` is RETIRED on BOTH faces, as a
 * NAMED REFUSAL rather than a deletion.
 *
 * ## The ruling, and what carried it
 *
 * Maintainer, 2026-09-10, quoted verbatim and untranslated because a paraphrase
 * is a different ruling:
 *
 * > 关掉详情页那个入口（推荐）
 *
 * ("close that entry point on the detail page (recommended)".) The axis that
 * carried it was measured ZERO PULL: no application code authored the member,
 * both internal producers of a `detail-view` node (`RecordDetailDrawer`,
 * `renderers/record-details.tsx`) synthesize it without `related`, and the only
 * in-tree authorings carrying real columns were two documents, both rewritten
 * by the same change.
 *
 * ⚠️ An argument that did NOT carry it, recorded so it is not repeated: the
 * protocol's `related: 'tabs'` alias. That alias lives in
 * `RecordPageSchema.slots` (`page.zod.ts`), a SLOT-NAME map whose vocabulary is
 * header | actions | alerts | highlights | details | tabs | discussion. It says
 * "if you name a SLOT `related`, we mean the `tabs` slot" — it matched the
 * WORD, and says nothing about an array of related-list configs, which the
 * protocol never had.
 *
 * ## Why a refusal and not a deletion — the mechanism, not a preference
 *
 * `BaseSchemaCore` ends `.passthrough()` (and `BaseSchema` closed with an
 * any-valued index signature until objectui#8347). A DROPPED member key is
 * therefore KEPT, not refused, on the zod face:
 * deleting the declaration would have left the silent accept exactly as it was
 * and thrown the diagnostic away with it (the mechanism objectui#7963
 * measured). Declared-and-unwritable is what makes the refusal loud —
 * `?: never` on the TypeScript face, `retirementTombstone()` on the mirror.
 *
 * ⭐ The block that proves this is not a stylistic claim is (c) below: it
 * authors an UNDECLARED sibling key through the very same parse and shows it
 * surviving. Without that row, "a bare delete would not have refused it" is an
 * assertion; with it, it is a reading taken on this schema.
 *
 * ## Which program checks this file
 *
 * `packages/types`' `type-check` runs THREE programs; this file is in the third
 * (`tsconfig.test.json` — `tsc --noEmit` builds `tsconfig.json`, which excludes
 * `__tests__/` by directory). The subject is imported as a sibling SOURCE
 * module, so that program reads the declaration directly with no `dist`
 * staleness in between.
 *
 * ## What did NOT retire
 *
 * The capability. `record:related_list` is the protocol-governed entry
 * (`@objectstack/spec` `RecordRelatedListProps`, `columns: z.array(z.string())`),
 * its objectui mirror `RecordRelatedListComponentProps` is unchanged, and both
 * entries always rendered through the same `RelatedList` component. Block (d)
 * pins that survivor, because a retirement pin that only proves absence is
 * equally green against a tree where the whole feature was deleted.
 */

import { describe, it, expect } from 'vitest';
import type { DetailViewSchema } from '../views';
import type { RecordRelatedListComponentProps } from '../record-components';
import { DetailViewSchema as DetailViewZodMirror } from '../zod/views.zod';

/** Mutual assignability, the standard invariant `Eq` — not `extends`. */
type Eq<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2)
  ? true
  : false;

/* ── (a) the TypeScript face ──────────────────────────────────────────────── */

describe('objectui#7997 — the TypeScript face refuses `related`', () => {
  it('the member is a `never` tombstone, not a deleted key and not a value type', () => {
    // Mutual assignability, so this fails in BOTH directions: restore any value
    // type (the retired array, or the `Array of (TableColumn OR string)` this
    // branch briefly carried as Route A) and it fails; DELETE the member
    // outright and it also fails, because `BaseSchema`'s index signature would
    // then type the key `any` rather than `undefined`. That second direction is
    // the one worth having — it is the caricature this whole card warns about.
    const _tombstoned: Eq<DetailViewSchema['related'], undefined> = true;
    expect(_tombstoned).toBe(true);
  });

  it('authoring a related array no longer compiles', () => {
    const view: DetailViewSchema = {
      type: 'detail-view',
      // @ts-expect-error `related` is retired — author a `record:related_list` block (objectui#7997)
      related: [{ title: 'Contacts', type: 'table', api: 'contact', columns: ['name'] }],
    };
    expect(view).toBeDefined();
  });

  it('even an EMPTY related array no longer compiles', () => {
    // The shape a producer reaches for when it has nothing to show. Retiring a
    // key that still admits its own empty value would be a half-retirement.
    const view: DetailViewSchema = {
      type: 'detail-view',
      // @ts-expect-error `related` is retired in every form, empty included (objectui#7997)
      related: [],
    };
    expect(view).toBeDefined();
  });

  it('the REST of the node still type-checks — this is a member retirement', () => {
    // The control for the three rows above: they are about one key, not about a
    // declaration that stopped accepting anything.
    const view: DetailViewSchema = {
      type: 'detail-view',
      title: 'Account',
      objectName: 'account',
      autoTabs: true,
      tabs: [{ key: 'notes', label: 'Notes', content: { type: 'text' } }],
    };
    expect(view.tabs).toHaveLength(1);
  });
});

/* ── (b) the zod mirror ───────────────────────────────────────────────────── */

describe('objectui#7997 — the JSON face refuses `related` by name', () => {
  const authored = {
    type: 'detail-view',
    related: [{ title: 'Contacts', type: 'table', api: 'contact', columns: ['name'] }],
  };

  it('a document authoring `related` is refused', () => {
    // It parsed GREEN before this card. That is the accept-set change the
    // changeset declares.
    expect(DetailViewZodMirror.safeParse(authored).success).toBe(false);
  });

  it('the issue is addressed to `related` and names the surviving entry', () => {
    // A refusal an author cannot act on is half a refusal. `retirementTombstone`
    // feeds ONE guidance string into both the parse-time message and
    // `.describe()`, so what the author reads and what generated docs publish
    // cannot drift apart.
    const r = DetailViewZodMirror.safeParse(authored);
    expect(r.success).toBe(false);
    if (r.success) return;
    const issue = r.error.issues.find((i) => i.path[0] === 'related');
    expect(issue, 'no issue was addressed to `related`').toBeDefined();
    expect(issue!.message).toContain('record:related_list');
    expect(issue!.message).toContain('objectui#7997');
  });

  it('CONTROL — the same document parses green with `related` removed', () => {
    // Says the refusal above is about this member and not about the fixture.
    const { related: _dropped, ...withoutRelated } = authored;
    expect(DetailViewZodMirror.safeParse(withoutRelated).success).toBe(true);
  });

  it('CONTROL — the mirror still refuses a genuinely malformed node', () => {
    // And says the green above is a reading, not a mirror that accepts
    // anything: `type` is a literal.
    expect(DetailViewZodMirror.safeParse({ type: 'not-a-detail-view' }).success).toBe(false);
  });
});

/* ── (c) why it had to be a refusal — the passthrough, MEASURED ───────────── */

describe('objectui#7997 — a bare delete would have KEPT the key, not refused it', () => {
  it('an UNDECLARED sibling key survives the same parse untouched', () => {
    // THE LOAD-BEARING ROW of this file. The claim "deleting the member would
    // not have refused it" is otherwise unfalsifiable prose. Here it is a
    // reading taken on this very schema: `relatedPanels` is declared nowhere,
    // and it comes back out of a successful parse with its value intact.
    // That is exactly what `related` would have done had it simply been
    // deleted — silently accepted, silently ignored, no diagnostic anywhere.
    const r = DetailViewZodMirror.safeParse({
      type: 'detail-view',
      relatedPanels: [{ title: 'Contacts' }],
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect((r.data as Record<string, unknown>).relatedPanels).toEqual([{ title: 'Contacts' }]);
  });

  it('and the retired key does NOT survive it — the pair is the whole argument', () => {
    // The same parse, one key swapped. Undeclared: kept. Tombstoned: refused.
    expect(
      DetailViewZodMirror.safeParse({ type: 'detail-view', related: [{ title: 'Contacts' }] })
        .success,
    ).toBe(false);
  });
});

/* ── (d) the survivor — retiring a DOOR, not the capability ───────────────── */

describe('objectui#7997 — `record:related_list` is untouched and is the declared entry', () => {
  it('its `columns` is still the protocol shape: an array of field-name strings', () => {
    // `@objectstack/spec` declares `RecordRelatedListProps.columns` as
    // `z.array(z.string())`. This face already mirrored it before the card and
    // is deliberately unchanged by it — pinned so "we retired related lists" can
    // never become a true description of this change.
    const _specShape: Eq<RecordRelatedListComponentProps['columns'], string[] | undefined> = true;
    expect(_specShape).toBe(true);
  });

  it('the surviving entry still accepts the columns an author would have written', () => {
    const block: RecordRelatedListComponentProps = {
      objectName: 'contact',
      relationshipField: 'account',
      columns: ['name', 'email'],
      title: 'Contacts',
    };
    expect(block.columns).toEqual(['name', 'email']);
  });
});
