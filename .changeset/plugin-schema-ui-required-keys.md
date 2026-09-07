---
"@objectstack/spec": minor
"@objectstack/core": minor
---

`PluginSchema` now REQUIRES `staticPath` and `slug` when `type` is `'ui'`, and core's `Plugin` interface inherits every `PluginSchema` key from `PluginDefinition` instead of restating two of them.

**BREAKING** accept-set narrowing on a published schema, shipped as `minor` under the repo's launch-window convention for breaking changes (`scripts/check-changeset-no-major.mjs`). `packages/spec/src/kernel/plugin.zod.ts` described `staticPath` and `slug` as *"Required for type=\"ui\""* while declaring both `.optional()`, with nothing behind the prose; since `kernel.use()` runs the schema on the boot path (#16049), that was a promise the runtime visibly did not keep. This is the spec half of #16049, split by director ruling (decision batch #58, 2026-09-06).

**Exactly what is newly refused.** A plugin object with `type: 'ui'` that omits `staticPath`, omits `slug`, or spells either as `undefined`. Nothing else: every other declared type (`standard`, `driver`, `server`, `app`, `theme`, `agent`, `objectql`), and a plugin declaring no `type` at all, still parses with neither key. A PRESENT value is judged exactly as before — `slug` keeps its `/^[a-z0-9-_]+$/` regex, `staticPath` stays any string, and the empty string is not refused by this change.

**What a refusal looks like.** One zod issue per missing key, `path` naming the key, the new stable code `PLUGIN_UI_REQUIRED_KEY_MISSING` (exported from `@objectstack/spec/kernel`) at the head of the issue `message` and on the issue's `params.code`. At `kernel.use()` it rides the existing `PLUGIN_CONTRACT_VIOLATION` envelope unchanged, because the loader surfaces the first issue's `path` and `message` and reads nothing else:

```
PLUGIN_CONTRACT_VIOLATION: plugin '@acme/console' is refused by the declared
plugin contract at 'staticPath': PLUGIN_UI_REQUIRED_KEY_MISSING: a `type: 'ui'`
plugin must declare `staticPath` — the absolute path of the static assets it
serves. Declare it, or drop `type: 'ui'` if this plugin serves no assets.
```

**The fix for an affected plugin** is the one the message names: declare both keys (`staticPath`: the absolute path of the assets it serves; `slug`: the URL segment it is mounted under), or drop `type: 'ui'` if the plugin serves no assets. There is no fallback to lean on: the Hono server's `slug || name.split('/').pop()` derivation is no longer reachable through the kernel, because the object is refused before it is stored.

**`@objectstack/core` — `Plugin` derives its metadata keys.** `Plugin` now `extends PluginDefinition` (`z.input<typeof PluginSchema>`), so `id`, `type`, `staticPath`, `slug`, `default`, `version`, `description`, `author` and `homepage` are ONE declaration shared with the schema the kernel enforces. Additive for every existing implementer: `type` and `version` keep the shapes they had (`type` is still `PluginType | undefined`, pinned type-equal in `packages/rest`; `version` still `string | undefined`), and the seven other keys are new optional members. A `ui` plugin can now carry `staticPath` / `slug` without widening its own type. Runtime-only members (`name`, `dependencies`, `optionalDependencies`, `requiresServices`, `providesServices`, `init`, `start`, `destroy`) stay declared on the interface.

**Blast radius, measured.** No in-repo plugin object outside test fixtures declares `type: 'ui'` (searched `packages/`, `apps/`, `examples/` non-dist sources for a `type` key or class field holding the literal `'ui'`: three test files, nothing shipped), so no in-repo composition changes behaviour. Externally authored `ui` plugins that relied on the slug derivation, or declared no assets, are the population this reaches — and they are refused at boot, by name, with the key to add.

<!-- adr-0087: not-required (no-migration-prescription) An accept-set narrowing on plugin OBJECTS, which are never stored metadata: `PluginSchema` gains a refinement and one exported constant; no metadata key, object definition or stored representation is added, removed or renamed, so `objectstack migrate meta` has nothing to visit and there is no tombstone to mint. The channel that reaches an affected plugin author is the refusal itself, which names the missing key at `kernel.use()`; which value that key should carry is authoring intent no ledger entry can decide. -->
