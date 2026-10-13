---
'@objectstack/spec': minor
---

feat(spec)!: a page action row's `onSuccess` is `ActionSchema`'s own post-success block, so its `navigate` is judged by the url scheme set, and the row's executor key refuses `'navigation'`, the runner's alias of `'url'`

Clause-②: no (narrowing)

<!-- adr-0087: registered ui-page-action-row-on-success-shape-closed, ui-page-action-row-navigation-executor-refused -->

**BREAKING**: an accept-set narrowing on two keys of four published page component rows, shipped as `minor` under the launch-window convention for accept-set narrowings.

The page action rows are `action:button` and `action:icon` (`properties`), and each member of an `action:group` or `action:menu` (`properties.actions[]`). Each forwards its action keys to the console's action runner. Two of those keys still let a row carry a target the runner refuses at the click:

- **`onSuccess`** was any value (`z.unknown()`). The runner reads only `ActionSchema`'s post-success block, `{ navigate, openIn }`, and classifies `navigate` with the url scheme set. So `onSuccess: { navigate: 'javascript:alert(1)' }` parsed clean, and so did a misspelled key or a callback shape, which the runner gives no reading at all. The rows now hold `ActionSchema.onSuccess`'s own block, the same instance by reference, so a row's verdict on any `onSuccess` value is the action's: the scheme set on `navigate`, the rename prescriptions for `url` / `redirectUrl` / `to` / `route` / `path` / `target` / `navigateTo` / `href`, and the closed `openIn` with its `'self'` default.
- **The executor key** (`actionType` on a node, `type` on a member) is a free string, and the rows judged a url `target` only when it read `'url'`. The runner also dispatches `'navigation'`, its local alias of `'url'`, to the same navigator, so `actionType: 'navigation'` with `target: 'javascript:…'` parsed clean. The url executor now has one spelling on the rows: `'navigation'` is refused at the executor key, with the rename onto `'url'`. The key otherwise stays open: a handler a host registers under another name (`navigate_create`, `navigate_edit`, …) is still dispatched by name.

A page's `properties` bag is outside the stack parse. `os validate` judges it through its props gate, which parses the bag against these same rows, so it reports each refusal at the row's own path with the same text, as a `component-props-invalid` finding (an error, like every finding of that gate). A stored page still saves and loads.

### FROM → TO

| before | what to write instead |
| --- | --- |
| `onSuccess: { navigate: 'javascript:…' }` (or `data:`, `tel:`, any other scheme) | an `https://` page or an in-app route, or drop the `onSuccess` — no hop runs a script or renders content |
| `onSuccess: { navigate: '//cdn.example.com/x' }` | `'https://cdn.example.com/x'`, or `'/x'` for an in-app path |
| `onSuccess: { navigate: 'tasks/${result.id}' }` (a bare relative template) | the rooted route, `'/tasks/${result.id}'`, or a `./` path |
| `onSuccess: { navigate: '' }`, or `onSuccess: {}` | the address the hop was meant to open, or drop the `onSuccess` |
| `onSuccess: { url: '/x' }` (or `redirectUrl`, `to`, `route`, `path`, `target`, `navigateTo`, `href`) | `onSuccess: { navigate: '/x' }` |
| `onSuccess: { navigate: '/x', openIn: 'new-tab' }` | `openIn: 'newTab'` — the block's spelling, not the top-level url switch's |
| `onSuccess: { type: 'notify', … }`, an array of callbacks, or a bare string | drop it: the runner reads only the navigation block, so these never ran |
| `actionType: 'navigation'` on an `action:button` / `action:icon` | `actionType: 'url'`, with the same `target` and `openIn` — `os migrate meta --write` rewrites it, and a stored row is rewritten when it is read |
| `type: 'navigation'` on an `action:group` / `action:menu` member | `type: 'url'`, with the same `target` and `openIn` — `os migrate meta --write` rewrites it, and a stored row is rewritten when it is read |

**The one-line fix: give every page action row's `onSuccess` the action's block, `{ navigate, openIn? }`, with a `navigate` that is an `http(s)://` URL, a `mailto:` address, an in-app path that starts with `/` or `./`, or a template that opens with `${` — and spell the url executor `'url'`.** The rename from `'navigation'` is lossless on a row: the runner sends both spellings to one navigator, and the alias's own keys (`to`, `redirect`, `external`, `newTab`, `replace`) are not row keys. The executor rename is mechanical: `os migrate meta --from 17 --write` performs it through the ADR-0087 D2 conversion `page-action-row-navigation-executor-to-url`, which is retired from the load path, so an author meets the refusal while stored rows and migrated sources are rewritten. It lists the D3 entries `ui-page-action-row-navigation-executor-refused` (which names that conversion) and `ui-page-action-row-on-success-shape-closed`. An `onSuccess` rewrite stays by hand, because which address a refused `navigate` meant is the author's call.

**What an author now sees.** `os validate`'s props gate reports a refused `navigate` at `properties.onSuccess.navigate` (or `properties.actions.N.onSuccess.navigate` for a member) with the action's own refusal: ``An action's `onSuccess.navigate` opens with `javascript:`, a scheme a url target never opens.``, followed by the reason and the admitted set. The alias is reported at `properties.actionType` (or `properties.actions.N.type`): ``An `action:button`'s `actionType: 'navigation'` is the console runner's local alias of `'url'`, and the url executor has one spelling.``, followed by the rename. A row's parsed `onSuccess` now carries `openIn: 'self'` when it was omitted, as an action's does; the runner reads an omitted `openIn` the same way.

**Measured producers: none refused.** No page action row in this repository or in objectui (at its pin `1fb1ced3`) writes an `onSuccess` outside the block or the executor `'navigation'`. objectui's row tests write `{ navigate: '/app/records/${result.id}' }`, admitted, and every `type: 'navigation'` there is an `element:button` inline action or a runner test, not a page action row. Host-registered executor names are kept: this package's own released guidance prescribes `actionType: 'navigate_edit'` on an `action:button`.
