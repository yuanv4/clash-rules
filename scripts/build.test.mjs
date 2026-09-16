import assert from "node:assert/strict";
import { test } from "bun:test";
import {
  mergeRules,
  normalizeConfiguration,
  parseRules,
  renderYaml,
  resolveInputFormat,
  serializeRule,
} from "./build.mjs";

const sourceUrl = "https://example.test/rules";

test("parses raw lists into canonical rules with stable deduplication", () => {
  const rules = parseRules(
    "# comment\r\nDOMAIN, example.com\r\nDOMAIN, example.com\r\nIP-CIDR, 192.0.2.0/24, no-resolve\r\n",
    sourceUrl,
    "raw-list"
  );

  assert.deepEqual(rules, [
    { type: "DOMAIN", value: "example.com", options: [] },
    { type: "IP-CIDR", value: "192.0.2.0/24", options: ["no-resolve"] },
  ]);
  assert.deepEqual(rules.map(serializeRule), ["DOMAIN,example.com", "IP-CIDR,192.0.2.0/24,no-resolve"]);
});

test("raw and Clash YAML adapters produce equivalent canonical rules", () => {
  const regex = String.raw`(?i)^(?:foo|bar),(?:baz|qux)$`;
  const rawRules = parseRules(
    `DOMAIN,example.com\nIP-CIDR,192.0.2.0/24,no-resolve\nDOMAIN-REGEX,${regex}\n`,
    sourceUrl,
    "raw-list"
  );
  const yamlRules = parseRules(
    `payload:\n  - ${JSON.stringify("DOMAIN,example.com")}\n  - ${JSON.stringify("IP-CIDR,192.0.2.0/24,no-resolve")}\n  - ${JSON.stringify(`DOMAIN-REGEX,${regex}`)}\n`,
    sourceUrl,
    "clash-yaml"
  );

  assert.deepEqual(yamlRules, rawRules);
  assert.deepEqual(rawRules.map(serializeRule), [
    "DOMAIN,example.com",
    "IP-CIDR,192.0.2.0/24,no-resolve",
    `DOMAIN-REGEX,${regex}`,
  ]);
});

test("accepts a VPSDance-style DOMAIN-REGEX without JavaScript regex validation", () => {
  const expression = String.raw`(?i)^([a-z0-9-]+\.)?(openai|chatgpt)\.com$`;
  const rules = parseRules(
    `payload:\n  - ${JSON.stringify(`DOMAIN-REGEX,${expression}`)}\n`,
    sourceUrl,
    "clash-yaml"
  );

  assert.deepEqual(rules, [{ type: "DOMAIN-REGEX", value: expression, options: [] }]);
  assert.equal(serializeRule(rules[0]), `DOMAIN-REGEX,${expression}`);
});

test("rejects invalid DOMAIN-REGEX structure", () => {
  assert.throws(
    () => parseRules("DOMAIN-REGEX,", sourceUrl),
    /DOMAIN-REGEX requires a non-empty expression/
  );
  assert.throws(
    () => parseRules("DOMAIN-REGEX,^foo$\u0001", sourceUrl),
    /Unsafe multi-line or control content/
  );
  assert.throws(
    () => parseRules("DOMAIN-REGEX,^foo$,no-resolve", sourceUrl),
    /DOMAIN-REGEX does not support an option field/
  );
});

test("rejects malformed, multi-document, and wrong Clash YAML payloads", () => {
  assert.throws(
    () => parseRules("payload: [", sourceUrl, "clash-yaml"),
    /Invalid Clash YAML at https:\/\/example\.test\/rules/
  );
  assert.throws(
    () => parseRules("payload:\n  - DOMAIN,example.com\n  - 42\n", sourceUrl, "clash-yaml"),
    /payload\[1\].*non-empty string/
  );
  assert.throws(
    () => parseRules("payload: DOMAIN,example.com\n", sourceUrl, "clash-yaml"),
    /payload must be an array/
  );
  assert.throws(
    () => parseRules("other:\n  - DOMAIN,example.com\n", sourceUrl, "clash-yaml"),
    /root mapping must contain payload/
  );
  assert.throws(
    () => parseRules("- DOMAIN,example.com\n", sourceUrl, "clash-yaml"),
    /root must be a single mapping/
  );
  assert.throws(
    () => parseRules("payload:\n  - DOMAIN,example.com\n---\npayload:\n  - DOMAIN,other.com\n", sourceUrl, "clash-yaml"),
    /root must be a single mapping/
  );
});

