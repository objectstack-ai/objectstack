---
"@objectstack/spec": minor
"@objectstack/cli": patch
---

fix(action): one precedence for `target` vs the deprecated `execute` — lower the alias, then drop it (#3713)

`execute` is the deprecated alias of `target`, and three readers resolved "the
author declared both" in **two opposite directions**:

| Reader | Preferred |
|---|---|
| `ActionSchema` transform (spec) | `target` |
| objectui `ActionRunner.executeScript` | `execute` |
| CLI compile step (`lowerCallables`) | `execute` |

So `defineAction({ type: 'script', target: 'preferredHandler', execute: 'legacyHandler' })`
ran `preferredHandler` server-side and `legacyHandler` client-side — two
different scripts for one button, silently, with no error anywhere. Low
frequency (it needs an author to set both, which happens mid-migration or by
copy-paste), but the failure mode is "the wrong code ran".

**`target` now wins everywhere, and the alias is removed from the parsed
output** — the same "canonical wins, alias disappears" shape as
`agent.knowledge.topics` → `sources`. The conflict is now *unrepresentable*
rather than merely agreed-upon: no renderer can see a second slot to disagree
about. Worth noting the server runtime never read `execute` at all
(`isHeadlessInvokableAction` gates on `target || body`; dispatch probes
`target`/`name`), so authoring `execute` worked *solely* because it was lowered
at parse time — dropping it costs the server nothing.

The CLI's inline-handler lowering had the same bug in compile-time form: with a
function in both slots it bundled the `execute` one and then overwrote
`action.target` with that ref, silently discarding the function the author
declared on `target`. It now probes `target` first and drops the alias.

**Authoring is unchanged** — `execute` is still accepted on input (`ActionInput`),
still lowered to `target`, and still listed in the reference docs. Nothing to
migrate in your app metadata.

**Consumers of the parsed metadata**, however, must read the canonical slot:

- FROM: `parsedAction.execute` → TO: `parsedAction.target`
- One-line fix: delete the alias fallback, e.g. `action.execute || action.target`
  becomes `action.target`.

`z.infer<typeof ActionSchema>` no longer carries `execute`, so any such reader
fails to compile rather than silently reading `undefined`. The objectui
`ActionRunner` counterpart ships separately.
