// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'ui-action-url-target-scheme-set-closed',
  surface: "the `target` of a `type: 'url'` action — on a registered `action` document and on an "
    + 'inline action (`element:button`\'s `action`, including the legacy `type: \'navigation\'` + `to` '
    + 'spelling) — that the console\'s action runner does not open: a scheme other than `http:`, '
    + '`https:` or `mailto:` (`javascript:`, `data:`, `tel:` and every other), `http:` or `https:` '
    + 'without the `//`, a protocol-relative `//host`, `/` followed by a backslash, a tab / line feed '
    + '/ carriage return anywhere, or a bare relative target with no leading `/` or `./`',
  replacement: 'an `http://` or `https://` URL, a `mailto:` address, an in-app path that starts '
    + 'with `/` or `./`, or a template that opens with `${` (judged after interpolation, at the '
    + 'click). ⛔ NOT mechanically convertible: a bare `thanks` may mean `/thanks` or `./thanks`, '
    + '`//cdn.example.com/x` may mean `https:` or an in-app path, and a `tel:` or `javascript:` '
    + 'button has no admitted equivalent at all — the author chooses the address they meant, or '
    + "moves the work to a different action type (a `type: 'script'` handler, a `type: 'api'` call)",
  reason:
    'The key was a free string on every action type, so a url action whose target the runner '
    + 'refuses parsed clean, published, and failed only at the click — the declared-but-not-'
    + 'delivered shape. The runner opens a closed set of targets, and the door now admits exactly '
    + 'that set and refuses the rest at parse, with a per-reason message that names the admitted '
    + 'set. No measured producer writes a refused target: the instrument read every url-action '
    + 'target in this repository and in objectui at its pin and at its main, and found only '
    + 'admitted ones outside tests — so the entry is owed for targets authored outside them.',
  acceptanceCriteria:
    "Every `type: 'url'` action — registered or inline — carries a target that opens with "
    + '`http://`, `https://` or `mailto:` (case-insensitive), starts with `/` (not `//`, not `/` '
    + 'followed by a backslash) or `./`, or opens with `${`; and none holds a tab, line feed or '
    + 'carriage return. Every admitted target parses byte-identically to before, and `target` on '
    + "every other action type is untouched. `os validate` reports nothing at `target` for any "
    + 'url action in the stack.',
};
