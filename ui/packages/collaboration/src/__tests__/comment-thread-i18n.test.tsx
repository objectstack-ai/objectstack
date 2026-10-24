/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `CommentThread` speaks the session language — objectstack#5506 / objectui#3424.
 *
 * The whole package shipped its copy as English literals, so a `zh` console
 * rendered a Chinese shell around an English comment thread: "3 comments",
 * "Reply", "Resolve", "just now", "Add a comment... (use @ to mention)".
 *
 * ── Directions: predicted first, then corrected by the run ────────────────
 * Reverting `CommentThread.tsx` to `origin/main` and keeping this file turns
 * all 13 `zh` / `de` / `ja` cases RED and leaves all 4 `en` cases GREEN.
 *
 * The `en` cases being green on BOTH sides is the point, not a gap: the
 * English copy must survive the move into the locale packs, and a case that
 * flipped would mean the copy changed under us.
 *
 * One prediction was WRONG and is recorded here rather than quietly dropped.
 * The `en` singular case (`1 comment`) was expected to be red-before, on the
 * assumption that the header glued a bare `s` on with no singular branch —
 * the way `page:tabs`' count badge did in objectstack#5506's earlier half
 * (objectui#3423), where a one-row list announced "1 items". It does not:
 * `origin/main` reads `` `${n} comment${n !== 1 ? 's' : ''}` `` and the
 * reaction tooltip reads `n === 1 ? '1 reaction' : …`, so both already
 * produced correct English. The defect they carry is different — the plural
 * RULE is compiled into the component, so no locale can apply its own (ru
 * needs three forms, ja needs none, and neither could ever be expressed).
 * The `de` case above is what actually pins that, and the `en` singular cases
 * stay as green-both-sides copy pins.
 *
 * The provider-less English fallback is asserted in
 * `comment-thread-no-provider-fallback.test.tsx` and cannot live here — see
 * that file's header for the react-i18next global-instance reason.
 */

import type { ComponentProps } from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { CommentThread, type Comment } from '../CommentThread';

const alice = { id: 'u_alice', name: 'Alice Chen' };
const bob = { id: 'u_bob', name: 'Bob Ito' };

/** Ages chosen to land squarely inside each bucket, never on a boundary. */
const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();

const baseComments: Comment[] = [
  {
    id: 'c1',
    author: alice,
    content: 'First pass looks good.',
    mentions: [],
    createdAt: minutesAgo(0),
  },
  {
    id: 'c2',
    author: bob,
    content: 'Agreed.',
    mentions: [],
    createdAt: minutesAgo(5),
    updatedAt: minutesAgo(4),
    reactions: { '👍': [alice.id, bob.id], '❤️': [alice.id] },
  },
];

function renderThread(
  language: string,
  overrides: Partial<ComponentProps<typeof CommentThread>> = {},
) {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      <CommentThread
        threadId="t_1"
        comments={baseComments}
        currentUser={alice}
        onAddComment={() => {}}
        onEditComment={() => {}}
        onDeleteComment={() => {}}
        onResolve={() => {}}
        onReaction={() => {}}
        {...overrides}
      />
    </I18nProvider>,
  );
}

afterEach(() => cleanup());

describe('CommentThread header (objectstack#5506)', () => {
  it('counts, sorts and resolves in English under an en session', () => {
    renderThread('en');

    expect(screen.getByText('2 comments')).toBeTruthy();
    expect(screen.getByLabelText('Sort comments')).toBeTruthy();
    expect(screen.getByText('Oldest')).toBeTruthy();
    expect(screen.getByText('Newest')).toBeTruthy();
    expect(screen.getByText('Resolve')).toBeTruthy();
  });

  it('counts, sorts and resolves in Chinese under a zh session', () => {
    renderThread('zh');

    expect(screen.getByText('2 条评论')).toBeTruthy();
    expect(screen.getByLabelText('评论排序')).toBeTruthy();
    expect(screen.getByText('最早优先')).toBeTruthy();
    expect(screen.getByText('最新优先')).toBeTruthy();
    expect(screen.getByText('标记已解决')).toBeTruthy();
    // The English literals are gone, not merely shadowed.
    expect(screen.queryByText('2 comments')).toBeNull();
    expect(screen.queryByLabelText('Sort comments')).toBeNull();
  });

  it('appends the resolved marker in the session language', () => {
    renderThread('zh', { resolved: true });

    expect(screen.getByText('2 条评论 · 已解决')).toBeTruthy();
    // Resolved threads offer "reopen", not "resolve".
    expect(screen.getByText('重新打开')).toBeTruthy();
  });

  /**
   * German is the load-bearing plural case: unlike zh it HAS a distinct
   * singular, so a collapsed one-key scheme would show up right here.
   */
  it('splits singular and plural under a de session', () => {
    renderThread('de', { comments: [baseComments[0]] });
    expect(screen.getByText('1 Kommentar')).toBeTruthy();
    cleanup();

    renderThread('de');
    expect(screen.getByText('2 Kommentare')).toBeTruthy();
  });

  /**
   * Green on both sides — a copy pin, not a demonstration of the bug. See the
   * file header: `origin/main` did have a singular branch here, contrary to
   * the prediction this test was first written under.
   */
  it('has a real English singular for a one-comment thread', () => {
    renderThread('en', { comments: [baseComments[0]] });

    expect(screen.getByText('1 comment')).toBeTruthy();
    expect(screen.queryByText('1 comments')).toBeNull();
  });
});

