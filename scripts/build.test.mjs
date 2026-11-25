import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  loadSource,
  mergeRules,
  normalizeConfiguration,
  parseRules,
  parseInputRules,
  renderDomainText,
  renderYaml,
  resolveInputFormat,
  serializeRule,
} from "./build.mjs";

const sourceUrl = "https://example.test/rules";

test("loads the checkout custom rules and merges them with remote rules", async () => {
  const config = JSON.parse(await readFile(new URL("../sources.json", import.meta.url), "utf8"));
  const provider = normalizeConfiguration(config).providers.find(({ name }) => name === "foreign_services");
  const custom = provider.inputs.at(-1);
  const text = await loadSource(custom, () => { throw new Error("custom source must not fetch"); });
  const remote = provider.inputs[0];
  const remoteText = await loadSource(remote, (url) => {
    assert.equal(url, remote.sourceUrl);
    return "payload:\n  - DOMAIN,remote.example\n  - DOMAIN,remote.example\n";
  });
  const rules = mergeRules([parseRules(remoteText, remote.sourceUrl, remote.inputFormat), parseRules(text, custom.sourceUrl, custom.inputFormat)]);
  assert.deepEqual(rules.map(serializeRule), ["DOMAIN,remote.example", "DOMAIN-SUFFIX,69shuba.com"]);
  const output = renderYaml(provider, rules);
  assert.ok(output.includes(custom.sourceUrl));
  assert.equal((output.match(/DOMAIN-SUFFIX,69shuba\.com/g) ?? []).length, 1);
  assert.ok(output.includes("DOMAIN,remote.example"));
});

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

test("parses Mihomo domain text with comments, CRLF, suffix markers, and deduplication", () => {
  const rules = parseRules(
    "# comment\r\nexample.com\r\n+.example.com\r\nexample.com\r\n// ignored\r\n",
    sourceUrl,
    "domain-text",
  );

  assert.deepEqual(rules, [
    { type: "DOMAIN-TEXT", value: "example.com", options: [] },
    { type: "DOMAIN-TEXT", value: "+.example.com", options: [] },
  ]);
});

test("rejects malformed Mihomo domain text lines", () => {
  for (const input of ["+.\n", "example .com\n", "example.com,other.com\n", "example.com\rbroken\n"]) {
    assert.throws(() => parseRules(input, sourceUrl, "domain-text"), /Invalid domain text rule|carriage return/);
  }
});

