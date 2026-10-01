---
'@objectstack/spec': minor
---

feat(spec)!: `action:button` / `action:icon` refuse `endpoint` with the rename `ActionSchema` already prescribes — `endpoint` → `target` (#21005)

**BREAKING** — `endpoint` on an `action:button` or `action:icon` component (`ActionButtonProps`, `ActionIconProps`) is no longer a declared key. `ActionSchema` has always refused `endpoint` with "Did you mean `endpoint` → `target`?", while these two rows accepted it. objectui's console registers its own `api` handler, which reads `target` and never `endpoint`, so an `api` button written with `endpoint` passed the props gate and called nothing. The rows now refuse it with the same rename, read from the one alias table the action and both rows share. Write the endpoint as `target`.

Clause-②: yes (narrowing)

## FROM → TO

| you wrote (17.5 and earlier) | write instead |
| --- | --- |
| `{ type: 'action:button', properties: { actionType: 'api', endpoint: '/api/v1/x' } }` | `{ type: 'action:button', properties: { actionType: 'api', target: '/api/v1/x' } }` |
| `{ type: 'action:icon', properties: { actionType: 'api', endpoint: '/api/v1/x' } }` | `{ type: 'action:icon', properties: { actionType: 'api', target: '/api/v1/x' } }` |
| `endpoint` on a block with no `actionType` | add `actionType: 'api'` and rename `endpoint` to `target` |

**The one-line fix:** rename `endpoint` to `target` in the block's `properties`; the value (the URL the `api` action calls) is unchanged.

**What an author who still writes it sees.** A page is never refused for it: a page component's `properties` is an open bag, so `definePage()`, `defineStack({ pages })` and the page write door accept the page as before. `os validate` / `os build` / `os lint` report `component-props-unknown-key` as a warning at `properties.endpoint`, with the rename "Did you mean `endpoint` → `target`?" — the same clause `ActionSchema` prints. The two rows also stop answering `path` with the edit-distance guess `patch` (the declarative write's field values): `url`, `endpoint`, `path` and `href` all rename to `target`, on the action and on both blocks alike. A typed `ActionButtonProps` / `ActionIconProps` input fails `tsc` at `endpoint`.

## The migration kit

- **The D2 conversion `action-block-endpoint-to-target`** (protocol 18, retired from the load path) renames `endpoint` to `target` on an `action:button` / `action:icon` whose `actionType` is `api`, the one meaning the key declared, with one notice per block. It reaches blocks in regions, nested in a container's `children`, and in a slotted page's named slots, so a stored `page` row or a built artifact that carries the key loads with `target` through the rehydration seams, which replay it. An already-present `target` wins: a twin with the same value is dropped. A block with no `actionType`, another `actionType`, a non-string `endpoint`, or a `target` that names a different endpoint is left as stored and reported as a TODO. Run `os migrate meta --from 17` to list the mechanical edits for existing sources; apply them by hand.
- **The D3 entry `action-block-endpoint-spelling-retired`** names what the rename cannot decide: the TODO sites above, and code — a custom action handler that read `endpoint` off the action reads nothing once the block carries `target`.
- **No deprecation window**, per the project's startup-stage posture.

Census at landing: no producer in this repository (examples, templates, platform pages, fixtures) or in objectui's examples authors `endpoint` on either block. ⚠️ **The out-of-repo consumer population is NOT MEASURED.** `@objectstack/spec` is published, so this is breaking for consumers no telemetry was consulted for.

<!-- adr-0087: registered action-block-endpoint-to-target, action-block-endpoint-spelling-retired -->
