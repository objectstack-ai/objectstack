---
'@objectstack/cli': patch
---

`os dev -a PATH` and `os start --artifact PATH` now serve the artifact they name, also from a directory that holds an `objectstack.config.ts` (#21501).

Clause-②: no

- **One precedence, written once.** The order is `--artifact` > `OS_ARTIFACT_URL` > `OS_ARTIFACT_PATH` > `<cwd>/dist/objectstack.json` > `<home>/dist/objectstack.json` (`os start` only) > a cwd `objectstack.config.ts`, except that a cwd config joins the boot when the resolved artifact is its own compiled output. It is the order the `os start` reference already published. `os start` and `os dev` both resolve through one module, and the `serve` child they spawn boots exactly their answer.
- **Beside a config.** The child used to read the supervisor's answer only when the working directory held no config. So `os dev -a X` and `os start --artifact X` printed `Artifact: X` and served the config's `dist/objectstack.json`, or the config itself. A named artifact now boots alone, exactly as it boots from a directory with no config. The config takes part only when the artifact is its own compiled output: `<config dir>/dist/objectstack.json`, or the path the command compiled it to. A bare `os dev`, a bare `os start` in a project, and `os start --artifact ./dist/objectstack.json` take that path, and are unchanged. A host config (its `plugins` hold code) boots its own module there, because its compiled output cannot carry that code.
- **`OS_ARTIFACT_PATH` beside a config** follows the same rule: `OS_ARTIFACT_PATH=Y os start` serves `Y` without loading the config. Under `os start --artifact ./dist/objectstack.json` the flag now also wins over an exported `OS_ARTIFACT_PATH` inside the config boot.
- **`os dev` under a local `OS_ARTIFACT_PATH`** compiles the cwd config into that path, so the file there is the config's own compiled output. The config takes part in the boot that serves it, and a host config compiled there keeps its plugins.
- **`os dev` gains the `OS_ARTIFACT_URL` rung.** `--artifact` outranks it. Before, the reference stayed in the child's environment and won. Without the flag the reference drives the boot, as under `os start`. The `Artifact:` row names it (redacted), and nothing is compiled into, watched for or judged stale against it.
- **Banner rows.** `os start` and `os dev` print `Config:` only when the config takes part in the boot. The child says it is not loading a config that sits beside a named artifact, instead of `No objectstack.config.ts found`.
- **The ready banner names what loaded.** On a config boot, a non-host config whose app was served from its compiled artifact gets `Artifact: dist/objectstack.json` in the ready banner, and a host config keeps `Config: objectstack.config.ts`. No ready-banner row names a file the boot did not load.

Upgrading: a project that ran `os dev -a`, `os start --artifact` or `OS_ARTIFACT_PATH` beside its config, and relied on that config being loaded, should drop the override or point it at `./dist/objectstack.json`.
