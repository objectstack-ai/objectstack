# Security Policy

Thank you for helping keep ObjectStack and the people who build on it safe. This file says how to report a
vulnerability, which versions receive security fixes, how quickly to expect an answer, and how a fix is disclosed.

## Reporting a vulnerability

**Please do not report security problems in a public issue, discussion or pull request.** Anything posted there is
visible to everyone before a fix exists.

Report privately through GitHub's private vulnerability reporting:

1. Open [**Report a vulnerability**](https://github.com/objectstack-ai/objectstack/security/advisories/new)
   (the same button is on this repository's **Security** tab).
2. Fill in the form. Only you and the maintainers can see the report and the conversation that follows.

A good report includes:

- **What is affected:** the package name (for example `@objectstack/core`) and the version you tested.
- **How to reproduce it:** the smallest steps, request or configuration that shows the problem.
- **What an attacker gains:** the impact as you understand it (data read or changed, privileges gained, service
  disrupted), and any precondition such as a signed-in account or a non-default setting.
- **Anything else useful:** a proof of concept, a suggested fix, or related reports.

If you are unsure whether something is a security problem, report it privately anyway. We would rather close a
private report than have a real problem discussed in public.

## Supported versions

All `@objectstack/*` packages in this repository are released together under one version number.

| Version | Security fixes |
| --- | --- |
| The latest major line: every release whose major version equals the newest release on npm | ✅ |
| Any earlier major line | ❌ |

When a new major version is released, the previous major line stops receiving security fixes. A fix ships as a new
release on the latest major line, so staying on a supported version means upgrading to the newest release of that
line.

## What to expect

These are targets, counted from when the report reaches us, not guarantees:

| Step | Target |
| --- | --- |
| Acknowledgement that we received the report | within 3 business days |
| Triage verdict: accepted as a vulnerability or not, with a severity | within 10 business days |
| Fix released for a **critical** issue | within 14 days of the verdict |
| Fix released for a **high** issue | within 30 days of the verdict |
| Fix released for a **medium** issue | within 90 days of the verdict |
| Fix released for a **low** issue | in a regular release |

We keep you updated in the private report as the work moves, and tell you if a target will slip and why.

## Disclosure

- A fix ships in a normal release of the affected packages.
- After that release is published, we publish a GitHub security advisory for this repository that names the affected
  and patched versions.
- For **high** and **critical** issues we request a CVE identifier for the advisory.
- With your permission, we credit you in the advisory.

Please keep the details private until the advisory is published.

## Scope

This policy covers the source code and the npm packages published from this repository.

If you found the problem in a hosted ObjectStack service rather than in these packages, report it the same way and
say so in the report.