describe('CommentThread relative timestamps (objectstack#5506)', () => {
  it('reads English relative ages under an en session', () => {
    renderThread('en', {
      comments: [
        { ...baseComments[0], id: 'a', createdAt: minutesAgo(0) },
        { ...baseComments[0], id: 'b', createdAt: minutesAgo(7) },
        { ...baseComments[0], id: 'c', createdAt: minutesAgo(3 * 60) },
        { ...baseComments[0], id: 'd', createdAt: minutesAgo(2 * 24 * 60) },
      ],
    });

    expect(screen.getByText('just now')).toBeTruthy();
    expect(screen.getByText('7m ago')).toBeTruthy();
    expect(screen.getByText('3h ago')).toBeTruthy();
    expect(screen.getByText('2d ago')).toBeTruthy();
  });

  it('reads Chinese relative ages under a zh session', () => {
    renderThread('zh', {
      comments: [
        { ...baseComments[0], id: 'a', createdAt: minutesAgo(0) },
        { ...baseComments[0], id: 'b', createdAt: minutesAgo(7) },
        { ...baseComments[0], id: 'c', createdAt: minutesAgo(3 * 60) },
        { ...baseComments[0], id: 'd', createdAt: minutesAgo(2 * 24 * 60) },
      ],
    });

    expect(screen.getByText('刚刚')).toBeTruthy();
    expect(screen.getByText('7 分钟前')).toBeTruthy();
    expect(screen.getByText('3 小时前')).toBeTruthy();
    expect(screen.getByText('2 天前')).toBeTruthy();
    expect(screen.queryByText('just now')).toBeNull();
    expect(screen.queryByText('7m ago')).toBeNull();
  });

  it('marks an edited comment in the session language', () => {
    renderThread('ja');
    expect(screen.getByText('(編集済み)')).toBeTruthy();
    expect(screen.queryByText('(edited)')).toBeNull();
  });
});

describe('CommentThread reaction tooltip (objectstack#5506)', () => {
  /**
   * The tooltip gets its OWN key pair. `detail.reactionCount` interpolates an
   * `{{emoji}}`, and here the emoji is the chip's visible label with nothing to
   * hand that placeholder — reuse would leave a literal `{{emoji}}` in the
   * accessible name. These assertions are what pins that.
   */
  it('names reaction chips in English, with singular and plural', () => {
    renderThread('en');

    expect(screen.getByTitle('2 reactions')).toBeTruthy();
    expect(screen.getByTitle('1 reaction')).toBeTruthy();
    expect(screen.getByTitle('Add thumbs up')).toBeTruthy();
  });

  it('names reaction chips in the session language', () => {
    renderThread('zh');

    expect(screen.getByTitle('2 个回应')).toBeTruthy();
    expect(screen.getByTitle('点赞')).toBeTruthy();
    expect(screen.queryByTitle('2 reactions')).toBeNull();
    expect(screen.queryByTitle('Add thumbs up')).toBeNull();
  });

  it('never leaks an unresolved placeholder into the tooltip', () => {
    renderThread('de');

    const tooltips = Array.from(document.querySelectorAll('[title]')).map((n) =>
      n.getAttribute('title'),
    );
    expect(tooltips).toContain('2 Reaktionen');
    expect(tooltips).toContain('1 Reaktion');
    // The bug reuse of `detail.reactionCount` would have produced.
    expect(tooltips.some((v) => v?.includes('{{'))).toBe(false);
  });
});

