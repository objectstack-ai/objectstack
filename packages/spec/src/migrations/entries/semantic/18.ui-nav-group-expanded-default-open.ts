// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The declared default of `GroupNavItemSchema.expanded` moved from `false` to
// `true` (maintainer ruling 6431302164 on objectstack#26370, letter A). The
// product behaviour was ruled twice before the protocol followed it:
// objectui#13336 (letter A — a group that does not say `expanded: false`
// opens, and the "8 or more children collapse" rule is gone) and
// hotcrm#2194 (letter B). The console's NavigationRenderer already opens an
// undeclared group, so the protocol now states what the console does. A
// default move reaches every silent document with no parse error and nothing
// in the author's diff, so the upgrade path carries it as a TODO: only the
// deployment can say which group that never declared the key was relying on
// starting closed. The same class as `list-view-edit-inline-default-on` and
// `view-pagination-page-size-default-50`: no key is removed, so there is no
// tombstone and no RETIRED_KEYS_BY_MAJOR row, and no D2 conversion exists.
// The citations live here, not in the printed guidance, which carries no
// tracker number.
export const entry: SemanticMigration = {
  id: 'ui-nav-group-expanded-default-open',
  surface: 'ui.GroupNavItem.expanded — an OMITTED expanded on an app navigation group',
  replacement: 'nothing, to take the platform default: the group opens on first view. To keep a '
    + 'group closed until the user opens it — an advanced or developer section the daily user '
    + 'should not see first — write it: `expanded: false`',
  reason:
    'A RULED behaviour change on a default, so there is nothing to rewrite and nothing to '
    + 'refuse: the maintainer ruled that a navigation group which says nothing opens, and the '
    + 'declared default of `GroupNavItemSchema.expanded` moved from `false` to `true`. The console '
    + 'already behaved this way for a group that arrived without the key — its length does not '
    + 'decide, and a group holding the current route opens whatever it declares — so the protocol '
    + 'now states the behaviour instead of contradicting it. What changes is the parsed and served '
    + 'shape: a group parsed through the app schema (`defineStack`, `defineApp`) used to carry a '
    + 'written `expanded: false` that the console honoured as an explicit close, and now carries '
    + '`expanded: true`. A group registered without a parse still arrives without the key and still '
    + 'opens. Not losslessly convertible because the question is intent, not text: a mechanical pass '
    + 'that wrote `expanded: false` into every silent group would preserve the old posture and defeat '
    + 'the ruling, and one that wrote `true` would add nothing the default does not already do. Only '
    + 'the deployment knows which silent groups were meant to start closed. The accept set is '
    + 'unchanged — a boolean — and every authored `expanded` parses exactly as before. A document that '
    + 'serialised an earlier parse (an `os compile` artifact) carries a written `false` and its groups '
    + 'stay closed; recompile it, or delete the key.',
  acceptanceCriteria:
    'A group navigation item that omits `expanded` parses to `expanded: true`, and an app whose '
    + 'navigation holds such a group parses with `navigation[].expanded` true; an authored '
    + '`expanded: false` still parses to `false` and an authored `true` to `true`; a non-boolean is '
    + 'still refused. In the console, a group that declares nothing is open on first view, and a '
    + 'group that declares `expanded: false` is closed unless it holds the current route. Every '
    + 'group that must start closed declares `expanded: false` and shows its children only after the '
    + 'user opens it.',
};
