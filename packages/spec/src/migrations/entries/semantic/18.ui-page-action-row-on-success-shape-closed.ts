// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'ui-page-action-row-on-success-shape-closed',
  surface: 'the `onSuccess` of a page action row — `properties.onSuccess` on an `action:button` or '
    + '`action:icon`, and `onSuccess` on each `action:group` / `action:menu` member of `properties.actions` — '
    + 'which took any value: a `navigate` the console\'s action runner does not open (`javascript:`, `data:`, '
    + '`tel:` and every other scheme, a protocol-relative `//host`, a bare relative template such as '
    + '`tasks/${result.id}`, the empty string), a misspelled key (`url`, `redirectUrl`, `to`), `openIn: '
    + '\'new-tab\'`, a block with no `navigate`, or a value that is not a navigation block at all (a callback '
    + 'object or array, a bare string)',
  replacement: '`ActionSchema`\'s own post-success block, `{ navigate, openIn? }`: `navigate` is an `http://` or '
    + '`https://` URL, a `mailto:` address, an in-app path that starts with `/` or `./`, or a template that opens '
    + 'with `${` (judged after interpolation, at the hop); `openIn` is `\'self\'` (the default) or `\'newTab\'`. '
    + 'Write `redirectUrl` / `url` / `to` / `route` / `path` / `target` / `navigateTo` / `href` as `navigate` and '
    + '`\'new-tab\'` as `\'newTab\'`; drop an `onSuccess` that navigates nowhere. ⛔ NOT mechanically convertible '
    + 'for a refused `navigate`: a bare `tasks/${result.id}` may mean `/tasks/…` or `./tasks/…`, and a `tel:` or '
    + '`javascript:` hop has no admitted equivalent — the author chooses the address they meant.',
  reason:
    'Every row forwards `onSuccess` to the console\'s action runner whole, and the runner reads exactly '
    + '`ActionSchema`\'s block: a non-array object with a non-empty string `navigate`, interpolated and classified '
    + 'with the url scheme set, opening a new tab only on `openIn: \'newTab\'`. Anything else gets no reading, and '
    + 'a refused `navigate` performs no navigation. The rows declared `z.unknown()`, so all of it parsed clean and '
    + 'did nothing after the action succeeded. The rows now hold the action\'s own block by reference — one shape, '
    + 'and the one url grammar (`navigation-target.ts`). A page\'s `properties` is not parsed on the metadata save '
    + 'or load path, so a stored page still saves and loads; `os validate`\'s props gate parses the bag against the '
    + 'rows and reports a refused value as a `component-props-invalid` finding. No conversion is registered: the '
    + 'authored census finds no row `onSuccess` outside the block in this repository or in objectui (its row tests '
    + 'write `{ navigate: \'/app/records/${result.id}\' }`, admitted). Deployed metadata NOT MEASURED.',
  acceptanceCriteria:
    'Every `action:button` / `action:icon` `properties.onSuccess` and every `action:group` / `action:menu` '
    + 'member `onSuccess` is `{ navigate, openIn? }` with `navigate` in the admitted set and `openIn` `\'self\'` or '
    + '`\'newTab\'`; `os validate` reports no `component-props-invalid` finding at `properties.onSuccess` or '
    + '`properties.actions.N.onSuccess`. Every admitted block parses as it does on an action, `openIn` resolved to '
    + '`\'self\'` when omitted.',
};