test("renders domain text without reinterpreting suffix markers", () => {
  const provider = {
    behavior: "domain",
    inputs: [{ sourceRepository: "https://github.com/example/rules", sourceUrl, license: { id: "MIT", url: "https://example.test/LICENSE" } }],
  };
  const rendered = renderDomainText(provider, parseRules("example.com\n+.example.com\n", sourceUrl, "domain-text"));
  assert.match(rendered, /\nexample\.com\n\+\.example\.com\n$/);
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
    /Invalid Clash YAML.*multiple documents/
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

test("filtered upstream inputs retain process and IP rules without shared domains", () => {
  const config = makeConfig();
  config.providers[0].inputs[0].include_rule_types = ["PROCESS-NAME", "IP-CIDR", "IP-CIDR6", "IP-ASN"];
  const input = normalizeConfiguration(config).providers[0].inputs[0];
  const text = "DOMAIN-SUFFIX,sentry.io\nDOMAIN-SUFFIX,auth0.com\nPROCESS-NAME,Claude\nIP-CIDR,160.79.104.0/21,no-resolve\nIP-CIDR6,2607:6bc0::/32,no-resolve\nIP-ASN,399358,no-resolve\n";
  assert.deepEqual(parseInputRules(text, input).map(serializeRule), [
    "PROCESS-NAME,Claude", "IP-CIDR,160.79.104.0/21,no-resolve",
    "IP-CIDR6,2607:6bc0::/32,no-resolve", "IP-ASN,399358,no-resolve",
  ]);
  const unfiltered = normalizeConfiguration(makeConfig()).providers[0].inputs[0];
  assert.equal(parseInputRules(text, unfiltered).length, 6);
  for (const invalid of [[], "PROCESS-NAME", ["UNKNOWN"], ["PROCESS-NAME", "PROCESS-NAME"], [null]]) {
    config.providers[0].inputs[0].include_rule_types = invalid;
    assert.throws(() => normalizeConfiguration(config), /include_rule_types/);
  }
  config.providers[0].inputs[0].include_rule_types = ["DOMAIN"];
  config.providers[0].inputs[0].input_format = "domain-text";
  assert.throws(() => normalizeConfiguration(config), /include_rule_types/);
});

test("normalizes merge-ready provider views and preserves ordered provenance", () => {
  const config = normalizeConfiguration(makeConfig());
  const provider = config.providers[0];
  assert.equal(config.proxyGroup, "🚀 Nodes");

  assert.deepEqual(provider.inputs.map((input) => input.inputFormat), ["raw-list", "raw-list"]);
  assert.equal(provider.behavior, "classical");
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

test("sources.json removes domestic AI routing while preserving provider provenance", async () => {
  const config = JSON.parse(await readFile(new URL("../sources.json", import.meta.url), "utf8"));
  const normalized = normalizeConfiguration(config);
  const providerNames = normalized.providers.map((provider) => provider.name);
  assert.equal(providerNames[0], "direct");
  assert.equal(providerNames.includes("proxy"), false);
  assert.deepEqual(providerNames, [
    "direct",
    "reject_domainset",
    "reject",
    "adult_content",
    "gemini",
    "anthropic",
    "ai",
    "streaming_services",
    "cn_services",
    "foreign_services",
  ]);
  for (const name of ["lan_non_ip", "lan_ip", "custom_direct"]) {
    assert.equal(providerNames.includes(name), false);
  }

  const directProvider = normalized.providers.find(({ name }) => name === "direct");
  assert.equal(directProvider.name, "direct");
  assert.equal(directProvider.target, "DIRECT");
  assert.equal(directProvider.behavior, "classical");
  assert.equal(directProvider.noResolve, true);
  assert.deepEqual(directProvider.inputs.map((input) => input.sourceUrl), [
    "https://raw.githubusercontent.com/SukkaLab/ruleset.skk.moe/master/Clash/non_ip/lan.txt",
    "https://raw.githubusercontent.com/SukkaLab/ruleset.skk.moe/master/Clash/ip/lan.txt",
  ]);
  assert.deepEqual(directProvider.inputs.map((input) => input.inputFormat), ["raw-list", "raw-list"]);
  for (const name of ["google", "telegram", "steam", "microsoft", "apple"]) {
    assert.equal(providerNames.includes(name), false);
  }

  const rejectDomainProvider = normalized.providers.find(({ name }) => name === "reject_domainset");
  const rejectProvider = normalized.providers.find(({ name }) => name === "reject");
  assert.equal(rejectDomainProvider.target, "🛑 广告过滤");
  assert.equal(rejectDomainProvider.behavior, "domain");
  assert.deepEqual(rejectDomainProvider.inputs.map((input) => input.inputFormat), ["domain-text"]);
  assert.equal(rejectDomainProvider.inputs[0].sourceUrl, "https://raw.githubusercontent.com/SukkaLab/ruleset.skk.moe/master/Clash/domainset/reject.txt");
  assert.equal(rejectProvider.name, "reject");
  assert.equal(rejectProvider.target, "🛑 广告过滤");
  assert.equal(rejectProvider.behavior, "classical");
  assert.equal(rejectProvider.noResolve, true);
  assert.deepEqual(rejectProvider.inputs.map((input) => input.sourceUrl), [
    "https://raw.githubusercontent.com/SukkaLab/ruleset.skk.moe/master/Clash/non_ip/reject.txt",
    "https://raw.githubusercontent.com/TG-Twilight/AWAvenue-Ads-Rule/main/Filters/AWAvenue-Ads-Rule-Clash-Classical-Only.Ads.yaml",
    "https://raw.githubusercontent.com/SukkaLab/ruleset.skk.moe/master/Clash/ip/reject.txt",
  ]);
  assert.deepEqual(rejectProvider.inputs.map((input) => input.inputFormat), ["raw-list", "clash-yaml", "raw-list"]);
  assert.equal(providerNames.includes("reject_non_ip"), false);
  assert.equal(providerNames.includes("reject_ip"), false);

  const adultContentProvider = normalized.providers.find(({ name }) => name === "adult_content");
  assert.equal(adultContentProvider.target, "🔞 成人内容");
  assert.equal(adultContentProvider.behavior, "classical");
  assert.equal(adultContentProvider.noResolve, true);
  assert.deepEqual(adultContentProvider.inputs.map((input) => input.sourceUrl), [
    "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/category-porn.yaml",
  ]);
  assert.deepEqual(adultContentProvider.inputs.map((input) => input.inputFormat), ["clash-yaml"]);

  const geminiProvider = normalized.providers.find(({ name }) => name === "gemini");
  assert.equal(geminiProvider.target, "✨ Gemini");
  assert.equal(geminiProvider.noResolve, true);
  assert.deepEqual(geminiProvider.inputs.map((input) => input.sourceUrl), [
    "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/google-gemini.yaml",
    "https://raw.githubusercontent.com/VPSDance/ai-proxy-rules/main/rules/clash/google-ai.yaml",
  ]);
  assert.deepEqual(geminiProvider.inputs.map((input) => input.inputFormat), ["clash-yaml", "clash-yaml"]);
  assert.deepEqual(geminiProvider.inputs.map((input) => input.license.id), ["GPL-3.0", "MIT"]);

  for (const [name, target, upstream] of [
    ["anthropic", "Anthropic", "anthropic"],
  ]) {
    const provider = normalized.providers.find((provider) => provider.name === name);
    assert.equal(provider.target, target);
    assert.equal(provider.noResolve, true);
    assert.deepEqual(provider.inputs.map((input) => input.sourceUrl), [
      `https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/${upstream}.yaml`,
      `https://raw.githubusercontent.com/VPSDance/ai-proxy-rules/main/rules/clash/${upstream}.yaml`,
    ]);
    assert.deepEqual(provider.inputs.map((input) => input.inputFormat), ["clash-yaml", "clash-yaml"]);
    assert.deepEqual(provider.inputs[1].includeRuleTypes, ["PROCESS-NAME", "IP-CIDR", "IP-CIDR6", "IP-ASN"]);
    assert.equal(provider.inputs[0].license.id, "GPL-3.0");
    assert.equal(provider.inputs[1].license.id, "MIT");
  }

  const aiProvider = normalized.providers.find(({ name }) => name === "ai");
  assert.equal(aiProvider.target, "🤖 通用 AI");
  assert.equal(providerNames.includes("openai"), false);
  assert.deepEqual(aiProvider.inputs.map((input) => input.sourceUrl), [
    "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/openai.yaml",
    "https://raw.githubusercontent.com/VPSDance/ai-proxy-rules/main/rules/clash/openai.yaml",
    "https://raw.githubusercontent.com/VPSDance/ai-proxy-rules/main/rules/clash/global.yaml",
    "https://raw.githubusercontent.com/SukkaLab/ruleset.skk.moe/master/Clash/non_ip/apple_intelligence.txt",
    "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/category-ai-!cn.yaml",
  ]);
  assert.deepEqual(aiProvider.inputs.map((input) => input.inputFormat), ["clash-yaml", "clash-yaml", "clash-yaml", "raw-list", "clash-yaml"]);
  assert.deepEqual(aiProvider.inputs[1].includeRuleTypes, ["PROCESS-NAME", "IP-CIDR", "IP-CIDR6", "IP-ASN"]);

  const domesticProvider = normalized.providers.find(({ name }) => name === "cn_services");
  assert.equal(domesticProvider.name, "cn_services");
  assert.equal(domesticProvider.target, "🇨🇳 国内服务");
  assert.equal(domesticProvider.noResolve, true);
  assert.deepEqual(domesticProvider.inputs.map((input) => input.sourceUrl), [
    "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/apple-cn.yaml",
    "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/microsoft@cn.yaml",
    "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/steam@cn.yaml",
    "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/category-games@cn.yaml",
  ]);
  assert.deepEqual(domesticProvider.inputs.map((input) => input.inputFormat), ["clash-yaml", "clash-yaml", "clash-yaml", "clash-yaml"]);

  assert.equal(providerNames.includes("dev_services"), false);

  const streamingProvider = normalized.providers.find(({ name }) => name === "streaming_services");
  assert.equal(streamingProvider.name, "streaming_services");
  assert.equal(streamingProvider.target, "🎬 流媒体服务");
  assert.equal(streamingProvider.noResolve, true);
  assert.deepEqual(streamingProvider.inputs.map((input) => input.sourceUrl), [
    "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/netflix.yaml",
    "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geoip/netflix.yaml",
    "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/disney.yaml",
    "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/category-media.yaml",
  ]);
  assert.deepEqual(streamingProvider.inputs.map((input) => input.inputFormat), [
    "clash-yaml", "clash-yaml", "clash-yaml", "clash-yaml",
  ]);
  for (const name of ["netflix", "disney", "media"]) {
    assert.equal(providerNames.includes(name), false);
  }

  const foreignServicesProvider = normalized.providers.find(({ name }) => name === "foreign_services");
  assert.equal(foreignServicesProvider.name, "foreign_services");
  assert.equal(foreignServicesProvider.target, "🌐 国外服务");
  assert.equal(foreignServicesProvider.noResolve, true);
  assert.equal(normalized.providers.filter((provider) => provider.target === "🌐 国外服务").length, 1);
  assert.deepEqual(foreignServicesProvider.inputs.map((input) => input.sourceUrl), [
    "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/google.yaml",
    "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geoip/google.yaml",
    "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/telegram.yaml",
    "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geoip/telegram.yaml",
    "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/steam.yaml",
    "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/microsoft.yaml",
    "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/apple.yaml",
    "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/geolocation-!cn.yaml",
    "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/category-dev.yaml",
    "https://raw.githubusercontent.com/yuanv4/clash-rules/release/custom/foreign.txt",
  ]);
  assert.deepEqual(foreignServicesProvider.inputs.map((input) => input.inputFormat), [
    "clash-yaml", "clash-yaml", "clash-yaml", "clash-yaml", "clash-yaml", "clash-yaml", "clash-yaml", "clash-yaml", "clash-yaml", "raw-list",
  ]);
  assert.equal(foreignServicesProvider.inputs.at(-1).sourceRepository, "https://github.com/yuanv4/clash-rules");
  assert.equal(foreignServicesProvider.inputs.at(-1).license.id, "MIT");
  assert.equal(foreignServicesProvider.inputs.at(-1).license.url, "https://spdx.org/licenses/MIT.html");

  assert.equal(config.inputs.some((input) => input.name === "Loyalsoldier/clash-rules"), false);

  const rejectRendered = renderYaml(rejectProvider, []);
  assert.ok(rejectRendered.includes("# Source 1 [SukkaLab/ruleset.skk.moe]:"));
  assert.ok(rejectRendered.includes("# Source 2 [TG-Twilight/AWAvenue-Ads-Rule]:"));
  assert.ok(rejectRendered.includes("# Source 3 [SukkaLab/ruleset.skk.moe]:"));
  assert.ok(rejectRendered.includes("# License 2 [TG-Twilight/AWAvenue-Ads-Rule]: GPL-3.0 (https://github.com/TG-Twilight/AWAvenue-Ads-Rule/blob/main/LICENSE)"));

  const aiRendered = renderYaml(aiProvider, []);
  for (const [index, input] of aiProvider.inputs.entries()) {
    assert.ok(aiRendered.includes(`# Source ${index + 1} [${input.inputName}]: ${input.sourceRepository} (${input.sourceUrl})`));
    assert.ok(aiRendered.includes(`# License ${index + 1} [${input.inputName}]: ${input.license.id} (${input.license.url})`));
  }

  const directRendered = renderYaml(directProvider, []);
  assert.ok(directRendered.includes("# Source 1 [SukkaLab/ruleset.skk.moe]:"));
  assert.ok(directRendered.includes("# Source 2 [SukkaLab/ruleset.skk.moe]:"));
  const foreignServicesRendered = renderYaml(foreignServicesProvider, []);
  assert.ok(foreignServicesRendered.includes("# Source 1 [MetaCubeX/meta-rules-dat]:"));
  assert.ok(foreignServicesRendered.includes("# Source 8 [MetaCubeX/meta-rules-dat]:"));
  assert.ok(foreignServicesRendered.includes("geo/geosite/geolocation-!cn.yaml"));
  assert.ok(foreignServicesRendered.includes("# Source 10 [yuanv4/clash-rules]: https://github.com/yuanv4/clash-rules (https://raw.githubusercontent.com/yuanv4/clash-rules/release/custom/foreign.txt)"));
  assert.ok(foreignServicesRendered.includes("# License 10 [yuanv4/clash-rules]: MIT (https://spdx.org/licenses/MIT.html)"));
});

test("merges inputs with first-occurrence canonical deduplication", () => {
  const merged = mergeRules([
    parseRules("DOMAIN,first.example\nDOMAIN-SUFFIX,shared.example\nDOMAIN-KEYWORD,ads\nIP-CIDR,192.0.2.0/24,no-resolve\n", sourceUrl),
    parseRules("DOMAIN,second.example\nDOMAIN-SUFFIX,shared.example\nDOMAIN-KEYWORD,ads\nIP-CIDR,192.0.2.0/24,no-resolve\n", sourceUrl),
  ]);
  assert.deepEqual(merged.map(serializeRule), [
    "DOMAIN,first.example",
    "DOMAIN-SUFFIX,shared.example",
    "DOMAIN-KEYWORD,ads",
    "IP-CIDR,192.0.2.0/24,no-resolve",
    "DOMAIN,second.example",
  ]);
  assert.equal(merged[1].type, "DOMAIN-SUFFIX");
  assert.equal(merged[2].type, "DOMAIN-KEYWORD");
});

test("validates domain provider behavior and preserves classical defaults", () => {
  const domainConfig = makeConfig();
  domainConfig.providers[0].behavior = "domain";
  for (const input of domainConfig.providers[0].inputs) {
    input.input_format = "domain-text";
  }
  const provider = normalizeConfiguration(domainConfig).providers[0];
  assert.equal(provider.behavior, "domain");
  assert.equal(provider.inputs[0].inputFormat, "domain-text");

  const mixedConfig = makeConfig();
  mixedConfig.providers[0].behavior = "domain";
  assert.throws(() => normalizeConfiguration(mixedConfig), /requires domain-text/);

  const invalidBehaviorConfig = makeConfig();
  invalidBehaviorConfig.providers[0].behavior = "classical-text";
  assert.throws(() => normalizeConfiguration(invalidBehaviorConfig), /classical or domain/);
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