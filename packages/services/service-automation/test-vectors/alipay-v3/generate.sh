#!/usr/bin/env bash
# Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
#
# Regenerates and cross-checks the `alipay-v3` signer vectors (README.md): the
# official Java v3 SDK signs, the official Node SDK replays, and the run fails
# unless both produce the same bytes. Needs a JDK 11+, Maven and Node 22+, and
# reaches Maven Central and the npm registry. Prints the vectors on success;
# each run draws a fresh nonce and timestamp, so the bytes differ run to run
# while the two SDKs still agree on every one.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

for artifact in com.alipay.sdk:alipay-sdk-java-v3:3.1.89.ALL com.google.guava:guava:28.1-jre org.bouncycastle:bcprov-jdk15on:1.64; do
  mvn -q dependency:copy -Dartifact="$artifact" -DoutputDirectory="$work/lib"
done
java -cp "$work/lib/*" "$here/GenerateAlipayV3Vectors.java" "$here" > "$work/java.json"

npm install --silent --no-save --ignore-scripts --prefix "$work/node" alipay-sdk@4.14.0
ALIPAY_SDK_DIR="$work/node/node_modules/alipay-sdk" node "$here/generate-node.mjs" "$here" "$work/java.json"
