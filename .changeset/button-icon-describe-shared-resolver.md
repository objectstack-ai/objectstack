---
"@objectstack/spec": patch
---

`element:button`'s `icon` description now names the shared icon resolver the renderer actually uses

The `.describe()` on `ElementButtonPropsSchema.icon` — the sentence the docs site and the generated skill artifacts put in front of authors — said the renderer resolved the name "using its own PascalCase normaliser and rename map". That stopped being true when objectui moved the button off its file-local copy of that algorithm and onto the `resolveIcon` helper every `action:*` site already shared. The duplicate had been a defect in its own right: a rename added to the shared resolver to absorb a Lucide icon retirement reached every action site and silently missed `ui:button`.

Nothing an author may write changed, and nothing about the platform's behaviour regressed. `icon` is still read, still rendered on either side of the label per `iconPosition`, still suppressed while `loading`, and an unknown name still resolves to nothing rather than degrading to a fallback glyph — which is still exactly what separates this slot from the `LazyIcon` path the container icons use. Only the sentence describing where the resolution lives had gone stale, and it is corrected here together with the cross-repo read-point anchors recorded beside it, re-measured at objectui `9602dc820450`.
