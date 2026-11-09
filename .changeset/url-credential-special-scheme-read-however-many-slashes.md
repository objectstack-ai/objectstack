---
'@objectstack/spec': minor
---

feat(spec)!: a URL with a special scheme is read for credentials the way a URL parser reads it, however many slashes follow the scheme

Clause-②: no (narrowing)
Metadata-protocol: narrowed

<!-- adr-0087: registered url-credential-special-scheme-read-however-many-slashes -->

**BREAKING** accept-set narrowing at the two metadata doors that judge a URL credential: an authored connector instance (`DeclarativeConnectorEntrySchema` — `defineStack({ connectors })`, `os validate` / `os compile`, the artifact load, `PUT /api/v1/meta/connector/:name`) and a datasource driver config's URL keys (`config.url` on postgres, mysql, mongo and turso, turso `config.syncUrl`) at every door that parses the datasource.

- **A special scheme's authority is read as a URL parser reads it.** For `http`, `https`, `ws`, `wss` and `ftp`, in any letter case, the authority starts after the whole run of `/` and `\` that follows the scheme, however long, none included. A connector string holding a userinfo there, and a datasource URL holding a userinfo password there, are refused (`422 INVALID_METADATA` at the save door, located at the string, naming the parts, never the value); a bare username in a datasource URL stays accepted.
- **One grammar at both doors.** The connector entry and the datasource doors read the one userinfo grammar, and both read redactors rewrite exactly what the write refuses, at the position the write judged, serving every other character as stored.
- **Unchanged.** Every other scheme keeps `scheme://` or a scheme-relative `//` (`postgres:`, `libsql:`, `mongodb:` and the rest carry no authority without `//`); `file:` carries no userinfo; a URL spelled `scheme://` reads exactly as before. A stored row is never re-judged: a save of its served form keeps the stored value, and an edit of the served value stores exactly the edit.

## FROM → TO

```ts
// before — parsed green; now refused at providerConfig.baseUrl
{ name: 'billing_api', label: 'Billing API', type: 'api', provider: 'rest',
  providerConfig: { baseUrl: 'https:///billing:…@api.billing.example.com/v1' },
  auth: { type: 'none' } },

// after — the URL holds no credential, and the password is a reference
{ name: 'billing_api', label: 'Billing API', type: 'api', provider: 'rest',
  providerConfig: { baseUrl: 'https://api.billing.example.com/v1' },
  auth: { type: 'basic', username: 'billing', credentialRef: 'BILLING_API_PASSWORD' } },
```

The same holds for `https:billing:…@host`, `https:/billing:…@host` and `https:\billing:…@host`, and for a datasource URL key: spell it `scheme://`, keep it credential-free (a bare username stays accepted) and bind the password through the Setup → Datasources connection form's secret field, or reference it with `external.credentialsRef`. There is deliberately no automatic rewrite: the value in the string may be the only copy of the secret. The upgrade guide entry is `url-credential-special-scheme-read-however-many-slashes`.