test("resolves source input defaults and rule-level overrides", () => {
  assert.equal(resolveInputFormat("raw-list", undefined), "raw-list");
  assert.equal(resolveInputFormat("clash-yaml", undefined), "clash-yaml");
  assert.equal(resolveInputFormat("raw-list", "clash-yaml"), "clash-yaml");
});

const makeConfig = () => ({
  release_base_url: "https://rules.example.test/release",
  proxy_group: "🚀 Nodes",
  inputs: [
    {
      name: "first-input",
      repository: "https://github.com/example/first-input",
      base_url: "https://raw.githubusercontent.com/example/first-input/main/",
      license: { id: "MIT", url: "https://github.com/example/first-input/blob/main/LICENSE" },
      input_format: "raw-list",
    },
    {
      name: "second-input",
      repository: "https://github.com/example/second-input",
      base_url: "https://raw.githubusercontent.com/example/second-input/main/",
      license: { id: "Apache-2.0", url: "https://github.com/example/second-input/blob/main/LICENSE" },
      input_format: "clash-yaml",
    },
  ],
  providers: [
    {
      name: "merged",
      target: "DIRECT",
      no_resolve: true,
      inputs: [
        { input: "first-input", path: "rules/first.list" },
        { input: "second-input", path: "rules/second.yaml", input_format: "raw-list" },
      ],
    },
  ],
});

