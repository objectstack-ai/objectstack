---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(studio): the object Settings tab speaks business language, shows each setting's key as small print, and puts the developer options last

Clause-②: no
Metadata-protocol: none

Studio's object Settings tab is now in two parts. The business settings come first: label, plural label, icon and colour, description, who can see which records, the record name field, the stage field, the highlight fields, the record page tabs and the features. A "Developer options" section comes last, expanded and with no switch. It holds the internal name (read-only once the object exists), who can open the object by default, and the extra permissions it requires.

Titles and descriptions no longer show ADR numbers, internal rule codes or key names in parentheses. The metadata key each setting writes (`nameField`, `sharingModel`, `enable.clone`, `access.default`, `requiredPermissions`, …) is shown as small monospace text beside the setting's title. One click selects the whole key for copying. The key sits outside the control's label, so selecting it neither opens a picker nor flips a switch.

Three descriptions are rewritten so that someone who does not know the platform's internals can follow them: the internal name, the default access ("Standard — anyone with access to all objects" / "Restricted — only people granted this object by name") and the extra required permissions. The English and Chinese texts are both updated; every other language falls back to English for these strings, as before.

What each setting means and what it saves are unchanged.

For hosts of the object default inspector: `MetadataDefaultInspectorProps` gains an optional `split` (`{ part: 'business' | 'developer'; renderKey? }`). Only the object inspector reads it. Without it the inspector draws its whole panel, as before. The reworded object-inspector strings also show wherever that inspector is mounted.
