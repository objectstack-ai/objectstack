---
'@objectstack/plugin-webhooks': patch
'@objectstack/runtime': patch
'@objectstack/plugin-security': patch
---

fix(plugin-webhooks, runtime): declared-webhook remedies name each holder's exact address, and a name refused whole is refused at every address naming both holders

Clause-②: no
Metadata-protocol: none

Remedy text and refusals for declared webhooks (ADR-0150 D2/D3/D5/D8):

| Where | FROM | TO |
|:---|:---|:---|
| Name guard (`sys_webhook` create or rename onto a declared name) | names `POST /api/v1/security/_activation/webhook/NS/NAME` per holder, which answers `409` for two co-owners of one namespace and does not exist for a package that declares no namespace | names `POST /api/v1/security/_activation/webhook/NAME?package=PACKAGE` per holder, which switches exactly that holder |
| Redelivery veto, switched-off declared webhook | `switch it on (POST .../webhook/NS/NAME ...)` | `switch it on (POST .../webhook/NAME?package=PACKAGE ...)` |
| Dispatcher warning, a declared webhook withheld by a `sys_webhook` row | namespace address per holder | `?package=PACKAGE` address per holder |
| Dispatcher warning, a row naming no package under two holders | `.../webhook/<namespace>/NAME` | `.../webhook/NAME?package=PACKAGE`, as the departed-package warning already said |
| Metadata service lists the environment's declaration beside a package's (no registry item): bare refusal sentence | "Nothing picks one of them: address it by its package." | says neither declaration is dispatched and no address switches one, names both holders, and says to remove or rename declarations |
| Same state, `POST .../webhook/NAME?package=PACKAGE` and `POST .../webhook/NS/NAME` | `404` "no enabled package declares the name" | `409 RESOURCE_CONFLICT`, the refusal above, `candidates` naming the environment and the package; nothing written |
| Same state, name guard | names a `<namespace>` placeholder address | says no declaration of the name is dispatched and quotes the refusal |
| Same state, redelivery of a `declared:PACKAGE/NAME` delivery | "the package is disabled ... Enable the package" | refused with the refusal, naming both holders |
| `?package=` or namespace address when the reader serves no slot and the bare read fails | `404` | `503 SERVICE_UNAVAILABLE`, nothing written |
| Upgrade impact report, withheld-webhook line and `packageDisabled` doc | a disabled package's address "answers 409" | refuses the switch: `404` while the package is the name's only holder, `409` naming the other holders while another package declares it |

A name that one package, or two packages each once, declare through the metadata service is unchanged: each served holder is switched at its own `?package=` address. A disabled sole holder still answers `404` at its address.

No action is needed. Operators who scripted the namespace address keep it working where it worked; the `?package=PACKAGE` address the messages now name works for every package holder.
