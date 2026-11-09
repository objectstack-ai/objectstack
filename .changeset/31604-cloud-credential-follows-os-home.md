---
'@objectstack/cloud-connection': patch
---

fix(cloud-connection): keep a single node's cloud binding credential under `OS_HOME`, so recreating the container does not disconnect it

Clause-②: no
Metadata-protocol: none

A self-hosted server kept its cloud binding credential in `.objectstack/cloud-connection.json` under its working directory, even with `OS_HOME` set. In a container the working directory is the image's own layer, so a restart kept the connection but a recreate (a compose recreate, an image upgrade) lost it: the server read as not connected and an online licence fell back to Community until someone connected it again.

- **Where it lives now.** With `OS_HOME` set, the file is `OS_HOME/cloud-connection.json`, beside the rest of the instance's state. With `OS_HOME` unset it stays at `.objectstack/cloud-connection.json` under the working directory, as before. The `credentialPath` option still wins over both.
- **Upgrading.** The first start with `OS_HOME` set moves the old working-directory file into `OS_HOME`, keeps mode `0600`, and logs both paths once. When a file is already in `OS_HOME`, that one is the connection and the old file is left untouched. Nothing to do by hand.
- **`os dev --fresh`.** The connection stays inside the run's temporary home, and the project's file is neither moved nor read.
- Several replicas declared over the Redis cluster driver still keep the credential in the shared database row; the file the first scaled-out start moves into that row is now the `OS_HOME` one.
