---
'@object-ui/types': minor
'@object-ui/components': minor
'@object-ui/plugin-chatbot': minor
'@object-ui/plugin-report': minor
---

Clause-②: yes
Metadata-protocol: added

Nine duration keys now carry their unit in their name (objectstack#25762). Each one said its unit only in its description, so `timeout: 300` read as either milliseconds or seconds. After objectui merges into objectstack, `@objectstack/spec`'s `check:duration-unit-keys` judges these schemas too, and the maintainer chose to rename the keys rather than exempt them. The renames follow objectstack's own (`…Ms` / `…Seconds`, the unit each description already stated). The value and its unit do not change, only the key name. This is breaking for a document that still writes an old name; it is marked `minor` under this repository's version policy.

| Node / schema | FROM | TO | Unit |
|---|---|---|---|
| `carousel` (`CarouselSchema`) | `autoPlay` | `autoPlayMs` | milliseconds |
| `chatbot`, `chatbot-enhanced`, `chatbot-floating` | `autoResponseDelay` | `autoResponseDelayMs` | milliseconds |
| `ActionSchema` | `timeout` | `timeoutMs` | milliseconds |
| `ActionSchema.retry` | `delay` | `delayMs` | milliseconds |
| `toast` (`ToastSchema`) | `duration` | `durationMs` | milliseconds |
| `tooltip` (`TooltipSchema`) | `delayDuration` | `delayDurationMs` | milliseconds |
| `hover-card` (`HoverCardSchema`) | `openDelay` | `openDelayMs` | milliseconds |
| `hover-card` (`HoverCardSchema`) | `closeDelay` | `closeDelayMs` | milliseconds |
| `report` (`ReportComponentSchema`) | `refreshInterval` | `refreshIntervalSeconds` | seconds |

What an author sees with an old name:

- **zod (`@object-ui/types/zod`).** The old key is still declared, as a tombstone, so it is refused at its own path with code `invalid_type`. The message names the new key: "`timeout` is now `timeoutMs` … the value (milliseconds) is unchanged." Without the tombstone, `.passthrough()` would keep the value and nothing would read it.
- **TypeScript.** The old member is `?: never` with `@deprecated`, so a typed literal that writes it fails to compile.
- **Renderers.** `toast`, `tooltip`, `hover-card`, the three chatbot registrations and `ReportViewer` read the new key. Their registration `inputs` and `defaultProps` use the new name too. The `useObjectChat` hook option `autoResponseDelay` is a programmatic API, not a schema key, and keeps its name.

objectui has no conversion registry: ADR-0087's D2 table lives in `@objectstack/spec`. The conversion is this table plus the refusal message. To migrate, rename each key as the table shows and keep the value.
