---
'@objectstack/spec': patch
---

docs(spec): a navigation entry's `label` describe states the one order the label resolves in

Clause-②: no

The `label` of a navigation entry (`BaseNavItemSchema`) said a present label "renders
verbatim and is never overwritten", which, read literally, forbids the id-keyed localization
`translateApp` already performs at the `/meta` boundary. Its describe and JSDoc now state one
order: the bundle entry `apps.<app>.navigation.<id>.label` for the active locale chain, keyed
by the entry's `id` and applied by `translateApp` over the app's `navigation` tree (not
`areas`); else a present label as authored — its inline locale map's value for that locale,
else its text; else, when absent, the current label of what the entry opens, at render time,
localized by the target's own translation. A present label is never replaced by its target's
label and never translated by matching its text. No accepted shape changes: `label` stays an
optional `I18nLabel`.
