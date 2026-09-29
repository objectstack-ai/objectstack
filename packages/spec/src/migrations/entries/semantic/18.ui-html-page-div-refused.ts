// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #20592 — the D3 record of the accept-set narrowing the CLI's JSX page gate
// takes on when its console-manifest fallback becomes reachable (#19922): a
// project with no `sdui.manifest.json` of its own has its `kind:'html'` pages
// checked against the manifest `@objectstack/console` ships, which does not
// declare `div`. The vocabulary is ruling A on #20112 (record 5852014527): an
// html page may author the intrinsic tags its renderer registers, the published
// manifest declares that set, and `div` stays deprecated in favour of `box` —
// the console's own html compile refuses it too since objectui#10808. No D2
// conversion and no tombstone: the tag sits inside an authored JSX string, which
// no conversion rewrites and no schema key can tombstone, so this entry is the
// migration channel beside the changeset's FROM → TO table.
export const entry: SemanticMigration = {
  id: 'ui-html-page-div-refused',
  // No backticks and no pipes in `surface` — build-upgrade-guide.ts renders it
  // inside a code span.
  surface:
    "kind:'html' page source (and its deprecated kind:'jsx' alias) in a project with no "
    + 'sdui.manifest.json of its own — the div tag, and any other tag or prop the SDUI '
    + 'component manifest shipped in @objectstack/console does not declare',
  replacement:
    '`box` for a plain wrapper — the one drop-in swap: the same element, your `className` '
    + 'verbatim, the same children, and no layout of its own. Reach for `card`, `flex`, '
    + '`container`, `stack` or `grid` only where you want their layout. For any other tag or '
    + 'prop the command names, a component and prop the manifest declares; the file is '
    + '`dist/sdui.manifest.json` inside `@objectstack/console`.',
  reason:
    'An html page\'s source is a JSX string, not a keyed document: `objectstack migrate meta` '
    + 'rewrites stored metadata by key and cannot rewrite a tag inside authored source, so the '
    + 'move is by hand, and which wrapper keeps a page\'s layout is the author\'s call. '
    + '`objectstack validate`, `objectstack compile` (which `dev` and `start` run first) and '
    + '`objectstack lint` check that source against an SDUI component manifest: the '
    + '`sdui.manifest.json` in the directory the command runs in, then the copy '
    + '`@objectstack/console` ships. The second lookup asked for a file the console package '
    + 'does not export, so it always failed, and a project without its own manifest had its '
    + 'html pages checked at parse level only — syntax and structure, never which components '
    + 'and props they use. It now reaches the shipped copy. That manifest declares the html '
    + 'tier\'s intrinsic tags but not `div`: the maintainer ruled (2026-09-27) that an html page '
    + 'may author the intrinsic tags its renderer registers and that the published manifest '
    + 'declares that set, while `div` stays deprecated in favour of `box`, and the console\'s '
    + 'own html-page compile refuses `div` the same way. A `div` in such a page, which used to '
    + 'pass unchecked, now fails the command with `jsx-forbidden-tag` and '
    + '`jsx-unknown-component`. A project that keeps its own `sdui.manifest.json` is checked '
    + 'against that file, as before.',
  acceptanceCriteria:
    '`objectstack validate` reports no `jsx-forbidden-tag`, `jsx-unknown-component` or '
    + '`jsx-unknown-prop` finding on any `kind:\'html\'` page and prints no '
    + '`sdui/jsx-parse-level-only` notice — that notice means the component check did not run, '
    + 'so a clean result beside it proves nothing; `objectstack compile` and `objectstack lint` '
    + 'agree. No html page source authors `div`, and in the console each rewritten page renders '
    + 'with no compile error. The platform\'s own reference is the showcase app\'s three html '
    + 'pages, which author their wrappers as `box` and pass with zero findings.',
};
