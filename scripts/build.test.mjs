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

test("sources.json keeps the AI split and ordered provenance", async () => {
  const config = await Bun.file(new URL("../sources.json", import.meta.url)).json();
  const normalized = normalizeConfiguration(config);
  const providerNames = normalized.providers.map((provider) => provider.name);
  assert.deepEqual(providerNames, [
    "lan_non_ip",
    "lan_ip",
    "reject_non_ip",
    "reject_ip",
    "ai_cn",
    "ai",
    "direct",
    "tag",
  ]);

  const domesticAiProvider = normalized.providers[4];
  assert.equal(domesticAiProvider.target, "🤖 国内 AI");
  assert.deepEqual(domesticAiProvider.inputs.map((input) => input.sourceUrl), [
    "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/category-ai-cn.yaml",
  ]);
  assert.deepEqual(domesticAiProvider.inputs.map((input) => input.inputFormat), ["clash-yaml"]);

  const aiProvider = normalized.providers[5];
  assert.equal(aiProvider.target, "🤖 国外 AI");
  assert.deepEqual(aiProvider.inputs.map((input) => input.sourceUrl), [
    "https://raw.githubusercontent.com/VPSDance/ai-proxy-rules/main/rules/clash/global.yaml",
    "https://raw.githubusercontent.com/boweic/ruleset.bowei.co/master/Clash/non_ip/apple_intelligence.txt",
    "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/category-ai-!cn.yaml",
  ]);
  assert.deepEqual(aiProvider.inputs.map((input) => input.inputFormat), ["clash-yaml", "raw-list", "clash-yaml"]);

  const directProvider = normalized.providers[6];
  assert.deepEqual(directProvider.inputs.map((input) => input.sourceUrl), [
    "https://raw.githubusercontent.com/Loyalsoldier/clash-rules/release/direct.txt",
    "https://raw.githubusercontent.com/Loyalsoldier/clash-rules/release/cncidr.txt",
    "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/cn.yaml",
    "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geoip/cn.yaml",
  ]);

  const tagProvider = normalized.providers[7];
  assert.equal(tagProvider.target, "🌐 国内");
  assert.equal(tagProvider.noResolve, true);
  assert.deepEqual(tagProvider.inputs.map((input) => input.sourceUrl), [
    "https://raw.githubusercontent.com/yuanv4/clash-rules/main/custom/tag.txt",
  ]);
  const tagRendered = renderYaml(tagProvider, []);
  assert.ok(tagRendered.includes("# Source: https://github.com/yuanv4/clash-rules (https://raw.githubusercontent.com/yuanv4/clash-rules/main/custom/tag.txt)"));
  assert.ok(tagRendered.includes("# License: MIT (https://github.com/yuanv4/clash-rules)"));

  const aiRendered = renderYaml(aiProvider, []);
  assert.ok(aiRendered.includes("# Source 1 [VPSDance/ai-proxy-rules]:"));
  assert.ok(aiRendered.includes("# License 1 [VPSDance/ai-proxy-rules]: MIT (https://github.com/VPSDance/ai-proxy-rules/blob/main/LICENSE)"));
  assert.ok(aiRendered.includes("# Source 2 [boweic/ruleset.bowei.co]:"));
  assert.ok(aiRendered.includes("# License 2 [boweic/ruleset.bowei.co]: AGPL-3.0 (https://github.com/boweic/ruleset.bowei.co/blob/master/LICENSE)"));
  assert.ok(aiRendered.includes("# Source 3 [MetaCubeX/meta-rules-dat]:"));
  assert.ok(aiRendered.includes("# License 3 [MetaCubeX/meta-rules-dat]: GPL-3.0 (https://github.com/MetaCubeX/meta-rules-dat/blob/master/LICENSE)"));

  const directRendered = renderYaml(directProvider, []);
  assert.ok(directRendered.includes("# Source 1 [Loyalsoldier/clash-rules]:"));
  assert.ok(directRendered.includes("# Source 2 [Loyalsoldier/clash-rules]:"));
  assert.ok(directRendered.includes("# Source 3 [MetaCubeX/meta-rules-dat]:"));
  assert.ok(directRendered.includes("# License 4 [MetaCubeX/meta-rules-dat]: GPL-3.0 (https://github.com/MetaCubeX/meta-rules-dat/blob/master/LICENSE)"));
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

test("renders a sub-store override with regional auto-selection groups and generated rules", async () => {
  const { renderSubstoreOverride } = await import("./render-substore-override.mjs");
  const providers = [
    { name: "ai_cn", target: "🤖 国内 AI", noResolve: true },
    { name: "ai", target: "🤖 国外 AI", noResolve: true },
  ];
  const releaseBaseUrl = "https://raw.githubusercontent.com/yuanv4/clash-rules/release";
  const proxyGroup = "🚀 节点选择";
  const script = renderSubstoreOverride(providers, releaseBaseUrl, proxyGroup);

  assert.match(script, /async function main\(config = \{\}\)/);
  assert.match(script, /\(?:HK\|HKG\|Hong Kong\|香港\|🇭🇰\)/i);
  assert.match(script, /\(?:JP\|JPN\|Japan\|日本\|🇯🇵\)/i);
  assert.match(script, /\(?:SG\|SGP\|Singapore\|新加坡\|🇸🇬\)/i);
  assert.match(script, /US\(\?: \|-\|_\)\?\(\?:West\|W\)/i);
  assert.doesNotMatch(script, /cloud-hk-node/);
  assert.match(script, /produceArtifact\(\{ type: 'file', name: 'tailscale-secret' \}\)/);
  assert.match(script, /config\['rule-providers'\] = \{"ai_cn":\{"type":"http"/);
  assert.match(script, /RULE-SET,ai_cn,🤖 国内 AI,no-resolve/);
  assert.match(script, /RULE-SET,ai,🤖 国外 AI,no-resolve/);
  assert.match(script, /MATCH,🐟 漏网之鱼/);

  // 沙箱执行:模拟 sub-store 运行时环境
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
    const fn = new Function(
      "produceArtifact",
      "$file",
      `${script}\nreturn main;`,
    )(env.produceArtifact, env.$file);
    return fn({
      proxies: proxies.map((name) => ({ name })),
    });
  };

  const plain = await buildConfig(makeEnv("yuanv4"), [
    { name: "🇭🇰 香港01" },
    { name: "🇯🇵 日本01" },
    { name: "🇸🇬 新加坡01" },
    { name: "US-West 01" },
    { name: "Los Angeles 01" },
    { name: "🇺🇸 美国东部01" },
  ].map((p) => p.name));
  const regionalGroup = (name) => plain["proxy-groups"].find((g) => g.name === name).proxies;
  assert.deepEqual(regionalGroup("🇭🇰 香港"), ["🇭🇰 香港01"]);
  assert.deepEqual(regionalGroup("🇯🇵 日本"), ["🇯🇵 日本01"]);
  assert.deepEqual(regionalGroup("🇸🇬 新加坡"), ["🇸🇬 新加坡01"]);
  assert.deepEqual(regionalGroup("🇺🇸 美西"), ["US-West 01", "Los Angeles 01"]);
  assert.deepEqual(regionalGroup("🤖 国内 AI"), ["DIRECT"]);
  assert.deepEqual(regionalGroup("🤖 国外 AI"), ["🇸🇬 新加坡", "⚡ 自动选择", "🇭🇰 香港", "🇯🇵 日本", "🇺🇸 美西"]);
  assert.deepEqual(regionalGroup(proxyGroup), ["⚡ 自动选择", "🇭🇰 香港", "🇯🇵 日本", "🇸🇬 新加坡", "🇺🇸 美西"]);
  assert.deepEqual(regionalGroup("🌐 国内"), ["DIRECT"]);
  assert.deepEqual(regionalGroup("🐟 漏网之鱼"), ["⚡ 自动选择"]);
  assert.equal(plain.mode, "Rule");
  assert.ok(!plain["proxy-groups"].some((g) => g.name === "Tailscale"));
  assert.equal(plain.rules[0], "RULE-SET,ai_cn,🤖 国内 AI,no-resolve");
  assert.equal(plain.rules[1], "RULE-SET,ai,🤖 国外 AI,no-resolve");
  assert.ok(!plain.proxies.some((p) => p && p.name === "TAILSCALE"), "plain subscription must not contain the TAILSCALE node");
  assert.deepEqual(plain.proxies.map((p) => p.name), ["🇭🇰 香港01", "🇯🇵 日本01", "🇸🇬 新加坡01", "US-West 01", "Los Angeles 01", "🇺🇸 美国东部01"]);

  const withTs = await buildConfig(makeEnv("yuanv4-with-tailscale"), ["🇸🇬 新加坡01"]);
  assert.equal(withTs.proxies[0].name, "TAILSCALE");
  assert.equal(withTs["proxy-groups"][0].name, "Tailscale");
  assert.deepEqual(withTs["proxy-groups"][0].proxies, ["TAILSCALE"]);
  assert.match(withTs.rules[0], /IP-CIDR,100\.64\.0\.0\/10,Tailscale,no-resolve/);
  assert.ok(!withTs["proxy-groups"].some((g) => g.name === "🇭🇰 香港"));
  assert.deepEqual(withTs["proxy-groups"].find((g) => g.name === "🇸🇬 新加坡").proxies, ["🇸🇬 新加坡01"]);
});

