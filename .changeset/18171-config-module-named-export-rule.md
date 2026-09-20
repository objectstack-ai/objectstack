---
'@objectstack/cli': patch
---

The strict-parse refusal now says WHY a key the author never wrote inside `defineStack()` is being judged as a stack key.

`objectstack.config.ts` is loaded as a MODULE: `loadConfig()` takes the default export as the base and
then merges every NAMED export onto it as a top-level stack key, under the export's own name. That is
deliberate — `onEnable` and `functions` are declared stack keys an app authors as named exports, and
unwrapping `mod.default` alone dropped them. The consequence nothing stated is that a named export is
legal only when its name is a key `ObjectStackDefinitionSchema` declares, so a helper exported beside
the stack (`export const collectPackageDirs = …`) arrives at the strict parse as a top-level stack key
of that name and is refused there as unrecognised.

The refusal was already loud and named the key. It is unchanged: same key, same `unrecognized_keys`,
same failing parse, same exit code, same `--json` payload. What `os build` and `os validate` now add,
on the text face only, is the rule it enforces and the fix — move the helper into a sibling module and
import it from the config. `LoadedConfig` gained a `namedExports` reading so that explanation has a
provenance to read instead of guessing; nothing about which configs load has changed.

The same rule is now on the config-authoring docs page, in the CLI configuration reference, and in the
comment every `os init` template ships at the top of the config it scaffolds.