test("normalizes merge-ready provider views and preserves ordered provenance", () => {
  const config = normalizeConfiguration(makeConfig());
  const provider = config.providers[0];
  assert.equal(config.proxyGroup, "🚀 Nodes");

  assert.deepEqual(provider.inputs.map((input) => input.inputFormat), ["raw-list", "raw-list"]);
  assert.deepEqual(provider.inputs.map((input) => input.sourceUrl), [
    "https://raw.githubusercontent.com/example/first-input/main/rules/first.list",
    "https://raw.githubusercontent.com/example/second-input/main/rules/second.yaml",
  ]);
  const rendered = renderYaml(
    provider,
    mergeRules([
      parseRules("DOMAIN,first.example\n", provider.inputs[0].sourceUrl),
      parseRules("DOMAIN,second.example\nDOMAIN,first.example\n", provider.inputs[1].sourceUrl),
    ])
  );
  assert.match(rendered, /# Source 1 \[first-input\]: https:\/\/github\.com\/example\/first-input \(https:\/\/raw\.githubusercontent\.com\/example\/first-input\/main\/rules\/first\.list\)/);
  assert.match(rendered, /# License 2 \[second-input\]: Apache-2\.0 \(https:\/\/github\.com\/example\/second-input\/blob\/main\/LICENSE\)/);
  assert.match(rendered, /- "DOMAIN,first\.example"\n  - "DOMAIN,second\.example"/);

  const singleSourceConfig = makeConfig();
  singleSourceConfig.providers[0].inputs = [singleSourceConfig.providers[0].inputs[0]];
  const singleSourceProvider = normalizeConfiguration(singleSourceConfig).providers[0];
  const singleSourceRendered = renderYaml(singleSourceProvider, []);
  assert.match(singleSourceRendered, /# Source: https:\/\/github\.com\/example\/first-input \(https:\/\/raw\.githubusercontent\.com\/example\/first-input\/main\/rules\/first\.list\)/);
  assert.doesNotMatch(singleSourceRendered, /# Source 1/);
});

test("sources.json preserves routing precedence and provider provenance", async () => {
  const config = await Bun.file(new URL("../sources.json", import.meta.url)).json();
  const normalized = normalizeConfiguration(config);
  const providerNames = normalized.providers.map((provider) => provider.name);
  assert.equal(providerNames.includes("direct"), false);
  assert.deepEqual(providerNames, [
    "lan_non_ip",
    "lan_ip",
    "reject_non_ip",
    "reject_ip",
    "ai_cn",
    "ai",
    "google",
    "netflix",
    "disney",
    "telegram",
    "steam",
    "microsoft",
    "apple",
    "media",
    "custom_direct",
    "proxy",
  ]);

  const rejectNonIpProvider = normalized.providers[2];
  const rejectIpProvider = normalized.providers[3];
  assert.equal(rejectNonIpProvider.target, "🛑 广告过滤");
  assert.equal(rejectIpProvider.target, "🛑 广告过滤");

  const domesticAiProvider = normalized.providers[4];
  assert.equal(domesticAiProvider.target, "🤖 国内 AI");
  assert.deepEqual(domesticAiProvider.inputs.map((input) => input.sourceUrl), [
    "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/category-ai-cn.yaml",
  ]);
  assert.deepEqual(domesticAiProvider.inputs.map((input) => input.inputFormat), ["clash-yaml"]);

  const aiProvider = normalized.providers[5];
  assert.equal(aiProvider.target, "🤖 国际 AI");
  assert.deepEqual(aiProvider.inputs.map((input) => input.sourceUrl), [
    "https://raw.githubusercontent.com/VPSDance/ai-proxy-rules/main/rules/clash/global.yaml",
    "https://raw.githubusercontent.com/boweic/ruleset.bowei.co/master/Clash/non_ip/apple_intelligence.txt",
    "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/category-ai-!cn.yaml",
  ]);
  assert.deepEqual(aiProvider.inputs.map((input) => input.inputFormat), ["clash-yaml", "raw-list", "clash-yaml"]);

  const googleProvider = normalized.providers[6];
  assert.equal(googleProvider.target, "🌐 Google");
  assert.deepEqual(googleProvider.inputs.map((input) => input.sourceUrl), [
    "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/google.yaml",
    "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geoip/google.yaml",
  ]);
  assert.deepEqual(googleProvider.inputs.map((input) => input.inputFormat), ["clash-yaml", "clash-yaml"]);

  const serviceProviders = normalized.providers.slice(7, 14);
  assert.deepEqual(
    serviceProviders.map(({ name, target, inputs }) => [name, target, ...inputs.map((input) => input.sourceUrl)]),
    [
      ["netflix", "🎬 Netflix", "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/netflix.yaml", "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geoip/netflix.yaml"],
      ["disney", "🎬 DisneyPlus", "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/disney.yaml"],
      ["telegram", "📲 电报信息", "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/telegram.yaml", "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geoip/telegram.yaml"],
      ["steam", "💨 Steam商店", "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/steam.yaml"],
      ["microsoft", "Ⓜ️ 微软服务", "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/microsoft.yaml"],
      ["apple", "🍎 苹果服务", "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/apple.yaml"],
      ["media", "🌍 媒体服务", "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/category-media.yaml"],
    ]
  );

  const customDirectProvider = normalized.providers[14];
  assert.equal(customDirectProvider.name, "custom_direct");
  assert.equal(customDirectProvider.target, "DIRECT");
  assert.deepEqual(customDirectProvider.inputs.map((input) => input.sourceUrl), [
    "https://raw.githubusercontent.com/yuanv4/clash-rules/main/custom/tag.txt",
  ]);
  const proxyProvider = normalized.providers[15];
  assert.equal(proxyProvider.name, "proxy");
  assert.equal(proxyProvider.target, "🌍 国外代理");
  assert.deepEqual(proxyProvider.inputs.map((input) => input.sourceUrl), [
    "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/geolocation-!cn.yaml",
  ]);
  assert.equal(normalized.inputs.some((input) => input.name === "Loyalsoldier/clash-rules"), false);

  const aiRendered = renderYaml(aiProvider, []);
  assert.ok(aiRendered.includes("# Source 1 [VPSDance/ai-proxy-rules]:"));
  assert.ok(aiRendered.includes("# License 1 [VPSDance/ai-proxy-rules]: MIT (https://github.com/VPSDance/ai-proxy-rules/blob/main/LICENSE)"));
  assert.ok(aiRendered.includes("# Source 2 [boweic/ruleset.bowei.co]:"));
  assert.ok(aiRendered.includes("# License 2 [boweic/ruleset.bowei.co]: AGPL-3.0 (https://github.com/boweic/ruleset.bowei.co/blob/master/LICENSE)"));
  assert.ok(aiRendered.includes("# Source 3 [MetaCubeX/meta-rules-dat]:"));
  assert.ok(aiRendered.includes("# License 3 [MetaCubeX/meta-rules-dat]: GPL-3.0 (https://github.com/MetaCubeX/meta-rules-dat/blob/master/LICENSE)"));

  const googleRendered = renderYaml(googleProvider, []);
  assert.ok(googleRendered.includes("# Source 1 [MetaCubeX/meta-rules-dat]:"));
  assert.ok(googleRendered.includes("# Source 2 [MetaCubeX/meta-rules-dat]:"));

  const customDirectRendered = renderYaml(customDirectProvider, []);
  assert.ok(customDirectRendered.includes("# Source: https://github.com/yuanv4/clash-rules (https://raw.githubusercontent.com/yuanv4/clash-rules/main/custom/tag.txt)"));
  assert.ok(customDirectRendered.includes("# License: MIT (https://github.com/yuanv4/clash-rules)"));
  const proxyRendered = renderYaml(proxyProvider, []);
  assert.ok(proxyRendered.includes("# Source: https://github.com/MetaCubeX/meta-rules-dat (https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/geolocation-!cn.yaml)"));
  assert.ok(proxyRendered.includes("# License: GPL-3.0 (https://github.com/MetaCubeX/meta-rules-dat/blob/master/LICENSE)"));
});

test("merges inputs with first-occurrence canonical deduplication", () => {
  const merged = mergeRules([
    parseRules("DOMAIN,first.example\nIP-CIDR,192.0.2.0/24,no-resolve\n", sourceUrl),
    parseRules("DOMAIN,second.example\nDOMAIN,first.example\nIP-CIDR,192.0.2.0/24,no-resolve\n", sourceUrl),
  ]);
  assert.deepEqual(merged.map(serializeRule), [
    "DOMAIN,first.example",
    "IP-CIDR,192.0.2.0/24,no-resolve",
    "DOMAIN,second.example",
  ]);
});

test("fails closed for invalid input/provider references and metadata", () => {
  const invalidCases = [
    ["unknown root key", (config) => { config.extra = true; }],
    ["unknown input key", (config) => { config.inputs[0].extra = true; }],
    ["unknown provider key", (config) => { config.providers[0].extra = true; }],
    ["unknown input reference key", (config) => { config.providers[0].inputs[0].extra = true; }],
    ["unknown input reference", (config) => { config.providers[0].inputs[0].input = "missing"; }],
    ["duplicate input name", (config) => { config.inputs[1].name = config.inputs[0].name; }],
    ["duplicate provider name", (config) => { config.providers.push({ ...config.providers[0] }); }],
    ["unsafe path", (config) => { config.providers[0].inputs[0].path = "../outside.list"; }],
    ["unsupported format", (config) => { config.providers[0].inputs[0].input_format = "unknown"; }],
    ["malformed license", (config) => { delete config.inputs[0].license.url; }],
    ["missing no_resolve", (config) => { delete config.providers[0].no_resolve; }],
    ["non-boolean no_resolve", (config) => { config.providers[0].no_resolve = "true"; }],
    ["empty provider inputs", (config) => { config.providers[0].inputs = []; }],
  ];

  for (const [label, mutate] of invalidCases) {
    const config = structuredClone(makeConfig());
    mutate(config);
    assert.throws(() => normalizeConfiguration(config), undefined, label);
  }
});

test("rejects controls in every textual configuration field", () => {
  const invalidCases = [
    ["release URL", (config) => { config.release_base_url = "https://rules.example.test/\t"; }],
    ["proxy group", (config) => { config.proxy_group = "Nodes\r"; }],
    ["input name", (config) => { config.inputs[0].name = "first\ninput"; }],
    ["repository", (config) => { config.inputs[0].repository = "https://github.com/example/first\u0000"; }],
    ["base URL", (config) => { config.inputs[0].base_url = "https://raw.example.test/\r/"; }],
    ["license id", (config) => { config.inputs[0].license.id = "MIT\t"; }],
    ["license URL", (config) => { config.inputs[0].license.url = "https://example.test/LICENSE\n"; }],
    ["input format", (config) => { config.inputs[0].input_format = "raw-list\u0000"; }],
    ["provider name", (config) => { config.providers[0].name = "merged\t"; }],
    ["provider target", (config) => { config.providers[0].target = "DIRECT\n"; }],
    ["reference input", (config) => { config.providers[0].inputs[0].input = "first-input\r"; }],
    ["reference path", (config) => { config.providers[0].inputs[0].path = "rules/first\n.list"; }],
    ["reference format", (config) => { config.providers[0].inputs[0].input_format = "raw-list\u0000"; }],
  ];

  for (const [label, mutate] of invalidCases) {
    const config = structuredClone(makeConfig());
    mutate(config);
    assert.throws(() => normalizeConfiguration(config), /unsafe control|non-empty string/, label);
  }
});

test("rejects absolute, cross-origin, query, fragment, and encoded traversal paths", () => {
  const invalidPaths = [
    "/absolute.list",
    "https://evil.example/escape.list",
    "//evil.example/escape.list",
    "rules/%2e%2e/escape.list",
    "rules/%252e%252e/escape.list",
    "rules/%25252e%25252e/escape.list",
    "rules/first.list?download=1",
    "rules/first.list#fragment",
    "rules/first.list%3Fdownload=1",
    "rules/first.list%23fragment",
    "rules/first.list%253Fdownload=1",
    "rules/first.list%2523fragment",
  ];

  for (const invalidPath of invalidPaths) {
    const config = makeConfig();
    config.providers[0].inputs[0].path = invalidPath;
    assert.throws(() => normalizeConfiguration(config), /path|URL|origin|base/i, invalidPath);
  }
});

test("accepts ordinary percent-encoded paths and rejects over-limit nested encodings", () => {
  const validConfig = makeConfig();
  validConfig.providers[0].inputs[0].path = "rules/file%20name.list";
  const validProvider = normalizeConfiguration(validConfig).providers[0];
  assert.equal(
    validProvider.inputs[0].sourceUrl,
    "https://raw.githubusercontent.com/example/first-input/main/rules/file%20name.list"
  );

  let overLimitTraversal = "%2e%2e";
  for (let pass = 0; pass < 9; pass += 1) {
    overLimitTraversal = overLimitTraversal.replace(/%/gu, "%25");
  }
  const overLimitConfig = makeConfig();
  overLimitConfig.providers[0].inputs[0].path = `rules/${overLimitTraversal}/escape.list`;
  assert.throws(
    () => normalizeConfiguration(overLimitConfig),
    /encoding did not stabilize after/,
  );
});

test("renders automatic and Taiwan fallback proxy topology", async () => {
  const { renderSubstoreOverride } = await import("./render-substore-override.mjs");
  const providers = [
    { name: "lan_non_ip", target: "DIRECT", noResolve: true },
    { name: "reject_non_ip", target: "🛑 广告过滤", noResolve: true },
    { name: "ai_cn", target: "🤖 国内 AI", noResolve: true },
    { name: "ai", target: "🤖 国际 AI", noResolve: true },
    { name: "google", target: "🌐 Google", noResolve: true },
    { name: "netflix", target: "🎬 Netflix", noResolve: true },
    { name: "disney", target: "🎬 DisneyPlus", noResolve: true },
    { name: "telegram", target: "📲 电报信息", noResolve: true },
    { name: "steam", target: "💨 Steam商店", noResolve: true },
    { name: "microsoft", target: "Ⓜ️ 微软服务", noResolve: true },
    { name: "apple", target: "🍎 苹果服务", noResolve: true },
    { name: "media", target: "🌍 媒体服务", noResolve: true },
    { name: "custom_direct", target: "DIRECT", noResolve: true },
    { name: "proxy", target: "🌍 国外代理", noResolve: true },
  ];
  const proxyGroup = "♻️ 自动选择(香港)";
  const serviceGroups = ["🎬 Netflix", "🎬 DisneyPlus", "📲 电报信息", "💨 Steam商店", "Ⓜ️ 微软服务", "🍎 苹果服务", "🌍 媒体服务"];
  const script = renderSubstoreOverride(providers, "https://rules.example.test/release", proxyGroup);

  assert.match(script, /Hong Kong proxies/);
  assert.match(script, /MATCH,🐟 漏网之鱼/);

  const files = {
    "tailscale-secret": JSON.stringify({
      hostname: "flclash-android",
      "auth-key": "tskey-test",
      "control-url": "https://controlplane.tailscale.com",
      "state-dir": "./tailscale",
      ephemeral: false,
      udp: true,
      "accept-routes": true,
      "ip-version": "ipv4-prefer",
    }),
  };
  const makeEnv = (fileName) => ({
    produceArtifact: async ({ name }) => files[name],
    $file: { name: fileName },
  });
  const buildConfig = async (env, proxies) => {
    const fn = new Function("produceArtifact", "$file", `${script}\nreturn main;`)(env.produceArtifact, env.$file);
    return fn({ proxies: proxies.map((name) => ({ name })) });
  };
  const group = (config, name) => config["proxy-groups"].find((item) => item.name === name);

  const plain = await buildConfig(makeEnv("yuanv4"), ["🇭🇰 香港01", "🇲🇴 澳门01", "🇹🇼 台湾01", "🇯🇵 日本01", "US-West 01"]);
  assert.deepEqual(plain["proxy-groups"].map((item) => item.name), [
    "♻️ 自动选择(香港)", "🛟 故障转移(台湾)", "🌍 国外代理", "🐟 漏网之鱼", "Tailscale", "🤖 国内 AI", "🤖 国际 AI", "🌐 Google", ...serviceGroups, "🛑 广告过滤",
  ]);
  assert.deepEqual(plain.rules.slice(3, -1), [
    "RULE-SET,lan_non_ip,DIRECT,no-resolve",
    "RULE-SET,reject_non_ip,🛑 广告过滤,no-resolve",
    "RULE-SET,ai_cn,🤖 国内 AI,no-resolve",
    "RULE-SET,ai,🤖 国际 AI,no-resolve",
    "RULE-SET,google,🌐 Google,no-resolve",
    "RULE-SET,netflix,🎬 Netflix,no-resolve",
    "RULE-SET,disney,🎬 DisneyPlus,no-resolve",
    "RULE-SET,telegram,📲 电报信息,no-resolve",
    "RULE-SET,steam,💨 Steam商店,no-resolve",
    "RULE-SET,microsoft,Ⓜ️ 微软服务,no-resolve",
    "RULE-SET,apple,🍎 苹果服务,no-resolve",
    "RULE-SET,media,🌍 媒体服务,no-resolve",
    "RULE-SET,custom_direct,DIRECT,no-resolve",
    "RULE-SET,proxy,🌍 国外代理,no-resolve",
  ]);
  assert.ok(plain.rules.indexOf("RULE-SET,custom_direct,DIRECT,no-resolve") < plain.rules.indexOf("RULE-SET,proxy,🌍 国外代理,no-resolve"));
  assert.ok(plain.rules.indexOf("RULE-SET,proxy,🌍 国外代理,no-resolve") < plain.rules.indexOf("MATCH,🐟 漏网之鱼"));
  const automaticGroup = "♻️ 自动选择(香港)";
  assert.ok(!JSON.stringify(plain).includes("自动选择(东亚)"));
  const taiwanFallbackGroup = "🛟 故障转移(台湾)";
  const standardProxyChoices = ["DIRECT", "🌍 国外代理", automaticGroup, taiwanFallbackGroup];
  const foreignGroup = "🌍 国外代理";
  assert.ok(!JSON.stringify(plain).includes("节点选择(东亚)"));
  assert.ok(!JSON.stringify(plain).includes("负载均衡(台湾)"));
  assert.deepEqual(group(plain, taiwanFallbackGroup), {
    name: taiwanFallbackGroup,
    type: "fallback",
    url: "https://cp.cloudflare.com/generate_204",
    interval: 300,
    proxies: ["🇹🇼 台湾01"],
  });
  const taiwanNodes = ["🇹🇼 01", "台湾02", "台灣03", "台北04", "TW01", "tw-02", "TPE01", "Taiwan 01", "Taipei 02"];
  const mixed = await buildConfig(makeEnv("yuanv4"), [...taiwanNodes, "香港01", "日本01", "US-West 01", "Network 01"]);
  assert.deepEqual(group(mixed, taiwanFallbackGroup).proxies, taiwanNodes);
  // Flag-only names must match in Bun as well as Node (Unicode regex mode).
  const nonHongKongFlags = ["🇲🇴", "🇹🇼", "🇯🇵", "🇰🇷", "🇨🇳", "🇲🇳"];
  for (const flag of nonHongKongFlags) {
    const name = `${flag} 01`;
    const flagOnly = await buildConfig(makeEnv("yuanv4"), ["🇭🇰 01", name, "🇺🇸 01"]);
    assert.deepEqual(group(flagOnly, automaticGroup).proxies, ["🇭🇰 01"]);
    assert.deepEqual(group(flagOnly, taiwanFallbackGroup).proxies, flag === "🇹🇼" ? [name] : ["REJECT"]);
  }
  assert.deepEqual(group(plain, automaticGroup).proxies, [
    "🇭🇰 香港01",
  ]);
  const hongKongNodes = ["🇭🇰 01", "香港02", "港03", "HK01", "hk-02", "HKG01", "Hong Kong 01", "HongKong 02"];
  const hongKongMixed = await buildConfig(makeEnv("yuanv4"), [...hongKongNodes, "台湾01", "澳门01", "日本01", "US-West 01"]);
  assert.deepEqual(group(hongKongMixed, automaticGroup).proxies, hongKongNodes);
  assert.equal(group(plain, automaticGroup).interval, 300);
  assert.equal(group(plain, automaticGroup).tolerance, 50);
  assert.equal(group(plain, automaticGroup).type, "url-test");
  assert.equal(group(plain, automaticGroup).url, "https://cp.cloudflare.com/generate_204");
  for (const name of ["🤖 国内 AI", "🤖 国际 AI", ...serviceGroups]) {
    assert.deepEqual(group(plain, name).proxies, standardProxyChoices);
    assert.equal(group(plain, name)["default-selected"], name === "📲 电报信息" ? foreignGroup : "DIRECT");
  }
  assert.deepEqual(group(plain, "🌐 Google").proxies, standardProxyChoices);
  assert.equal(group(plain, "🌐 Google")["default-selected"], foreignGroup);
  assert.deepEqual(group(plain, foreignGroup), {
    name: foreignGroup,
    type: "select",
    proxies: [automaticGroup, taiwanFallbackGroup, "DIRECT"],
    "default-selected": automaticGroup,
  });
  assert.deepEqual(group(plain, "🛑 广告过滤").proxies, ["REJECT", "DIRECT"]);
  assert.equal(group(plain, "🛑 广告过滤")["default-selected"], "REJECT");
  assert.deepEqual(group(plain, "🐟 漏网之鱼").proxies, ["DIRECT", foreignGroup, automaticGroup, taiwanFallbackGroup]);
  assert.equal(group(plain, "🐟 漏网之鱼")["default-selected"], "DIRECT");
  const groupNames = new Set(plain["proxy-groups"].map((item) => item.name));
  const proxyNames = new Set(plain.proxies.map((item) => item.name));
  for (const proxy of plain["proxy-groups"].flatMap((item) => item.proxies)) {
    assert.ok(
      proxy === "DIRECT" || proxy === "REJECT" || groupNames.has(proxy) || proxyNames.has(proxy),
      `dangling proxy-group reference: ${proxy}`,
    );
  }
  assert.deepEqual(group(plain, "Tailscale").proxies, ["DIRECT"]);
  assert.equal(group(plain, "Tailscale")["default-selected"], "DIRECT");
  const expectedTailscaleRules = [
    "IP-CIDR,100.64.0.0/10,Tailscale,no-resolve",
    "IP-CIDR,100.100.100.100/32,Tailscale,no-resolve",
    "DOMAIN-SUFFIX,ts.net,Tailscale",
  ];
  assert.deepEqual(plain.rules.slice(0, 3), expectedTailscaleRules);
  assert.equal(plain.proxies.some((p) => p.name === "TAILSCALE"), false);
  assert.equal(plain.rules.at(-1), "MATCH,🐟 漏网之鱼");

  const singleNode = await buildConfig(makeEnv("yuanv4"), ["🇭🇰 香港01"]);
  assert.deepEqual(group(singleNode, automaticGroup).proxies, ["🇭🇰 香港01"]);
  assert.deepEqual(group(singleNode, taiwanFallbackGroup).proxies, ["REJECT"]);
  assert.deepEqual(group(singleNode, "Tailscale").proxies, ["DIRECT"]);

  await assert.rejects(
    () => buildConfig(makeEnv("yuanv4"), ["台湾01", "日本01", "澳门01", "US-West 01"]),
    /Subscription has no Hong Kong proxies/
  );
  await assert.rejects(
    () => buildConfig(makeEnv("yuanv4"), []),
    /Subscription has no proxies/
  );

  const withTs = await buildConfig(makeEnv("yuanv4-with-tailscale"), ["🇭🇰 香港01"]);
  assert.equal(withTs.proxies[0].name, "TAILSCALE");
  assert.deepEqual(group(withTs, taiwanFallbackGroup).proxies, ["REJECT"]);
  assert.deepEqual(group(withTs, "Tailscale").proxies, ["TAILSCALE", "DIRECT"]);
  assert.equal(group(withTs, "Tailscale")["default-selected"], "TAILSCALE");
  assert.deepEqual(withTs.rules.slice(0, 3), expectedTailscaleRules);
  assert.deepEqual(withTs.rules, plain.rules);
});
