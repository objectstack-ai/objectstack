---
'@objectstack/cli': patch
'@objectstack/runtime': patch
---

fix(cli,runtime): an artifact you NAMED and a boot input you don't have are different failures — say which (#4110 follow-up, #4131 step 1)

Three corrections, all from the same principle: a platform may boot with no
application (#4085), and that says nothing about how a MISSING NAMED INPUT
should be read.

- **A named-but-missing artifact boots empty and silently.** #4110 made an
  absent artifact non-fatal all the way down — right for the conventional
  `<cwd>/dist/objectstack.json`, which is just "not compiled yet". But
  `OS_ARTIFACT_PATH` / `{ artifactPath }` skip the existence check by design, so
  the tolerance reached them too: `OS_ARTIFACT_PATH=/nope os serve` printed
  "booting from artifact", reached `Server is ready`, and named the missing path
  NOWHERE in its output (serve's boot-quiet window drops the loader's calm
  line). `createDefaultHostConfig` — the boot with no config, where the artifact
  IS the deployment — now rejects a named local artifact that does not exist,
  naming both the path and which source named it. The loader keeps its
  tolerance, so the config-boot path #4085 fixed is untouched.

- **"Configuration file not found" never said where it looked.** The two things
  that actually happen are a typo'd filename and the wrong working directory,
  and the second is the common one. It now names the config path, the artifact
  path, and that `OS_ARTIFACT_PATH` is unset — and still refuses rather than
  inventing a zero-object platform, pointing at `objectstack start` for a boot
  that is app-less on purpose.

- **That refusal was being truncated.** `this.exit(1)` unwinds to oclif's
  `process.exit`, which does not drain a piped stdout, so a diagnostic split
  across several `console.log` calls loses its tail — measured: only the first
  two lines of the new message survived a pipe, i.e. exactly the part that says
  where to look went missing. Both of `serve`'s pre-flight refusals now emit one
  write. Caught by the e2e added here, not by review.

Also corrects the plugin-ordering claims in `createStandaloneStack` and in the
test that pinned them: the comment said the datasource plugin's array position
"MUST precede ObjectQLPlugin: its start() connects the default driver", and the
test asserted that index with the same rationale. The connect happens in
`init()`, and the kernel resolves order from the dependency graph — which hoists
ObjectQLPlugin ahead of the datasource plugin (measured: 6 slots earlier), the
reverse of what the slot reads as. The test now pins the declared dependency
that actually orders the two inits, which deleting the array position cannot
break and deleting the declaration does. #4131 tracks making the AppPlugin end
of that contract enforced rather than conventional.
