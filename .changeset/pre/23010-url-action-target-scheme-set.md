---
'@objectstack/spec': minor
---

feat(spec)!: a `type: 'url'` action's `target` declares its closed scheme set — `http://`, `https://`, `mailto:` and in-app paths — and refuses every other target at parse

Clause-②: no (narrowing)

<!-- adr-0087: registered ui-action-url-target-scheme-set-closed -->

**BREAKING** — an accept-set narrowing on a published authoring surface, shipped as `minor` under the launch-window convention for accept-set narrowings.

`target` was a free string on every action type, so a url action whose target the console's action runner refuses — `javascript:`, `data:`, `tel:`, a protocol-relative `//host` — parsed clean, published, and failed only at the click. The scheme set is now stated once in the contract and the runtime opens exactly that set. On both url-action doors, `ActionSchema` (a registered action) and `InlineActionSchema` (an inline action, such as `element:button`'s `action`, including the legacy `type: 'navigation'` + `to` spelling), a `type: 'url'` target must be one of:

- an `http://` or `https://` URL (the scheme compared case-insensitively);
- a `mailto:` address;
- an in-app path that starts with `/` or `./`;
- a template that opens with `${` (`${ctx.origin}/x`, `${param.url}`), judged by the runner after interpolation, at the click.

Every other target is refused at `target`, with a message that names the reason and the admitted set. `target` on every other action type (`script`, `flow`, `modal`, `api`, `form`) names a handler, flow, page, endpoint or form and is untouched, and so are interpolation and `openIn`.

### FROM → TO

| before | what to write instead |
| --- | --- |
| `target: 'javascript:…'` or `target: 'data:…'` | no url target runs or renders content. Move the work to a `type: 'script'` action (an inline `body`), or link to an `https://` page. |
| `target: 'tel:+1…'`, `target: 'ftp://…'` or any other scheme | an `https://` page that offers it, or a `mailto:` address. `tel:` is not admitted. |
| `target: 'https:example.com'` (no `//`) | `target: 'https://example.com'` |
| `target: '//cdn.example.com/x'` (protocol-relative) | `target: 'https://cdn.example.com/x'` for an external link, or `target: '/x'` for an in-app path |
| `target: '/\example.com'` (`/` then a backslash) | `target: 'https://example.com'`, or an in-app path written with forward slashes |
| a target holding a tab, line feed or carriage return | the same target without them; percent-encode one that belongs in the address (`%09`, `%0A`, `%0D`) |
| `target: 'thanks'`, `'../thanks'`, `'?tab=2'`, `'#top'` | the rooted in-app path, `target: '/thanks'`, or a `./` path |

**The one-line fix: give every `type: 'url'` action an `http(s)://` URL, a `mailto:` address, or an in-app path that starts with `/` or `./`.** `os migrate meta --from 17` lists the D3 entry `ui-action-url-target-scheme-set-closed`; the rewrite is by hand, because which address a refused target meant is the author's call.

**What an author now sees.** `os validate`, `os build`, `defineAction` and `defineStack` refuse such a target at `target`. For example, `javascript:alert(1)` gets: ``A `type: 'url'` action's `target` opens with `javascript:`, a scheme a url target never opens.``, followed by the reason and the admitted set. Every admitted target parses unchanged.

**Measured producers: none outside tests.** Every url-action target written outside tests is admitted: 9 sites in this repository at `df7a137923` (the showcase's `https://objectstack.ai` among them), and 8 in objectui at both its pin `9646e2ed2bf3` and its main `7578323`. One test fixture in `@objectstack/spec` gave the url arm of an all-types loop a bare `test_handler`; it now writes `/test_handler`.
