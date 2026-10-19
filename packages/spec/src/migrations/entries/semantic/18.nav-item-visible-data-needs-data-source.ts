// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The D3 entry for the navigation `visible` / `dataSource` narrowing (#24450,
// question 2 of the #24332 ruling, letter A). It narrows a navigation entry's
// accept set; no key is removed, so there is no tombstone and no
// RETIRED_KEYS_BY_MAJOR row. There is no D2 conversion either: which endpoint
// an entry was meant to read is the author's decision, and dropping the read
// would change what the gate means.
export const entry: SemanticMigration = {
  id: 'nav-item-visible-data-needs-data-source',
  // No backticks and no pipes in `surface` — build-upgrade-guide.ts renders it
  // inside a code span.
  surface:
    'A navigation entry whose visible predicate (CEL) reads the top-level data root while the same entry '
    + 'declares no dataSource. Judged at every navigation door: app navigation, app areas navigation, the '
    + 'children of any entry at any depth, and a navigation contribution items list.',
  replacement:
    'Declare a `dataSource` on that entry (`{ provider: \'api\', read: { url }, path? }`, the page element\'s '
    + 'API binding), whose selected value the entry\'s `visible` reads as `data`; or drop the `data.*` read and '
    + 'gate the entry on the ambient roots (`current_user`, `features`) instead. A group\'s `dataSource` is not '
    + 'published to its children, so a child that reads `data` declares its own.',
  reason:
    'Declared means enforced (ADR-0049, the enforce arm). In a navigation predicate, `data` is the value the '
    + 'entry\'s own `dataSource` binds, and nothing else puts a `data` root in its scope: the console shell\'s '
    + 'ambient roots are `current_user`, `user`, `ctx.user`, `os.user` and `features`. An entry that reads '
    + '`data` without declaring a source therefore has nothing to read; before this change it parsed, passed '
    + '`os validate` and shipped as an entry the console never shows, with the author told nothing at '
    + 'authoring time. Now refused at the entry\'s own `visible`, with the fix in the message. Ships at once, '
    + 'no grace window and no dual spelling. Not convertible: only the author knows which endpoint the entry '
    + 'was meant to read.',
  acceptanceCriteria:
    'WHICH DOOR: the spec schema\'s refusal on `NavigationItemSchema`, so it lands wherever an app or a '
    + 'navigation contribution is parsed through `@objectstack/spec` (`defineApp`, `defineStack`, '
    + '`os validate` / `os build`, and the metadata write door), as one `custom` issue at the entry\'s '
    + '`visible`. The reader is a CEL lexer that refuses only a certain root read: `data` as a member name, '
    + 'inside a string or a comment, or bound by a comprehension macro is not one. Fix each such entry by '
    + 'declaring its `dataSource`, or by gating it on another root. An entry that declares a `dataSource`, and '
    + 'an entry whose `visible` reads only `current_user` or `features`, parses byte-identically to before. '
    + 'Census at the time of the change: no navigation entry in this repository reads `data` without a '
    + '`dataSource`; the two that read `data` are spec tests that declare one.',
};
