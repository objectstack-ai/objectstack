---
"@objectstack/cli": patch
---

fix(cli): `objectstack init` scaffolds now compile — templates author an OWD, and the scaffold self-test runs the author-time rules (#9666)

`objectstack init my-app -t app --install` reported `✓ Scaffold validated`, and
the next command in the documented on-ramp, `npm run dev`, failed to compile:

```
✗ Author-time rules failed (1 issue)
• object "my_app_item": custom object "my_app_item" declares no sharingModel (OWD)…
  rule: security-owd-unset  at objects[0].sharingModel
```

The CLI's own shipped template was refused by the CLI's own shipped rule set, so
the dev server never started on a freshly generated project.

Two halves:

- **Templates author an OWD.** The `app` and `plugin` templates now declare
  `sharingModel: 'private'` on the object they emit — the rule's own recommended
  default and the ADR-0090 D1 baseline (absence is not a decision). A sweep of
  every built-in template found `plugin` in the same state as the reported `app`;
  `empty` emits no objects and was already clean.
- **`init`'s self-test got teeth.** It used to check only that the rendered config
  loaded and carried a `manifest.namespace`, which is why a template that could
  not compile shipped. It now runs the author-time rule registry over the
  generated project and refuses to report success when any rule rejects it. The
  rule set is the `build` one — the same set `os dev` reaches by spawning
  `os compile` — so this is a shift-left, not a stricter bar: nothing that
  compiles today stops compiling, and a broken template now fails at generation
  time instead of at a user's first `dev`.

`✓ Scaffold validated` still prints, and now names how many author-time rules
passed.
