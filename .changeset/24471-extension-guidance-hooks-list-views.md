---
'@objectstack/spec': patch
---

Clause-②: no

fix(spec): the object-extension refusals for `hooks` and `listViews` say what `defineStack()` does with a hook or view on another package's object

`ObjectExtensionSchema` refuses `hooks` and `listViews` on an `objectExtensions` entry. Both refusals used to tell the author to declare a top-level hook, or a top-level `view`, "bound to the target object instead". For an object the stack does not define, `defineStack()` refuses both at build, an extended object included, so the route the refusal named could not be taken.

- **`hooks`** now reads: a hook follows the ownership of its object, so declare it as a top-level hook in the stack that defines the object; `defineStack()` refuses a top-level hook bound to an object the stack does not define, an extended one included. The refusal is the recorded decision of ADR-0130 §1.5 ("the split must follow hook ownership").
- **`listViews`** now reads: declare the views as a top-level `view` in the stack that defines the target object; `defineStack()` refuses a top-level `view` whose `list` or `form` data source is an object the stack does not define, an extended one included.
- **Unchanged.** What `defineStack()` accepts and refuses, every error code, status and issue path. Only the refusal text moves, with its mirror in the object-extensions guide.
