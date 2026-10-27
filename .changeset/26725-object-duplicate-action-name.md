---
'@objectstack/spec': minor
'@object-ui/app-shell': patch
---

fix(spec)!: an object that declares one action name twice is refused at every door that parses it, and Studio never writes the pair

Clause-②: no (narrowing)
Metadata-protocol: narrowed

**BREAKING** for an object whose `actions` array repeats a name.

- **Before.** The object save door accepted two entries of one object's `actions` under one name: `PUT /api/v1/meta/object/X?mode=draft` answered 200, the publish answered 200, and both were served. An action name is the key the action runs under on its object, so which declaration ran was undefined. `defineStack` and `os validate` already refused the pair inside a stack; the save door parses an object alone and did not.
- **Now.** `ObjectSchema` refuses the pair, so every door that parses an object refuses it: `defineStack`, `os validate`, `os build` and the object save door (422 `INVALID_METADATA`). One issue per repeated name, at `actions[j]` of its second declaration, naming the name and every index: `Object 'X' declares the action 'Y' twice in actions: actions[i] and actions[j]. …`. Inside a stack the pair is now refused by the object parse (`STACK_SCHEMA_INVALID`) rather than by the cross-reference pass's duplicate action-key check, which keeps the pairs that span two collections (a bound standalone action beside an embedded one, two standalone actions).
- **Not changed.** Distinct names, the same name on two different objects, and a standalone action bound to an object by `objectName` (judged by `defineStack` for one stack and reported by the runtime's bound-action collision warning across packages).
- **Fix.** Rename all but one of the colliding entries (and every button, flow and caller that runs the renamed one by name), or delete the duplicate.
- **Stored rows.** A stored object that repeats a name still loads, under a `[metadata_spec_invalid]` diagnostic carrying the refusal, and its next save is refused. `os migrate meta --stored` lists each such object under the TODO id `object-duplicate-action-name-refused`; nothing rewrites it, because which declaration keeps the name only the owner knows.
- **Studio** (`@object-ui/app-shell`). New already derived a name no listed action held; renaming an action in the editor's Name field to a name another action of the object holds now writes the first free `<name>_N` instead of the duplicate.

<!-- adr-0087: registered object-duplicate-action-name-refused -->
