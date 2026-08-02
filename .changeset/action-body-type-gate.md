---
"@objectstack/runtime": minor
"@objectstack/lint": minor
"@objectstack/spec": patch
---

fix(runtime,lint): `action.body` binds a handler only for `type: 'script'` (#4352)

`ActionSchema.body` has always described itself as "Only used when type is
`script`", and its JSDoc went further — "Only meaningful when
`type === 'script'`. When set, the runtime invokes the body inside the sandbox
… and ignores `target`." The runtime read none of it:
`actionBodyRunnerFactory` bound a handler the moment `body` parsed, and
`collectBundleActions` collected any named action. A `type: 'url'` action
carrying a leftover `body` was therefore registered in the action registry and
executed in the sandbox — reachable through
`POST /api/v1/actions/:object/:action` and through
`ql.object(o).execute(name)`, and counted by the governance inventory as a live
handler.

Declared ≠ enforced, in the shape that is hardest to debug: an author flips
`type` from `script` to `url`, reasonably concludes the body is now dead code,
and it keeps running with nothing anywhere saying so.

**Behaviour change.** `body` now runs only under `type: 'script'`:

| Action | Before | After |
|:--|:--|:--|
| `type: 'script'` + `body` | body runs | unchanged — body runs |
| `type` omitted + `body` | body runs | unchanged — body runs (`ActionType.default('script')`) |
| `type: 'url' \| 'modal' \| 'flow' \| 'api' \| 'form'` + `body` | body ran | **no handler is bound**; the refusal is logged |

Only an action that **explicitly** declares a non-`script` type *and* carries a
`body` changes behaviour. An omitted `type` still means `script`, because the
collectors walk raw bundle objects — a `strict: false` `defineStack` or a legacy
`manifest.actions[]` never passes through `ActionSchema`, so the schema's own
default has to be applied at the gate rather than assumed to have been applied
already.

**FROM → TO.** If you have an action whose body you want to keep running, set
`type: 'script'` and move the navigation/dispatch target elsewhere; if you want
the target behaviour, delete the now-inert `body`:

```diff
  {
    name: 'open_portal',
-   type: 'url',
+   type: 'script',
    target: '/portal',
    body: { language: 'js', source: "await ctx.api.object('lead').update(…)", capabilities: ['api.write'] },
  }
```

The refusal is **not** silent — silence would only relocate the invisibility the
issue is about. `actionBodyRunnerFactory` logs a warning naming the action, its
declared `type`, and both fixes.

Authoring-time rejection of the same contradiction already shipped in #4438
(`ActionSchema` rejects `body` alongside a non-`script` `type`), so what remains
reachable here is data at rest published before that gate existed, plus bundles
that never parsed. This release closes that half. New tests also pin that the
**publish gate resolves to the rejecting schema** — through
`getMetadataTypeSchema('action')` and `ObjectSchema.actions` — so a re-point of
either registration cannot silently reopen the hole while the schema's own unit
tests stay green.

`@objectstack/lint`'s `validate-action-body-writes` filters by `type` again.
#4344 deliberately made that rule type-blind on the grounds that "the runtime
binds a handler from `action.body` alone … checking what executes beats checking
what the schema says should" — true then, and the comment predicted its own
revision. Execution and declaration are the same set again, so a non-`script`
body no longer produces write-set advice about writes that provably never
happen; the publish gate names that metadata's real defect (`type`) with its own
prescription.

`collectBundleActions` stays deliberately type-blind: it feeds governance
surfaces that must enumerate every declared action, bound or not, and the other
bind path (`engine.setDefaultActionRunner`, for Studio-authored actions) never
walks it. The gate lives at the single point where a `body` becomes an
executable handler, so there is no second copy of the rule to drift.
