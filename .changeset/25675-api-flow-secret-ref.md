---
'@objectstack/spec': minor
'@objectstack/lint': minor
'@objectstack/service-automation': minor
'@objectstack/trigger-api': minor
---

feat(spec): an `api` flow's start node may name its inbound hook secret (`config.secretRef`) instead of carrying it

An app package can now ship an inbound `api` flow without publishing its credential. The start node names the secret, the deployment fills that name, and the engine reads it at every post:

```ts
{
  id: 'start',
  type: 'start',
  config: { triggerType: 'api', hookId: 'heartbeat', secretRef: 'SRM_HEARTBEAT_SECRET' },
}
```

- The name resolves through the automation plugin's `credentialResolver`, the one a declarative connector's `auth.credentialRef` already uses: in the open tier it is the environment variable of that name (`process.env.SRM_HEARTBEAT_SECRET`); a host that wires a secrets service serves it from there.
- It is read per post, never cached, so a rotation applies to the next post. A post that arrives while the name has no value is refused `503 SERVICE_UNAVAILABLE` and is never verified; the server log names the flow and the reference, never a value.
- `FlowSchema` refuses a reference that is not a name (a letter or `_`, then letters, digits and `_`), one in the platform's `OS_` namespace (whoever signs the posts holds the hook secret, so a platform secret named there would be handed out with it), one beside a literal `secret`, and one on a flow that binds no inbound `api` trigger.
- `os validate` (`flow-api-trigger-secret-missing`) and the engine's registration check accept a usable reference in place of a literal, and the remedy they print now names `config.secretRef`.
- The reference is a name, not a credential: a flow read serves it as written. Saving a flow through the metadata API with a reference removes any hook secret the write-only flow credential store held for that start node.
- New exports from `@objectstack/spec/automation`: `ApiTriggerSecretRefSchema`, `apiTriggerSecretRefOf`, `apiTriggerSecretRefRefusals`, `API_TRIGGER_SECRET_REF_KEY`, `API_TRIGGER_SECRET_REF_RESERVED_PREFIX`. `AutomationEngineOptions` gains `credentialResolver`.

A literal `config.secret` still works. To move a flow off one, replace `secret: '<value>'` with `secretRef: 'YOUR_NAME'` and set `YOUR_NAME` in the deployment's environment.

Clause-②: yes (widening)

Metadata-protocol: added

Ruling-ref: 6386630545
