---
"@objectstack/spec": patch
---

The `PluginSchema` describe strings for `staticPath`, `slug` and `default` now name `ui`, the plugin type the enum actually accepts.

`PluginSchema.type` is `z.enum(['standard', ...CORE_PLUGIN_TYPES])`, and `CORE_PLUGIN_TYPES` spells the frontend member `ui`. The three describe strings beside it still named `ui-plugin` — a value the same schema refuses two lines above. They are not merely stale: they read as instructions ("Required for `type="ui-plugin"`"), so an author or an agent following the field's own documentation writes a value that is then rejected, with the correct spelling nowhere in the sentence that sent them there.

The strings now read `(Required for type="ui")`, `(Required for type="ui")` and `(Only one "ui" plugin can be default)`. Because these describes compile into the published JSON Schema and into the generated reference page, the correction reaches every consumer that reads field documentation out of the spec rather than out of the source file — the generated `content/docs/references/kernel/plugin.mdx` table now agrees with the `type` row printed directly above it, which previously listed `'ui'` among the accepted members while the three rows underneath told the reader to write `ui-plugin`.

No accept/reject behaviour moves: `type: 'ui-plugin'` is refused before and after, `type: 'ui'` is accepted before and after, and no key is added, renamed or removed. The closed-set pin tests that name `ui-plugin` as a non-member are deliberately unchanged — they are the reason this correction is provable.