describe('CommentThread per-comment actions (objectstack#5506)', () => {
  it('labels reply / edit / delete in the session language', () => {
    renderThread('zh');

    expect(screen.getAllByText('回复').length).toBeGreaterThan(0);
    expect(screen.getAllByText('编辑').length).toBeGreaterThan(0);
    expect(screen.getAllByText('删除').length).toBeGreaterThan(0);
    expect(screen.queryByText('Reply')).toBeNull();
    expect(screen.queryByText('Delete')).toBeNull();
  });

  it('labels the inline editor save / cancel in the session language', () => {
    renderThread('zh');

    // Only the current user's own comment offers Edit; c1 is Alice's.
    fireEvent.click(screen.getAllByText('编辑')[0]);

    expect(screen.getByText('保存')).toBeTruthy();
    expect(screen.getByText('取消')).toBeTruthy();
    expect(screen.queryByText('Save')).toBeNull();
    expect(screen.queryByText('Cancel')).toBeNull();
  });

  it('translates the reply banner, interpolating the author name', () => {
    renderThread('zh');

    fireEvent.click(screen.getAllByText('回复')[0]);

    expect(screen.getByText('正在回复 Alice Chen…')).toBeTruthy();
    expect(screen.queryByText('Replying to Alice Chen…')).toBeNull();
  });

  /**
   * The no-author half of the banner: the comment being replied to is gone
   * (deleted by someone else mid-reply — the collaboration case this package
   * exists for), so there is no `{{name}}` to interpolate and a separate whole
   * sentence is used instead of substituting a noun.
   */
  it('translates the reply banner when the target comment vanished', () => {
    const { rerender } = renderThread('zh');

    fireEvent.click(screen.getAllByText('回复')[0]);
    rerender(
      <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }}>
        <CommentThread
          threadId="t_1"
          comments={[]}
          currentUser={alice}
          onAddComment={() => {}}
          onEditComment={() => {}}
          onDeleteComment={() => {}}
          onResolve={() => {}}
          onReaction={() => {}}
        />
      </I18nProvider>,
    );

    expect(screen.getByText('正在回复该评论…')).toBeTruthy();
    expect(screen.queryByText('Replying to comment…')).toBeNull();
  });
});

/**
 * objectui#3441 / #3478 — the four glyph-only controls objectstack#5506 left
 * unnamed: the quick 👍, the quick ❤️, the reply-banner ✕ (all #3441) and the
 * reaction-bar `+` picker (#3478).
 *
 * These assert the computed ACCESSIBLE NAME (`getByRole('button', { name })`,
 * which runs dom-accessibility-api's accname implementation), not the presence
 * of an attribute. That distinction is the whole point of the fix: for a
 * `button`, name-from-content (accname §2F) is consulted BEFORE the `title`
 * tooltip (§2I), so a `title` hung on `'👍'` — or on `'+'`, which is what the
 * picker had until #3478 — leaves the computed name as the glyph. Of the three
 * things that can name a `button` here, `aria-label` is the only one that
 * outranks content.
 *
 * ── Direction ─────────────────────────────────────────────────────────────
 * RED before / GREEN after in EVERY language, `en` included — unlike the
 * copy-pin cases above, these names did not exist in any locale on
 * `origin/main`, so there is no "English was already right" half here. The
 * `queryAllByRole(… { name: '👍' })` / `{ name: '+' }` assertions are the
 * mirror image: they pass ONLY after the fix, because the glyph was the name
 * until `aria-label` displaced it.
 *
 * The one deliberate exception is the picker's `getByTitle` assertion, green on
 * both sides: `+` keeps its tooltip as well as gaining a name. It is the only
 * control here that legitimately carries both — a sighted mouse user gets the
 * hover hint the glyph cannot give them either.
 */
