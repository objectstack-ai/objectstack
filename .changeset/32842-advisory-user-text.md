---
'@objectstack/lint': patch
---

fix(lint): the connector, permission-set and form-view advisories a save returns carry a user sentence in every platform locale

Clause-②: no
Metadata-protocol: none

Three advisory rule ids that the save door returns now carry `userTextParams` (the connector, permission set, object, view and entry names their user sentence interpolates) and have a sentence in all eleven platform locales, each in a `*.user-text.ts` catalog beside its rule and merged into the one catalog `findingUserMessage` renders from:

- `connector-credential-literal` (connector write), in four arms: a credential in a header, in an MCP server's environment variable, in `credentialEnv`, and a stdio MCP server whose credential reaches nothing. The sentence names the connector and the header or variable the credential sits under, and never the credential itself.
- `permission-retired-lifecycle-residue` (permission write): names the permission set, the object and the retired key.
- `predicate-rhs-path-shaped`, its advisory bare-word arm (view write): names the form view, the word and the operator, and gives both readings with the supported spelling of each (the quoted word, or the field on the left compared with a quoted value).

Rule ids, `message` and `hint` are unchanged, and the refusal arm of `predicate-rhs-path-shaped` (a dotted path on the right) carries no params, so it renders no user sentence. The `lintConnectorCredentialLiterals` and `validateRetiredPermissionResidue` registry entries now keep `userTextParams` when they re-map their findings, so the publish gate's advisories carry them. Because the finding objects now carry `userTextParams`, `os validate --json` and `os build --json` show that key on these findings in `warnings`.

The other seven advisory ids in these rule files get no sentence, because the save door never returns them:

- `agent-authoring-withdrawn`, `default-agent-outside-roster`, `default-agent-legacy-alias` and `mapping-connector-source-unknown`: reference-integrity suite members on its default `flow` write type. An agent, app or mapping write dispatches none of them, and a flow write's snapshot carries no agents, apps or mappings.
- `ai-skill-tool-unresolved`: the same, and kept off the door on purpose by ruling 5791822697 (ADR-0109 Decision §3): a per-write snapshot cannot resolve a skill's tools truthfully.
- `security-external-owner-unmapped` and `sharing-rule-object-not-shareable`: their registry entries run on the command line only.
