---
'@objectstack/metadata-protocol': patch
'@objectstack/cli': patch
'@objectstack/cloud-connection': patch
---

fix(metadata-protocol, cli, cloud-connection): a declared action override moved to another object is told which object the base ships the action on

Clause-②: no
Metadata-protocol: none

The `declared_package_ships_no_such_item` refusal (`403 NOT_OVERRIDABLE`) for a `.custom` action override whose `objectName` differs from the base action's used to say the base "ships no action named 'X'" and to "correct the name", though the name was right. It now names both objects and tells the author to keep the base action's `objectName`, at all three doors (the save and publish door, `os validate`, the managed install), from one sentence builder in `judgeOverrideWrite`. A name the base does not ship at all reads as before. The rule, code and status are unchanged.