describe('CommentThread glyph-only control names (objectui#3441, #3478)', () => {
  it('names the two quick-reaction buttons in English', () => {
    renderThread('en');

    expect(screen.getAllByRole('button', { name: 'React with thumbs up' }).length).toBe(2);
    expect(screen.getAllByRole('button', { name: 'React with heart' }).length).toBe(2);
  });

  it('names the two quick-reaction buttons in the session language', () => {
    renderThread('zh');

    expect(screen.getAllByRole('button', { name: '以点赞回应' }).length).toBe(2);
    expect(screen.getAllByRole('button', { name: '以爱心回应' }).length).toBe(2);
    expect(screen.queryAllByRole('button', { name: 'React with thumbs up' })).toHaveLength(0);
  });

  it('names them in German too, so the keys are really in the packs', () => {
    renderThread('de');

    expect(screen.getAllByRole('button', { name: 'Mit Daumen hoch reagieren' }).length).toBe(2);
    expect(screen.getAllByRole('button', { name: 'Mit Herz reagieren' }).length).toBe(2);
  });

  /**
   * The bug itself: with no `aria-label`, the button's only content IS its
   * name. A screen reader announced "thumbs up button" / "red heart button" —
   * the emoji's Unicode name, in English, whatever the session language.
   */
  it('no longer leaves a button whose accessible name is the bare emoji', () => {
    renderThread('zh');

    expect(screen.queryAllByRole('button', { name: '👍' })).toHaveLength(0);
    expect(screen.queryAllByRole('button', { name: '❤️' })).toHaveLength(0);
  });

  /**
   * `cancelReply`, not the generic `common.cancel`: an accessible name has to
   * say WHAT is being cancelled. Only the reply target is dropped — anything
   * already typed into the composer survives.
   */
  it('names the reply-banner dismiss button in the session language', () => {
    renderThread('zh');

    // The banner only exists once a reply target is picked.
    fireEvent.click(screen.getAllByText('回复')[0]);

    expect(screen.getByRole('button', { name: '取消回复' })).toBeTruthy();
    // U+2715 MULTIPLICATION X — a math symbol with no reliable spoken name.
    expect(screen.queryAllByRole('button', { name: '✕' })).toHaveLength(0);
  });

  it('names the reply-banner dismiss button in English', () => {
    renderThread('en');

    fireEvent.click(screen.getAllByText('Reply')[0]);

    expect(screen.getByRole('button', { name: 'Cancel reply' })).toBeTruthy();
  });

  /**
   * objectui#3478 — the `+` reaction picker, the fourth glyph-only control
   * (`+` is not an emoji, but accname does not care), and the one objectui#3441
   * left behind.
   *
   * Its content is the literal `'+'`, so accname §2F named it "plus" and the
   * `title` at §2I never got a turn — `collaboration.addThumbsUp` reached the
   * tooltip and nothing else. #3441's own pin is what recorded this: it
   * asserted `getByTitle('Add thumbs up')` AND
   * `queryAllByRole('button', { name: 'Add thumbs up' })).toHaveLength(0)` in
   * the same case, two simultaneously-green assertions that say in so many
   * words "the title is set and it is not the name". The docblock read them as
   * pinning the picker APART from the quick 👍; they were also, unread, the
   * bug report. This case now pins the fixed state: `aria-label` names it,
   * `title` still shows it, and the two keys stay distinct.
   *
   * ── Direction ─────────────────────────────────────────────────────────────
   * RED before / GREEN after, twice over: the `name: 'Add thumbs up'` lookup
   * finds 0 buttons on `origin/main` (it was `toHaveLength(0)` there), and the
   * `name: '+'` lookup finds 1 — the glyph IS the name until `aria-label`
   * displaces it. The `getByTitle` and `React with thumbs up` assertions are
   * green on both sides on purpose: the tooltip must survive the fix (the
   * picker is the one control here that legitimately has both), and the two
   * controls must stay under two names.
   */
  it('names the reaction-bar picker and keeps its tooltip', () => {
    renderThread('en');

    // Tooltip survives — green on both sides.
    expect(screen.getByTitle('Add thumbs up')).toBeTruthy();
    // …and is now ALSO the accessible name. Exactly one picker: it renders
    // only on a comment that already has reactions, i.e. `c2`.
    expect(screen.getAllByRole('button', { name: 'Add thumbs up' }).length).toBe(1);
    // The bug, mirrored: `'+'` was the computed name on origin/main.
    expect(screen.queryAllByRole('button', { name: '+' })).toHaveLength(0);
    // Still two names for two controls — #3441's separation is not undone.
    expect(screen.getAllByRole('button', { name: 'React with thumbs up' }).length).toBe(2);
  });

  /**
   * The same control in the session language. `addThumbsUp` is already in every
   * locale pack (objectstack#5506 shipped it for the tooltip), so this needed
   * no new key — only a call site that lets a screen reader reach it.
   */
  it('names the reaction-bar picker in the session language', () => {
    renderThread('zh');

    expect(screen.getByRole('button', { name: '点赞' })).toBeTruthy();
    expect(screen.getByTitle('点赞')).toBeTruthy();
    expect(screen.queryAllByRole('button', { name: '+' })).toHaveLength(0);
    expect(screen.queryAllByRole('button', { name: 'Add thumbs up' })).toHaveLength(0);
  });
});

