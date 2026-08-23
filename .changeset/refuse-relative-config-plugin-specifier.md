---
"@objectstack/cli": minor
---

`os serve` refuses a relative `plugins: [...]` entry, naming the two spellings
that do work (#10944)

A string entry in the served app's own `objectstack.config.ts` that is not a
bare package name was handed straight to `import()`, which ESM resolves against
the file containing the call — `@objectstack/cli/dist/commands/serve.js`. The
served app's root never entered the resolution, so a relative path could not
address anything the app owns. Measured on `origin/main`, from a fixture app
that really did carry `local-plugin.js` beside its `package.json`:

```
'./local-plugin.js'  -> Cannot find module '<cli>/src/commands/local-plugin.js'
                        imported from '<cli>/src/commands/serve.ts'
'../local-plugin.js' -> Cannot find module '<cli>/src/local-plugin.js'
'..'                 -> LOADED — the CLI's own command barrel
                        (CompileCommand, ValidateCommand, ServeCommand, …)
```

The app's own file was never seen in any of them. The third row is the same
fact stated as a positive: a relative entry can load a module, but only ever
one belonging to the CLI. The boot loop then caught the failure, printed one
red `✗ Failed to load plugin:` line naming a path inside the CLI's install
directory, and served the app **without** the plugin — a deployment that looks
healthy while quietly missing the extension its config declared.

Such an entry is now refused before any import is attempted, with a message
that names both spellings that resolve from the app:

```
Refused the plugin entry './local-plugin.js' in `plugins: [...]`: a RELATIVE path there is
resolved against the CLI's own installation directory, never against your app — so
it can never load a file from your project. This spelling has never worked; it used
to fail with a "Cannot find module" naming a path inside the CLI's install directory.

Use one of the two spellings that resolve from your app:

  1. a package name your app DECLARES in its own package.json:
         plugins: ['@mycompany/crm']        (then: pnpm add @mycompany/crm)

  2. an absolute path, or a file:// URL the config computes for itself:
         plugins: [new URL('./local-plugin.js', import.meta.url).href]
```

**What changes for a config that carries such an entry.** The plugin was never
loaded before and is not loaded now, and the boot still continues past the
failed entry exactly as it did — the observable difference at boot is the text
of the one red line. The entry has *never* worked, but it failed **quietly
enough to be missed**: an author who read `Cannot find module …/@objectstack/
cli/dist/commands/local-plugin.js` had no way to tell that the spelling itself
was the problem, so a config could carry a dead `plugins:` entry indefinitely
while the deployment appeared fine. That is the silence this closes.

`minor` rather than `patch` because one shape does change what it loads:
`plugins: ['.']` / `plugins: ['..']` resolved into the CLI's own package and
could register the CLI's command barrel as a plugin. Those are now refused.
Nothing in `content/docs`, `examples/` or the test suite writes any relative
`plugins:` spelling, so no documented usage moves.

Scope is deliberately narrow, and every other shape that reaches this line was
measured rather than assumed. Untouched: bare package names (declared or not,
scoped or not — including a bare `local-plugin.js`, which ESM reads as a
package name and which keeps its existing "declare it in that app's
package.json" answer), absolute POSIX paths, `file://` URLs, Windows drive
paths (`C:\app\plugin.js`), `node:` builtins and `data:` URLs. All of those are
base-independent — they resolve to the same module whoever imports them — which
is exactly why they are none of this rule's business.

Resolving a relative entry against the **served app's root** instead is a
capability addition with no measured pull today; it stays a maintainer
decision, and this refusal is the collection point for such a request.
