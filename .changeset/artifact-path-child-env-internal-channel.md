---
"@objectstack/cli": minor
---

fix(cli): `os start` / `os dev` stop writing `OS_ARTIFACT_PATH` into the child `serve` environment — the CLI's own plumbing moves to an internal channel (#8985)

`os start` and `os dev` are supervisors: each resolves an artifact, then spawns
`os serve` to boot it. Both handed the resolved path down by writing
**`OS_ARTIFACT_PATH`** into the child environment — the same variable an operator
sets to name an artifact. `dev` wrote it unconditionally; `start` wrote it
whenever it had resolved anything and no `OS_ARTIFACT_URL` was in play. Both
writes happen **before** the downstream `objectstack.config.ts` is evaluated.

So inside any config, that variable was set on **every** boot, including boots
where no operator had ever mentioned it — measured from the shipped EE image
with its own `ENV` deliberately deleted: `os start` still printed
`Artifact: dist/objectstack.json` and handed that path down. A config could not
answer *"did a human ask for this, or did the CLI put it here?"*

The resolved path now travels on **`OS_INTERNAL_ARTIFACT_PATH`**, a channel the
CLI owns both ends of (`packages/cli/src/utils/internal-artifact-channel.ts`),
and the property downstream consumers need is restored:

> **the presence of `OS_ARTIFACT_PATH` in a config's environment means an
> operator set it.**

**Nothing about resolution changed.** Each command's ladder resolves in the
parent exactly as before, and `serve` reads the new channel strictly between the
reference and the operator knob:

```
--artifact > OS_ARTIFACT_URL > OS_INTERNAL_ARTIFACT_PATH > OS_ARTIFACT_PATH > <cwd>/dist/objectstack.json
```

That position is what preserves today's answers in both directions. It beats
`OS_ARTIFACT_PATH` because `os start --artifact X` run with an operator's
`OS_ARTIFACT_PATH=Y` exported boots **X** today — the parent used to overwrite
the variable on the way down, and now inherits it untouched. It loses to
`OS_ARTIFACT_URL` because `os dev` writes the channel unconditionally, as it
wrote the old variable unconditionally, and the reference has always outranked
the path.

Two further behaviours are unchanged and now pinned rather than incidental:
`start` still refuses to set `OS_BOOT_EMPTY` when a reference is driving the
boot (an unreachable artifact host stays a loud refusal instead of a silently
empty platform), and a resolved-but-missing artifact is still "named" to
`resolveDefaultArtifactPath`, so it fails loudly rather than booting empty.

**If you depended on the old side effect** — a config reading
`process.env.OS_ARTIFACT_PATH` and expecting the CLI to have populated it — set
the variable yourself, or read the artifact from the config's own inputs.
`OS_ARTIFACT_PATH` remains a fully supported operator knob on the exact rung it
has always occupied; the CLI simply no longer manufactures it on your behalf.
`OS_INTERNAL_ARTIFACT_PATH` is not a supported knob and is deliberately absent
from the environment-variable reference.
