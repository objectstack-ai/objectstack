// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The Java half of the `alipay-v3` vectors (ADR-0143 D2.3, as amended by the
// dated note of 2026-10-31): the official Alipay Java v3 SDK,
// com.alipay.sdk:alipay-sdk-java-v3:3.1.89.ALL, signs two requests and one
// response with the PLACEHOLDER test-only key pair in this directory. The
// nonce and timestamp are the SDK's own (it draws them inside `sign`), so this
// half chooses them and `generate-node.mjs` replays them through the official
// Node SDK. `generate.sh` runs both and fails unless the bytes are identical.
//
// Run through `generate.sh`, which fetches the SDK and its two runtime
// dependencies from Maven Central; prints one JSON object on stdout.

import com.alipay.v3.util.AlipayConfigUtil;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class GenerateAlipayV3Vectors {
    static final String APP_ID = "2021000000000000";
    static final String POST_URI = "/v3/alipay/trade/query";
    static final String POST_BODY = "{\"out_trade_no\":\"20150320010101001\"}";
    static final String GET_URI = "/v3/alipay/user/certify/open/query?certify_id=OC201809253000000393900404029253";
    static final String RESPONSE_BODY = "{\"trade_no\":\"2013112011001004330000121536\",\"out_trade_no\":\"20150320010101001\",\"trade_status\":\"TRADE_SUCCESS\"}";
    static final Pattern AUTH = Pattern.compile("^ALIPAY-SHA256withRSA app_id=([^,]+),nonce=([^,]+),timestamp=([^,]+),sign=(.+)$");

    public static void main(String[] args) throws Exception {
        Path dir = Path.of(args.length > 0 ? args[0] : ".");
        AlipayConfigUtil sdk = new AlipayConfigUtil();
        sdk.setAppId(APP_ID);
        sdk.setCharset("UTF-8");
        sdk.setPrivateKey(read(dir, "PLACEHOLDER-test-only-rsa2048-private-key.pkcs8.b64"));
        // One placeholder pair plays both roles: the app key that signs
        // requests, and the "Alipay" key whose public half verifies responses.
        sdk.setAlipayPublicKey(read(dir, "PLACEHOLDER-test-only-rsa2048-public-key.spki.b64"));

        String post = signed(sdk, "POST", POST_URI, POST_BODY);
        String get = signed(sdk, "GET", GET_URI, "");

        // The response half: the SDK's own RSA signer over the string its
        // `verify` checks (timestamp, nonce, body, each line-terminated), then
        // its `verify` over the result.
        String responseTimestamp = "1730359200000";
        String responseNonce = "8d2b6d3c-5f0e-4a8e-9b0a-6b1f2c3d4e5f";
        String responseSignature = sdk.generateSign(responseTimestamp + "\n" + responseNonce + "\n" + RESPONSE_BODY + "\n");
        if (!sdk.verify(RESPONSE_BODY, responseSignature, null, responseTimestamp, responseNonce)) {
            throw new IllegalStateException("the SDK refused its own response signature");
        }

        System.out.println("{\"sdk\":\"com.alipay.sdk:alipay-sdk-java-v3:3.1.89.ALL\",\"appId\":" + json(APP_ID)
            + ",\"post\":" + post + ",\"get\":" + get
            + ",\"response\":{\"body\":" + json(RESPONSE_BODY) + ",\"timestamp\":" + json(responseTimestamp)
            + ",\"nonce\":" + json(responseNonce) + ",\"signature\":" + json(responseSignature) + "}}");
    }

    static String signed(AlipayConfigUtil sdk, String method, String uri, String body) throws Exception {
        Map<String, String> headers = new HashMap<>();
        sdk.sign(method, uri, body, headers);
        String authorization = headers.get("Authorization");
        Matcher m = AUTH.matcher(authorization);
        if (!m.matches()) throw new IllegalStateException("unexpected Authorization shape");
        return "{\"method\":" + json(method) + ",\"uri\":" + json(uri) + ",\"body\":" + json(body)
            + ",\"nonce\":" + json(m.group(2)) + ",\"timestamp\":" + json(m.group(3))
            + ",\"authorization\":" + json(authorization) + "}";
    }

    static String read(Path dir, String name) throws Exception {
        return Files.readString(dir.resolve(name), StandardCharsets.US_ASCII).trim();
    }

    static String json(String s) {
        return "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n") + "\"";
    }
}
