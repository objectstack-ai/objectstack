---
'@objectstack/verify': minor
---

feat(verify): `bootStack(config, { artifact })` boots the compiled artifact as the app, so a test runs each hook's and action's lowered `body` in the sandbox, as a deployment does

Clause-②: yes (widening)

`objectstack build` lowers each inline hook `handler` and action `target` it can into a metadata-only `body`, and a deployment runs that body in the runtime's QuickJS sandbox, against the sandbox's `ctx`. `bootStack` mounted the source configuration only, so a handle test ran the function in-process, and a handler that refuses once lowered passed every test.

- **`BootOptions.artifact`** names the compiled `objectstack.json`: a path, resolved against `hostRoot` (so `'dist/objectstack.json'` names the app's own build), or an `http(s)://` URL. The artifact is read by the runtime's own artifact loader (`loadArtifactBundle`, with the options every artifact boot reads it with) and mounted as the app, in place of `config`. `AppPlugin` binds each hook's `body` ahead of its `handler`, through the same sandbox runner every artifact boot uses, so every door (`hooks.run`, `actions.run`, `api`, …) runs what the build shipped.
- **A refused body answers as the body-only path answers.** The handle rejects with the sandbox's `SandboxError`, which carries a `code` and `status` the body declared on its throw. A body that crashes (a `TypeError`) carries none, and REST answers it `500` `INTERNAL_ERROR`. For example, a handler that writes to `ctx.dispatch.scope` passes in-process and refuses every insert once lowered, because the sandbox hands a body `ctx.dispatch` without `scope`.
- **The rest of the stack is still composed from `config`**: its `requires`, its own `plugins`, its declared default profile, its datasources. `objectstack serve <config>` composes the same way. So `config` is the configuration the artifact was built from.
- **A local artifact gets its `objectstack-runtime.*.mjs` merged**, so a callable the build could not lower runs in-process from it, as under `objectstack start`. `objectstack build --strict-body` refuses such a callable at build time, and its artifact is body-only.
- **Refused before anything boots**, each with its `code` and `status`: an artifact that cannot be loaded (`RESOURCE_NOT_FOUND`, 404; the boot never falls back to the source), an artifact built from another app (`RESOURCE_CONFLICT`, 409), and a configuration carrying `onEnable` (`INVALID_REQUEST`, 400). No artifact carries `onEnable`; for a configuration that mounts no plugin instance of its own, `objectstack serve <config>` grafts it from the configuration module, a `@objectstack/cli` rule this package does not re-derive. No error code is added.
- The handle lowers nothing: build the artifact first. A stale artifact boots stale bodies.
