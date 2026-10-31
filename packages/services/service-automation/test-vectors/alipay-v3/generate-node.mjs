// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The Node half of the `alipay-v3` vectors (see README.md): the official
// Alipay Node SDK, alipay-sdk 4.14.0, replays each request the Java v3 SDK
// signed — same PLACEHOLDER key, same nonce and timestamp — through its own
// `curl` against a local stand-in for the Alipay gateway, which records the
// `Authorization` the SDK sends and answers with the response the Java SDK
// signed. The run fails unless:
//   - every Authorization is byte-identical to the Java SDK's;
//   - the Node SDK's own response signature is byte-identical to the Java SDK's;
//   - the Node SDK accepts the Java-signed response, and refuses it tampered.
// On success it prints the vectors the signer test pins.
//
// Usage (through generate.sh): ALIPAY_SDK_DIR=<node_modules/alipay-sdk> node generate-node.mjs <this dir> <java output>

import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const [dir, javaOutput] = process.argv.slice(2);
const sdkDir = process.env.ALIPAY_SDK_DIR;
if (!dir || !javaOutput || !sdkDir) {
    console.error('usage: ALIPAY_SDK_DIR=<node_modules/alipay-sdk> node generate-node.mjs <dir> <java output>');
    process.exit(2);
}

const require = createRequire(import.meta.url);
// The CommonJS build reads `randomUUID` off the module object at call time, so
// the nonce the Java SDK drew can be replayed; `Date.now` likewise.
const nodeCrypto = require('node:crypto');
const { AlipaySdk } = require(join(sdkDir, 'dist/commonjs/index.js'));
const { signatureV3 } = require(join(sdkDir, 'dist/commonjs/util.js'));
const sdkVersion = JSON.parse(readFileSync(join(sdkDir, 'package.json'), 'utf8')).version;

const java = JSON.parse(readFileSync(javaOutput, 'utf8'));
const privateKey = readFileSync(join(dir, 'PLACEHOLDER-test-only-rsa2048-private-key.pkcs8.b64'), 'ascii').trim();
const publicKey = readFileSync(join(dir, 'PLACEHOLDER-test-only-rsa2048-public-key.spki.b64'), 'ascii').trim();

let answer = { body: java.response.body, signature: java.response.signature };
let lastAuthorization;
const gateway = createServer((req, res) => {
    lastAuthorization = req.headers.authorization;
    req.resume();
    req.on('end', () => {
        res.writeHead(200, {
            'content-type': 'application/json',
            'alipay-timestamp': java.response.timestamp,
            'alipay-nonce': java.response.nonce,
            'alipay-signature': answer.signature,
        });
        res.end(answer.body);
    });
});
await new Promise((resolve) => gateway.listen(0, '127.0.0.1', resolve));
const endpoint = `http://127.0.0.1:${gateway.address().port}`;

const sdk = new AlipaySdk({ appId: java.appId, privateKey, keyType: 'PKCS8', alipayPublicKey: publicKey, endpoint });
const failures = [];

async function replay(name, vector, curl) {
    const realUuid = nodeCrypto.randomUUID;
    const realNow = Date.now;
    nodeCrypto.randomUUID = () => vector.nonce;
    Date.now = () => Number(vector.timestamp);
    try {
        await curl();
    } finally {
        nodeCrypto.randomUUID = realUuid;
        Date.now = realNow;
    }
    if (lastAuthorization !== vector.authorization) failures.push(`${name}: the Node SDK's Authorization differs from the Java SDK's`);
}

await replay('post', java.post, () => sdk.curl('POST', java.post.uri, { body: JSON.parse(java.post.body) }));
const getUrl = new URL(java.get.uri, endpoint);
await replay('get', java.get, () => sdk.curl('GET', getUrl.pathname, { query: Object.fromEntries(getUrl.searchParams) }));

const responseContent = `${java.response.timestamp}\n${java.response.nonce}\n${java.response.body}\n`;
const nodeResponseSignature = signatureV3(responseContent, sdk.config.privateKey);
if (nodeResponseSignature !== java.response.signature) failures.push('response: the Node SDK\'s signature differs from the Java SDK\'s');

answer = { body: `${java.response.body} `, signature: java.response.signature };
let refused = false;
try {
    await sdk.curl('POST', java.post.uri, { body: JSON.parse(java.post.body) });
} catch (err) {
    refused = err?.code === 'response-signature-verify-error';
}
if (!refused) failures.push('response: the Node SDK accepted a tampered body');
gateway.close();

if (failures.length > 0) {
    console.error(failures.join('\n'));
    process.exit(1);
}
console.log(JSON.stringify({
    sdks: [java.sdk, `alipay-sdk@${sdkVersion}`],
    appId: java.appId,
    post: java.post,
    get: java.get,
    response: java.response,
}, null, 2));
