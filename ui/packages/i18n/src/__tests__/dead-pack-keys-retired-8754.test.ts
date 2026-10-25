// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Twenty-three measured-dead locale keys are retired from all ten packs —
 * two WHOLE families and eleven individual leaves (objectui#8754's deletion
 * round, ruled by the director seat's summon #22 on 2026-09-12).
 *
 * ## Why this pin is NEGATIVE, and why it is needed at all
 *
 * Every i18n gate in this repo runs **call site -> key**, never key -> call site
 * (objectui#4145's mechanism, restated by #4392, #4730, #5504 and #6310):
 *
 *   - `scripts/check-i18n-call-site-keys.mjs` asks whether each call site's key
 *     resolves in `en`. A key with no call site is never visited.
 *   - `all-locales-key-parity.test.ts` compares the ten packs' key SETS to each
 *     other. One dead key present in all ten is exactly what it wants.
 *   - `scripts/check-i18n-en-drift.mjs` only fires when an `en` value CHANGES.
 *   - `scripts/check-i18n-dead-keys.mjs` IS the reverse direction, and it is
 *     report-only by design and wired into no workflow (objectui#4658).
 *
 * So any retired row can return to all ten packs with every gate green. This
 * file is the only thing watching that direction for this batch.
 *
 * ## The admission criterion was a measurement, not this card's body
 *
 * The card that ordered this deletion named 25 keys. That number was not the
 * input: the director's ruling is "instrument first, deletion second", and the
 * instrument round (objectui#9222, `c4a1d39fe9`) landed first precisely so the
 * deletion could be admitted by a re-run rather than by memory. Re-run on the
 * deletion's own base, `check:i18n-dead-keys` reported 119 CONFIRMED / 239
 * NEEDS-REVIEW over 3010 pack keys, and the card's population re-measured to
 * **23**, not 25 — the card had counted its eleven non-family leaves plus two
 * families of six, double-counting the two leaves that belong to both sets.
 * ⇒ no tier moved under anyone; the card's arithmetic was simply 13 + 6 + 6.
 *
 * ## The unit is the FAMILY, and both families went whole
 *
 * `approvals.*` (6) and `marketplace.pricing.*` (6) are retired as ROOTS, not
 * as leaves — {@link RETIRED_ROOTS} asserts the namespace itself is gone.
 * Retiring half a dead family leaves the other half looking live by contrast,
 * which is the state this card existed to end.
 *
 * Both were whole under the ruling's family rule — every member CONFIRMED, or
 * NEEDS-REVIEW whose only hit is non-liveness. The two NEEDS-REVIEW members had
 * exactly one hit each and both were non-liveness: `approvals.rejectConfirm` in
 * `packages/app-shell/CHANGELOG.md` (changelog prose about a past change) and
 * `marketplace.pricing.freemium` in this directory's
 * `untranslated-identity-4376.test.ts` allowlist (a pin, whose entry this round
 * deleted with the key, on that file's own `workflow.*` precedent).
 *
 * The live surface each family was mistaken for is a DIFFERENT namespace, and
 * {@link SURVIVING} pins it: approvals renders through `approvalsInbox.*`
 * (`RecordApprovalsPanel.tsx`, `DeclaredActionsBar.tsx`, `ApprovalsInboxPage.tsx`),
 * and nothing renders pricing at all — no `marketplace.pricing.` template head
 * exists and the word does not occur in the marketplace UI source.
 *
 * ## The eleven leaves, and the shape they share
 *
 * Each was held out of an earlier sweep by a LONGER live sibling that merely
 * contains it, until PR objectui#8753 put a key-boundary requirement on both
 * sides of the text probe. `sidebar.help` was demoted by `sidebar.helpTooltip`;
 * `form.addItem` by the designer table's `engine.form.addItem`;
 * `workspace.create` — the purest case — by a VS Code API call
 * (`vscode.workspace.createFileSystemWatcher`) that merely contains its
 * characters. {@link SURVIVING} names the sibling that actually renders in each
 * case, so a green here cannot be bought by deleting the neighbourhood.
 *
 * ## ⚠️ Why {@link SURVIVING} names only call-site-live keys
 *
 * Naming a key in this file makes it a TEXTUAL HIT for
 * `check-i18n-dead-keys`, which would demote a CONFIRMED key to NEEDS-REVIEW —
 * the self-pollution trap the sweep's own header records, and the reason this
 * card's body forbids pinning keys by spelling them. A key with a real `t()`
 * call site is immune: it is removed from the candidate set by the AST pass
 * before the text net ever runs.
 *
 * So every key below was checked against the census BEFORE being named here, and
 * the check is not a formality: FIVE of the obvious neighbours failed it — the
 * nearest live-looking sibling in each of the `dashboard`, `form`, `sidebar`,
 * `home` and `workspace` namespaces is itself CONFIRMED-dead today. Naming any
 * of them would have demoted it to NEEDS-REVIEW and corrupted the next round's
 * population, while this file read as diligent.
 *
 * ⚠️ That is not hypothetical here. A first draft of this header spelled those
 * five keys out as a warning, and the post-deletion census came back 93
 * CONFIRMED where the arithmetic said 98 — the five, demoted by the very
 * sentence telling the reader not to do this. The spellings are gone and the
 * shape is described instead; the census then landed on 98 exactly.
 *
 * ⛔ Do not add a key here — in the lists below OR in this prose — without
 * checking its tier first. A key name in a comment is a textual hit.
 */
import { describe, it, expect } from 'vitest';
import { builtInLocales } from '../locales/index';

type LocaleCode = keyof typeof builtInLocales;
const LANGS = Object.keys(builtInLocales) as LocaleCode[];

const at = (pack: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((n, k) => (n as Record<string, unknown> | undefined)?.[k], pack);

/** The two families, retired as whole namespaces. Roots, not leaves. */
const RETIRED_ROOTS = ['approvals', 'marketplace.pricing'] as const;

/** Every retired leaf, named rather than counted — six, six and eleven. */
const RETIRED = [
  // approvals.* — the whole family. The live surface is `approvalsInbox.*`.
  'approvals.approve',
  'approvals.approveSuccess',
  'approvals.comment',
  'approvals.reject',
  'approvals.rejectConfirm',
  'approvals.rejectSuccess',
  // marketplace.pricing.* — the whole family. No pricing consumer exists.
  'marketplace.pricing.contact-sales',
  'marketplace.pricing.free',
  'marketplace.pricing.freemium',
  'marketplace.pricing.paid',
  'marketplace.pricing.subscription',
  'marketplace.pricing.usage-based',
  // Eleven leaves, each demoted pre-objectui#8753 by a longer live sibling.
  'appDesigner.noNavItems',
  'appDesigner.separator',
  'console.objectView.groupBy',
  'console.objectView.toolbar',
  'dashboard.removeWidget',
  'form.addItem',
  'home.recent',
  'home.starred',
  'home.subtitle',
  'sidebar.help',
  'workspace.create',
] as const;

/**
 * The keys the deletion swept AROUND — every one call-site-live, so naming it
 * here cannot move its tier (see the header). These are the FIRING CONTROL on
 * the deletion: they must still resolve in the same run that shows the retired
 * keys gone, or "the keys are retired" is indistinguishable from "the pack
 * reader broke".
 */
const SURVIVING = [
  // The live approvals surface — a different namespace, and the whole reason
  // `approvals.*` read as dead.
  'approvalsInbox.loadMore',
  'approvalsInbox.overrideNotice',
  'approvalsInbox.approverUnstaffed',
  // The live marketplace surface, including the sibling namespace that IS
  // dynamically reached (`marketplace.category.` is a collected template head,
  // which is exactly why none of that family was ever a candidate).
  'marketplace.title',
  'marketplace.load.failed',
  // The longer siblings that actually render, per retired leaf.
  'appDesigner.noNavItemsHint',
  'appDesigner.separatorLabel',
  'console.objectView.configureView',
  'console.objectView.new',
  'console.objectView.save',
  'sidebar.helpTooltip',
  'sidebar.approvals',
  'workspace.createTitle',
  'workspace.createButton',
  'home.recentApps.title',
  'home.starredApps.title',
  'form.noPermissionToSave',
  'form.submitFailed',
  'dashboard.total',
  'dashboard.loading',
] as const;

describe('objectui#8754 — the measured-dead pack keys stay retired', () => {
  it('the pin covers all ten packs and a non-collapsed corpus', () => {
    // Guards the premise every assertion below rests on. A pin that iterates an
    // empty pack list, or asserts absence inside a pack that itself vanished, is
    // green for the wrong reason — which is the single failure mode a negative
    // pin cannot otherwise distinguish from success.
    expect(LANGS).toHaveLength(10);
    expect(RETIRED).toHaveLength(23);
    expect(new Set(RETIRED).size).toBe(23);
    for (const lang of LANGS) {
      const size = Object.keys(builtInLocales[lang] as Record<string, unknown>).length;
      expect(size, `${lang} pack collapsed`).toBeGreaterThan(50);
    }
  });

  it('no pack defines any retired key, in any of the ten packs', () => {
    const revived: string[] = [];
    for (const lang of LANGS) {
      for (const key of RETIRED) {
        if (at(builtInLocales[lang], key) !== undefined) revived.push(`${lang} :: ${key}`);
      }
    }
    // Named, not counted: a half-reverted retirement is repaired pack by pack,
    // and the repair differs per key.
    expect(
      revived,
      'A key retired by objectui#8754 is back in a locale pack. These 23 keys had ' +
        'no reader anywhere in the repo when they were removed — measured by ' +
        '`pnpm check:i18n-dead-keys` after the objectui#9222 instrument repair, not ' +
        'assumed. Do NOT backfill one to satisfy a missing-key report: if a ' +
        'surface needs the string, author the key alongside the screen that ' +
        'renders it.',
    ).toEqual([]);
  });

  it('both families are gone as ROOTS, not merely emptied leaf by leaf', () => {
    // The unit of this retirement is the family. A surviving empty root would
    // leave the namespace looking like a live surface with nothing in it, and
    // would let a translator "restore the missing strings" into a shape that
    // still type-checks.
    const survivingRoots: string[] = [];
    for (const lang of LANGS) {
      for (const root of RETIRED_ROOTS) {
        if (at(builtInLocales[lang], root) !== undefined) survivingRoots.push(`${lang} :: ${root}`);
      }
    }
    expect(survivingRoots).toEqual([]);
  });

  it('the deletion swept around its neighbours — every survivor still resolves', () => {
    // The firing control. Without it, this file's green is equally consistent
    // with the packs having been emptied wholesale.
    const broken: string[] = [];
    for (const lang of LANGS) {
      for (const key of SURVIVING) {
        const value = at(builtInLocales[lang], key);
        if (typeof value !== 'string' || value.trim().length === 0) {
          broken.push(`${lang} :: ${key}`);
        }
      }
    }
    expect(
      broken,
      'A key this retirement was supposed to sweep AROUND is missing or empty. ' +
        'These are the live siblings the retired keys were confused with — losing ' +
        'one ships a raw key name to ten locales.',
    ).toEqual([]);
  });

  it('the surviving siblings are real translations, not ten copies of English', () => {
    // A sample across writing systems, so "all ten packs kept the key" cannot be
    // satisfied by the English string ten times — the same complement
    // `objectView-config-keys-retired-4730.test.ts` carries next door.
    expect(at(builtInLocales.en, 'sidebar.helpTooltip')).toBe('Help & Documentation');
    for (const lang of ['zh', 'ru', 'ar', 'ja'] as const) {
      const value = at(builtInLocales[lang], 'sidebar.helpTooltip');
      expect(typeof value, `${lang} sidebar.helpTooltip`).toBe('string');
      expect(value, `${lang} sidebar.helpTooltip is the English value`).not.toBe(
        at(builtInLocales.en, 'sidebar.helpTooltip'),
      );
    }
  });
});
