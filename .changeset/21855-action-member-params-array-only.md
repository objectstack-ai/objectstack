---
'@objectstack/spec': minor
---

feat(spec)!: an `action:group` / `action:menu` member refuses a non-array `params` unless its `type` is `api`, with the prescription to author an action with static parameter values as its own `action:button` node

Clause-②: yes (narrowing)

<!-- adr-0087: registered ui-action-group-menu-member-params-array-only -->

**BREAKING**: an accept-set narrowing on a published authoring surface, shipped as `minor` under the repo's launch-window convention for accept-set narrowings. What reads the rows: the component-props gate on `objectstack validate`, `objectstack build` and `objectstack lint`, which reports the refusal as an advisory `component-props-invalid` finding. A stored page still saves and loads, because a page component's `properties` is not parsed on the metadata save or load path.

**Why.** A container member's `params` is its input list: both containers forward an array as the `ActionParam[]` inputs to collect before the action runs. They forward any other `params` value only for a `type: 'api'` member, as its request payload, and drop it for every other `type` (an absent one included), with a development-build warning only. The member declared `params` as any value, so an object `params` on a `navigate_edit` member passed the gate and then had no effect: no error and no static values. `params` carries one shape, and no second value-bag key is declared; a member's `properties.params` is already refused. So static parameter values are not part of the inline action vocabulary at all, and an action that needs them is its own `action:button` node, whose `params` object carries them.

**What is refused.** On an `action:group` or `action:menu` member whose `type` is not `api`, a `params` that is not an array — an object, a string, a number or `null`. The issue's `code` is `custom`, at `actions.N.params`, and its message names the container, the member's `type` and the prescription: *to run an action with static parameter values, author it as its own `action:button` node, whose `params` object carries them* (and, for a `type: 'api'` member's request body, `bodyExtra`).

**What stays accepted, byte for byte.** An array `params` on any member; every `params` value on a `type: 'api'` member (its request-payload window, unchanged); a member with no `params`; and an `action:button` / `action:icon` node's object `params`, which is its static values. The member's `params` stays `unknown` in the types — the narrowing is a refinement on the member, and no export, key or type moves.

## FROM → TO

| you wrote | write instead |
|:--|:--|
| `actions: [{ name: 'edit', type: 'navigate_edit', params: { objectName: 'account', recordId: '${record.id}' } }]` on `action:group` / `action:menu` | the action as its own node: `{ type: 'action:button', properties: { name: 'edit', label: 'Edit', actionType: 'navigate_edit', params: { objectName: 'account', recordId: '${record.id}' } } }` |
| `actions: [{ name: 'save', type: 'api', target: '/api/save', params: { status: 'closed' } }]` | unchanged — or, preferred, `bodyExtra: { status: 'closed' }` |
| `actions: [{ name: 'ask', type: 'script', params: [{ name: 'reason', type: 'text' }] }]` | unchanged — an array is the input list |

**The one-line fix: move a member that carries static parameter values out of its container into its own `action:button` node, with the same `params` object; drop a non-array `params` from any other member.** The container never forwarded those values, so the `action:button` node is the first place they reach the handler.

## Who is affected, measured

A writer is an `action:group` / `action:menu` member authoring a non-array `params` on a non-`api` type. The census walked every `params` key in every file that names either block (TypeScript AST over `.ts`/`.tsx`/`.js`/`.jsx`/`.mjs`/`.cjs`/`.mts`/`.json` and fenced Markdown code, same-file constants resolved; YAML by text), plus every non-array `params` on an element of any `actions` array corpus-wide, and each hit was read by hand. Lit control: a planted fixture with four non-`api` object members (flat, inside a node's `properties` bag, through a same-file constant, in a Markdown fence), an `api` member and an array member — all six found and classified.

- **objectstack** at `5b2d189e28`, this branch's base: 24 files name a block, holding 32 `params` keys, 23 not an array; none is a container member's — conversion fixtures of the inline `element:button` action, schema source, the liveness ledger, CHANGELOG quotations, and one `properties.params` refusal probe. No example, doc, skill or fixture writes the refused spelling.
- **objectui** at the `.objectui-sha` pin `0abd4f9f8` and at `main` `f1a177c41` (the same census at both; the action renderers byte-identical): 89 files, 47 `params` keys, 41 not an array. The only container members with a non-array `params` on a non-`api` type are objectui's own tests asserting that the container drops it (`action-entry-object-params-10462.test.tsx`, `action-container-member-params-10290.test.tsx`); the `type: 'api'` controls beside them stay accepted.
- **hotcrm** at `4054ec2680`: no file names either block.
- **cloud** was not reachable from this session. **Deployed metadata** was not measured.

### The kit

- **The refusal.** A refinement on each container member (`ui/component.zod.ts`), applied to the `action:group` and the `action:menu` member alike; the member's `params` description says what it now takes, and the generated reference page carries it.
- **The ledger.** The D3 semantic entry `ui-action-group-menu-member-params-array-only` (protocol 18) and its step-18 rationale fragment. No key is removed, so there is no tombstone, and there is no D2 conversion: the static values belong on a different node, which no rewrite can build in the author's place.
