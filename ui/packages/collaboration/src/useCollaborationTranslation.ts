/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * i18n entry point for `@object-ui/collaboration` (objectstack#5506, objectui#3424).
 *
 * The package shipped every user-visible string as an English literal, so a
 * `zh` session read a Chinese console with an English comment thread inside it.
 * This is the package's single translation seam: components call
 * {@link useCollaborationTranslation} and never hold a literal.
 *
 * `createSafeTranslation` (the same factory `data-table`, `form` and
 * `filter-builder` use) does two things at once:
 *
 *  1. under an `I18nProvider` it resolves against the session locale, and
 *  2. with **no** provider it resolves against {@link COLLAB_DEFAULT_TRANSLATIONS}.
 *
 * (2) is not a nicety — it is the contract. `CommentThread` is exported for
 * standalone use with no ObjectUI shell around it, and its host may mount no
 * provider at all. Routing a literal through `t()` without a working default
 * would turn every label into a raw dotted key on that path. The defaults map
 * below is therefore the authoritative English copy of this package, and it
 * must stay byte-identical to the `en` locale pack's `collaboration` namespace.
 *
 * Count labels are i18next count families (objectui#11445): the map carries
 * each family's `_one` / `_other` rows exactly as the `en` pack does, and
 * `fallbackT` reads them for a numeric `count` in i18next's own order.
 */
import { createSafeTranslation } from '@object-ui/i18n';

/**
 * English fallback copy for everything this package renders.
 *
 * Four entries are borrowed from the shared `common` namespace rather than
 * duplicated under `collaboration`: `Save` / `Cancel` / `Edit` / `Delete` are
 * the generic action words, already translated in all ten packs, and a second
 * spelling of them would only be a second thing to keep in sync.
 */
export const COLLAB_DEFAULT_TRANSLATIONS: Record<string, string> = {
  // Thread header
  'collaboration.commentCount': '{{count}} comments',
  'collaboration.commentCount_one': '{{count}} comment',
  'collaboration.commentCount_other': '{{count}} comments',
  'collaboration.resolvedSuffix': ' · Resolved',
  'collaboration.sortComments': 'Sort comments',
  'collaboration.sortOldest': 'Oldest',
  'collaboration.sortNewest': 'Newest',
  'collaboration.resolve': 'Resolve',
  'collaboration.reopen': 'Reopen',
  // Relative timestamps. Word-level entries, not a date-formatting layer — the
  // buckets stay exactly where the component already put them and no date
  // library is introduced.
  'collaboration.justNow': 'just now',
  'collaboration.minutesAgo': '{{count}}m ago',
  'collaboration.minutesAgo_one': '{{count}}m ago',
  'collaboration.minutesAgo_other': '{{count}}m ago',
  'collaboration.hoursAgo': '{{count}}h ago',
  'collaboration.hoursAgo_one': '{{count}}h ago',
  'collaboration.hoursAgo_other': '{{count}}h ago',
  'collaboration.daysAgo': '{{count}}d ago',
  'collaboration.daysAgo_one': '{{count}}d ago',
  'collaboration.daysAgo_other': '{{count}}d ago',
  'collaboration.edited': '(edited)',
  // Reactions. A DEDICATED family, deliberately not `detail.reactionCount` —
  // that one interpolates `{{emoji}}` and this tooltip has no emoji to hand it
  // (the emoji is the button's visible content), so reuse would render a
  // stray `{{emoji}}` under every locale.
  'collaboration.reactionCount': '{{count}} reactions',
  'collaboration.reactionCount_one': '{{count}} reaction',
  'collaboration.reactionCount_other': '{{count}} reactions',
  'collaboration.addThumbsUp': 'Add thumbs up',
  // Per-comment actions and the reply banner
  'collaboration.reply': 'Reply',
  // Accessible names for the three emoji-only controls (objectui#3441). For a
  // `button` the accessible name is computed from CONTENT before `title` is
  // consulted, so an emoji button is named by its glyph until an `aria-label`
  // overrides it — these three keys ARE those names, not decoration.
  //
  // `reactThumbsUp` is deliberately distinct from `addThumbsUp` above even
  // though both currently dispatch `onReaction(id, '👍')`: `addThumbsUp` names
  // the reaction-bar `+` picker, and the two render side by side on any comment
  // that already has reactions.
  'collaboration.reactThumbsUp': 'React with thumbs up',
  'collaboration.reactHeart': 'React with heart',
  'collaboration.cancelReply': 'Cancel reply',
  'collaboration.replyingTo': 'Replying to {{name}}…',
  'collaboration.replyingToComment': 'Replying to comment…',
  // Composer
  'collaboration.commentPlaceholder': 'Add a comment… (use @ to mention)',
  'collaboration.send': 'Send',
  // Presence avatar stack (objectui#3440). The group's `aria-label` IS the
  // control for a screen reader — the stack itself is images and initials —
  // so these labels are not decoration.
  'collaboration.presentUserCount': '{{count}} users present',
  'collaboration.presentUserCount_one': '{{count}} user present',
  'collaboration.presentUserCount_other': '{{count}} users present',
  'collaboration.moreUserCount': '{{count}} more users',
  'collaboration.moreUserCount_one': '{{count}} more user',
  'collaboration.moreUserCount_other': '{{count}} more users',
  // Avatar tooltip. The parentheses belong to the translation so a translator
  // owns the whole shape rather than inheriting English-shaped glue.
  'collaboration.userStatusTitle': '{{name}} ({{status}})',
  // Display copy for the `PresenceUser['status']` enum. The enum VALUE stays
  // raw data everywhere else — these three exist only for the tooltip above,
  // and a status outside the union falls back to the raw string.
  'collaboration.statusActive': 'active',
  'collaboration.statusIdle': 'idle',
  'collaboration.statusAway': 'away',
  // Shared action words — see the note above.
  'common.save': 'Save',
  'common.cancel': 'Cancel',
  'common.edit': 'Edit',
  'common.delete': 'Delete',
};

/**
 * Session-locale translation for this package, with the English map above as
 * the no-provider fallback.
 *
 * The probe key must be one this package owns: a shared `common.*` key would
 * also resolve under an unrelated bundle and report "i18n is configured" for a
 * host that never loaded the collaboration namespace.
 */
export const useCollaborationTranslation = createSafeTranslation(
  COLLAB_DEFAULT_TRANSLATIONS,
  'collaboration.commentPlaceholder',
);

/**
 * The translate function `useCollaborationTranslation` hands back.
 *
 * Derived from the hook rather than hand-written so module-level helpers that
 * take `t` as a parameter (see `formatTimestamp`) cannot drift from whichever
 * half of the union — real i18next `t` or the English fallback — is live.
 */
export type CollaborationTranslate = ReturnType<typeof useCollaborationTranslation>['t'];
