---
'@objectstack/skills': patch
---

docs(skills): the `registerHook` example names the real seam, and the refusal-list teaching names its places

Clause-②: no
Metadata-protocol: none

- `skills/objectstack-data/references/data-hooks.md`, Registration Methods, method 2: the example's comment said "in your plugin's onEnable()", a method no kernel plugin has, so a hook written there never registers. It now says the example runs in the app's `onEnable` export (`objectstack.config.ts`), where `ctx.ql` is the engine, and that a kernel plugin, which has no `ctx.ql`, registers from `start(ctx)` with `ctx.getService('objectql').registerHook(…)`.
- Same file, Declared refusals: `/data` cuts `userMessage` at 500 characters (a single sentence's too), so a long reasons list loses its closing line there; `/data` and `/actions` answer `details.refusals` uncut, and MCP tools relay the lines as text. This replaces "the HTTP doors", since "door" on this page also means a hook registration path.
- `skills/objectstack-ui/rules/actions.md`, Refusing by code: the reasons-list sentence ended "(rules there)", which named no place; it now names "Declared refusals", the hook section that carries the rules.

Both files stay at their token ceilings (10120 and 3918); the added words are paid by cutting restatements in the same file.
