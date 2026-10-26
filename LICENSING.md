# Licensing

This repository is Apache-2.0, except `ui/` (the Console and `@object-ui/*`), which is MIT — both permissive.
Everything outside `ui/` is licensed under the Apache License, Version 2.0
([LICENSE](./LICENSE)); `ui/` is licensed under the MIT License
([ui/LICENSE](./ui/LICENSE)).

This repository contains everything you need to **build, run, and self-host
your own applications** under those licenses: the protocol (`@objectstack/spec`),
kernel, SDK, CLI, production runtime (`os start`), the Console (`ui/`), and the
official Docker image definition ([`docker/`](./docker), published as
`ghcr.io/objectstack-ai/objectstack`). There is no feature gate between
development and production in this repository.

**ObjectOS** is the runtime's product name, in three editions. **ObjectOS
Community** is what this repository ships, under the licenses above.
**ObjectOS Cloud** (managed) and **ObjectOS Enterprise** (self-managed) are
commercial editions and are not part of this repository; they, the official
cloud services, and marketplace commercial terms are governed by their own
agreements. See [docs.objectos.ai](https://docs.objectos.ai).

The full Apache 2.0 license text is available in [LICENSE](./LICENSE), and the
MIT license text for `ui/` in [ui/LICENSE](./ui/LICENSE).