/**
 * objectui#3441, part two — the >= 7d bucket follows the SESSION language.
 *
 * `formatTimestamp`'s last branch called `toLocaleDateString()` with no
 * argument, i.e. the RUNTIME's locale. In a `zh` console a six-day-old comment
 * read "6 天前" and a seven-day-old one read `8/1/2026`.
 *
 * ── Direction ─────────────────────────────────────────────────────────────
 * The `zh` and `de` cases are RED before / GREEN after: on `origin/main` every
 * session renders the same runtime-default string. The `en` case is green on
 * both sides in a runtime whose default locale is already `en-US`, and it is
 * kept as a copy pin, not offered as evidence.
 */
describe('CommentThread absolute timestamps (objectui#3441)', () => {
  const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
  const oldComment: Comment = {
    id: 'old',
    author: alice,
    content: 'From last week.',
    mentions: [],
    createdAt: eightDaysAgo.toISOString(),
  };

  const dateCell = () =>
    Array.from(document.querySelectorAll('[data-comment-id="old"] span'))
      .map((n) => n.textContent)
      .filter((v): v is string => Boolean(v));

  it('formats a week-old comment in the session language', () => {
    renderThread('zh', { comments: [oldComment] });
    expect(dateCell()).toContain(eightDaysAgo.toLocaleDateString('zh'));
    cleanup();

    renderThread('de', { comments: [oldComment] });
    expect(dateCell()).toContain(eightDaysAgo.toLocaleDateString('de'));
  });

  /**
   * Doubles as an ICU-availability assertion: on a runtime built without the
   * full locale data every tag collapses to the same output, and the two
   * assertions above would pass while proving nothing.
   */
  it('produces visibly different strings for zh and de', () => {
    expect(eightDaysAgo.toLocaleDateString('zh')).not.toBe(
      eightDaysAgo.toLocaleDateString('de'),
    );
  });

  it('keeps the English form under an en session', () => {
    renderThread('en', { comments: [oldComment] });
    expect(dateCell()).toContain(eightDaysAgo.toLocaleDateString('en'));
  });

  /**
   * The trap the issue was really about, and the reason objectstack#5506 left
   * this branch alone.
   *
   * `toLocaleDateString(tag)` canonicalizes its argument and throws
   * `RangeError` on anything not well-formed per BCP 47. `'en_US'` — the POSIX
   * spelling, a plausible thing for a host to put in `defaultLanguage` — is
   * exactly such a tag, and the session `language` reaches the component
   * verbatim. Handed straight to `toLocaleDateString`, that `RangeError` lands
   * in `formatTimestamp`'s OUTER catch, whose fallback is `return iso`: the
   * comment's date would have been replaced by a raw
   * `2026-07-29T…Z`, worse than the un-localized date it set out to fix.
   *
   * ── Direction, stated honestly ────────────────────────────────────────────
   * This case is GREEN on BOTH sides of the change, and reverting
   * `CommentThread.tsx` does NOT turn it red — `origin/main` never passed the
   * tag anywhere, so it could not trip over a bad one. Its counterfactual is
   * not the old code but the NAIVE fix, and that is what it was reverse-checked
   * against: dropping the inner try/catch in `formatAbsoluteDate` (passing
   * `language` straight through) turns this case red with the raw ISO string in
   * the DOM. Recorded rather than dressed up as a red-before regression pin.
   */
  it('falls back to the runtime locale on a malformed session tag, never to raw ISO', () => {
    const { container } = renderThread('en_US', { comments: [oldComment] });

    expect(dateCell()).toContain(eightDaysAgo.toLocaleDateString());
    expect(container.textContent).not.toContain(oldComment.createdAt);
    // The shape of the raw value, in case the ISO string is ever reformatted.
    expect(container.textContent).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
    // The rest of the thread still speaks (fallbackLng) English — the guard is
    // local to the date, it does not disable the session.
    expect(screen.getByText('Send')).toBeTruthy();
  });
});

describe('CommentThread composer (objectstack#5506)', () => {
  it('translates the placeholder and the send button', () => {
    renderThread('zh');

    expect(screen.getByPlaceholderText('添加评论…(输入 @ 提及他人)')).toBeTruthy();
    expect(screen.getByText('发送')).toBeTruthy();
    expect(screen.queryByPlaceholderText('Add a comment… (use @ to mention)')).toBeNull();
    expect(screen.queryByText('Send')).toBeNull();
  });

  it('keeps the English copy under an en session', () => {
    renderThread('en');

    expect(screen.getByPlaceholderText('Add a comment… (use @ to mention)')).toBeTruthy();
    expect(screen.getByText('Send')).toBeTruthy();
  });

  it('translates the placeholder for ja too', () => {
    renderThread('ja');

    expect(screen.getByPlaceholderText('コメントを追加…(@ でメンション)')).toBeTruthy();
    expect(screen.getByText('送信')).toBeTruthy();
  });
});
