---
'@objectstack/spec': minor
---

feat(spec)!: the page action rows' url `target`, a dashboard header action's `actionUrl` and an action's `onSuccess.navigate` declare the closed url scheme set — `http://`, `https://`, `mailto:` and in-app paths — and refuse every other target at parse

Clause-②: no (narrowing)

<!-- adr-0087: registered ui-page-action-row-url-target-scheme-set-closed, ui-dashboard-header-action-url-scheme-set-closed, ui-action-on-success-navigate-scheme-set-closed -->

**BREAKING** — an accept-set narrowing on three published authoring surfaces, shipped as `minor` under the launch-window convention for accept-set narrowings.

All three were free strings, so a target the console's action runner refuses — `javascript:`, `data:`, `tel:`, a protocol-relative `//host`, a bare relative path — parsed clean, published, and failed only at the click or after the action succeeded. A `type: 'url'` action's `target` already closed this set; the scheme set is stated once in the contract and the runtime opens exactly that set, so these doors now apply the same grammar, with no second one:

- **The page action rows' `target`** on the url executor: an `action:button` or `action:icon` with `actionType: 'url'`, and an `action:group` / `action:menu` member with `type: 'url'`. On every other executor `target` names a script, flow, page, endpoint or form and is untouched, and a row with no `target` is not judged. A page's `properties` bag is outside the stack parse; `os validate` judges it through its props gate, which parses the bag against these same rows and so reports the refusal at the row's `target` with the same text, as a `component-props-invalid` finding (that gate's one tier, a warning).
- **`dashboards[].header.actions[].actionUrl`**, when `actionType` is `'url'` or omitted. An omitted `actionType` is judged as the url route, because the two readers that give it a meaning (the console's dashboard renderer and `os validate`'s dashboard action check) both read it as `'url'`. On `'flow'`, `'script'`, `'modal'`, `'api'` and `'form'`, `actionUrl` names the flow, script, page, endpoint or form and is untouched.
- **`actions[].onSuccess.navigate`**, on every value.

The admitted set, at both doors:

- an `http://` or `https://` URL (the scheme compared case-insensitively);
- a `mailto:` address;
- an in-app path that starts with `/` or `./` (`/apps/crm/tasks/${result.id}`);
- a template that opens with `${` (`${result.redirectUrl}`), judged by the runner after interpolation.

Every other value is refused at the key, with a message that names the reason and the admitted set: `javascript:`, `data:`, `tel:` and every other scheme; `http:` or `https:` without the `//`; a protocol-relative `//host`; `/` followed by a backslash; a tab, line feed or carriage return anywhere; a bare relative value such as `forecast`, `../forecast` or `tasks/${result.id}`; and the empty string.

### FROM → TO

| before | what to write instead |
| --- | --- |
| `target: 'javascript:…'` / `actionUrl: 'javascript:…'` / `navigate: 'javascript:…'`, or `data:…` | no url target runs or renders content. For a page action row or a header action, declare the executor that does the work (`'script'`, `'flow'`, `'api'`), or link to an `https://` page; for `onSuccess`, drop it or navigate to an `https://` page. |
| `'tel:+1…'`, `'ftp://…'` or any other scheme | an `https://` page that offers it, or a `mailto:` address. `tel:` is not admitted. |
| `'https:example.com'` (no `//`) | `'https://example.com'` |
| `'//cdn.example.com/x'` (protocol-relative) | `'https://cdn.example.com/x'` for an external link, or `'/x'` for an in-app path |
| `'/\example.com'` (`/` then a backslash) | `'https://example.com'`, or an in-app path written with forward slashes |
| a value holding a tab, line feed or carriage return | the same value without them; percent-encode one that belongs in the address (`%09`, `%0A`, `%0D`) |
| `actionUrl: 'forecast'` with `actionType` omitted, meant as a flow or script | `actionType: 'flow'` (or `'script'`, …) beside it — the declared type takes `actionUrl` off the url route |
| `'forecast'`, `'../forecast'`, `'?tab=2'`, `'#top'`, `navigate: 'tasks/${result.id}'` | the rooted in-app path, `'/forecast'` / `'/tasks/${result.id}'`, or a `./` path |
| `target: ''` / `actionUrl: ''` / `navigate: ''` | the address the button or the hop was meant to open; drop an `onSuccess` that navigates nowhere |

**The one-line fix: give every url page action row, every url header action (`actionType: 'url'` or omitted) and every `onSuccess.navigate` an `http(s)://` URL, a `mailto:` address, an in-app path that starts with `/` or `./`, or a template that opens with `${` — or, for a row or a header action meant to run something, the executor that names it.** `os migrate meta --from 17` lists the D3 entries `ui-page-action-row-url-target-scheme-set-closed`, `ui-dashboard-header-action-url-scheme-set-closed` and `ui-action-on-success-navigate-scheme-set-closed`; the rewrite is by hand, because which address a refused value meant is the author's call.

**What an author now sees.** `os validate`, `os build`, `defineStack` and `defineAction` refuse such a value at `header.actions[].actionUrl` or `onSuccess.navigate`; on a page action row, `os validate`'s props gate reports it at the row's `target` (`properties.target`, or `properties.actions.N.target` for a member). For example, `javascript:alert(1)` on a header action gets: ``A dashboard header action's `actionUrl`, a url target when `actionType` is `'url'` or omitted, opens with `javascript:`, a scheme a url target never opens.``, followed by the reason and the admitted set. Every admitted value parses unchanged.

**Measured producers: none outside tests.** Every url-executor page action row and every header action outside tests in this repository and in objectui (at its pin `7578323` and its main `7af0ab37`) names an admitted target or declares a non-url `actionType`, and the only `onSuccess.navigate` outside tests is the documented in-app route template `/apps/crm/tasks/${result.id}`.
