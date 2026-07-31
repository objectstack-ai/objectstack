---
---

test(cli): pin `os serve` config-boot for the shape #3887 actually reported — a config authored through `defineStack()` from `@objectstack/spec`, with no compiled `dist/objectstack.json`. #4110 fixed the crash (#4085) but every fixture pinning it is a plain object literal, so nothing exercised what a real project sends into boot: `defineStack` parses and normalizes, stamping `datasource: 'default'` on every object and full descriptors on every field. Such a fixture only resolves where a real `node_modules` does — `@objectstack/spec` is external to the config bundler — which is why it had to live under the package and why the gap outlived the fix. Test-only. Releases nothing.
