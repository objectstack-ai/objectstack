# `alipay-v3` signer vectors

The vectors pinned in `src/request-signing/alipay-v3.test.ts` come from here. They follow the third
branch of ADR-0143 D2.3's vector rule, added by its dated note of 2026-10-31. Alipay publishes no
worked example with a usable key, and no official v3 SDK test suite carries a byte-exact vector. The
vendor's two official SDKs therefore sign with one placeholder key, and the vectors are admitted only
because the two agree byte for byte:

- `GenerateAlipayV3Vectors.java` uses `com.alipay.sdk:alipay-sdk-java-v3:3.1.89.ALL`
  (`AlipayConfigUtil.sign`, `generateSign`, `verify`). It signs a POST and a GET request and one
  response.
- `generate-node.mjs` uses `alipay-sdk` 4.14.0 (Node). It replays each request through the SDK's own
  `curl`, with the Java SDK's nonce and timestamp, against a local stand-in for the gateway. The run
  fails unless:
  - the `Authorization` headers are identical to Java's;
  - its response signature is identical to Java's;
  - it accepts the Java-signed response and refuses it tampered.
- `generate.sh` fetches both SDKs, runs both halves and prints the vectors. It needs a JDK 11+, Maven,
  Node 22+ and access to Maven Central and the npm registry. Each run draws a new nonce and timestamp,
  so the bytes change from run to run, and the two SDKs must agree on every one.

## The key pair is a PLACEHOLDER

`PLACEHOLDER-test-only-rsa2048-private-key.pkcs8.b64` and
`PLACEHOLDER-test-only-rsa2048-public-key.spki.b64` are an RSA-2048 pair generated for these tests on
2026-10-31. They belong to no Alipay app and authenticate nothing. They are bare base64, the form
Alipay's console issues. One pair plays both roles: the app key that signs requests, and the "Alipay"
key whose public half verifies responses. Never use them for anything else.
