---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(app-shell): editing an action in Studio no longer stops the object from saving

Clause-②: no
Metadata-protocol: none

Three edits in Studio's action editor (Data › an object › Actions) wrote an action the spec refuses, and from then on every save of the object was refused until a reload, with nothing on screen naming the action:

- **Expose to AI agents** wrote a flat `aiExposed` (and its description a flat `aiDescription`). It now writes the spec's nested block, `ai: { exposed, description }`, and reads it back; unticking leaves a draft the spec accepts. A draft that still carries the flat keys is cleaned by the control's next write. The action preview's AI pill reads the same block.
- **Switching the Type** kept keys the new type refuses (a script `body` on an API action, `onSuccess`, `outcomeMessages`, `undoable: true`). The switch now clears exactly those, and keeps everything the new type accepts.
- **Body Shape** was a free-text box, so the documented `{ "wrap": "payload" }` was written as a string the spec refuses. It is now a Flat / Wrap control with a key input; a stored `{ wrap }` reads back as Wrap with its key, and Wrap is written only once it has a key.

The Data pillar now holds an action that is only unfinished, as it already held a field with no options: after "Run a script" before a source is typed, a Type switch before its endpoint, address or target is filled, or "Expose to AI agents" before a long enough description, no save goes out, and a neutral line names the input on the action until it is filled. A save the server still refuses is shown at the action: the strip names it (and the input, when the editor has one for that key), and "Show me" opens it on the Actions view. The next accepted save clears the strip, with no reload.

New `studio` namespace strings (en, zh): the Body Shape control, and the refusal and held lines for an action.
