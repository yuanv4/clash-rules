import { parse as parseYaml } from "yaml";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { renderProfile } from "./render-flclash-profile.mjs";
import worker from "../worker/clash-profile.js";

const source = JSON.parse(await readFile(new URL("../sources.json", import.meta.url), "utf8"));
const fakeKey = "tskey-auth-FAKE_TEST_ONLY";
const subscriptions = { remote: "https://example.test/sub?token=FAKE", local: ['- {name: "Test node", type: ss, server: example.test, port: 443, cipher: aes-128-gcm, password: FAKE}'] };
const template = (input = subscriptions, config = source) => renderProfile(config, JSON.stringify(input));
const request = async (query = "", profile = template(), overrides = {}, pathname = "/s/fake") => {
  const env = { SECRET_PATH: "/s/fake", PROFILE_KV: { get: async (key) => { assert.equal(key, "profile.yaml"); return profile; } }, ...overrides };
  return worker.fetch(new Request(`https://example.test${pathname}${query}`), env);
};
const parsedResponse = async (...args) => {
  const response = await request(...args);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  return parseYaml(await response.text());
};

for (const [mode, names] of Object.entries({ off: [], interface: ["TAILSCALE-DIRECT"], tsnet: ["TAILSCALE"], both: ["TAILSCALE-DIRECT", "TAILSCALE"] })) {
  test(`renderer to Worker YAML: ${mode}`, async () => {
    const config = await parsedResponse(`?ts=${mode}&tskey=${fakeKey}&iface=Fake0`);
    assert.deepEqual(config.proxies.map((p) => p.name), ["Test node", ...names]);
    const group = config["proxy-groups"].find((g) => g.name === "Tailscale");
    assert.deepEqual(group.proxies, [...names, "DIRECT"]);
    assert.equal(group["default-selected"], names[0] || "DIRECT");
    if (names.includes("TAILSCALE")) assert.equal(config.proxies.find((p) => p.name === "TAILSCALE")["auth-key"], fakeKey);
    if (names.includes("TAILSCALE-DIRECT")) assert.equal(config.proxies.find((p) => p.name === "TAILSCALE-DIRECT")["interface-name"], "Fake0");
    assert.equal(config["proxy-providers"].remote.url, subscriptions.remote);
    assert.ok(!config["proxy-groups"].some((group) => group.name === "🧑‍💻 开发服务"));
    assert.ok(!Object.hasOwn(config["rule-providers"], "dev_services"));
    assert.ok(!config.rules.some((rule) => rule.includes("dev_services") || rule.includes("🧑‍💻 开发服务")));
    assert.ok(config.rules.includes("RULE-SET,foreign_services,🌐 国外服务,no-resolve"));
    for (const rule of config.rules.filter((r) => r.startsWith("RULE-SET,"))) assert.ok(Object.hasOwn(config["rule-providers"], rule.split(",")[1]));
  });
}

test("proxy groups follow rule priority and merge repeated targets", async () => {
  const config = await parsedResponse();
  assert.deepEqual(config["proxy-groups"].map(({ name }) => name), [
    source.proxy_group, "Tailscale", "🛑 广告过滤", "🔞 成人内容", "✨ Gemini",
    "OpenAI", "Anthropic", "🤖 国际 AI", "🎬 流媒体服务", "🇨🇳 国内服务", "🌐 国外服务", "🐟 漏网之鱼",
  ]);
  const reorderedSource = {
    ...source,
    providers: [
      source.providers.find(({ name }) => name === "foreign_services"),
      ...source.providers.filter(({ name }) => name !== "foreign_services"),
    ],
  };
  const reordered = await parsedResponse("", template(subscriptions, reorderedSource));
  assert.deepEqual(reordered["proxy-groups"].map(({ name }) => name), [
    source.proxy_group, "Tailscale", "🌐 国外服务", "🛑 广告过滤", "🔞 成人内容", "✨ Gemini",
    "OpenAI", "Anthropic", "🤖 国际 AI", "🎬 流媒体服务", "🇨🇳 国内服务", "🐟 漏网之鱼",
  ]);
});

test("remote-only and static-only output remain valid", async () => {
  assert.deepEqual((await parsedResponse("", template({ remote: subscriptions.remote }))).proxies, []);
  assert.equal((await parsedResponse("", template({ local: subscriptions.local }))).proxies.length, 1);
});

test("object entries: custom interval, nodes alias, and disabled airports", async () => {
  const manualUrl = "https://example.test/manual?token=FAKE";
  const config = await parsedResponse("", template({
    manual: { url: manualUrl, interval: 0 },
    snapshot: { nodes: subscriptions.local },
    disabled: { url: "https://example.test/disabled?token=FAKE", enable: false },
    "disabled-nodes": { nodes: ["not a node"], enable: false },
  }));
  assert.deepEqual(Object.keys(config["proxy-providers"]), ["manual"]);
  assert.equal(config["proxy-providers"].manual.url, manualUrl);
  assert.equal(config["proxy-providers"].manual.interval, 0);
  assert.deepEqual(config.proxies.map((p) => p.name), ["Test node"]);
});

test("object entries reject structural and content errors", () => {
  const validUrl = "https://example.test/sub?token=FAKE";
  for (const [input, pattern] of [
    [{ bad: { url: validUrl, nodes: subscriptions.local } }, /exactly one of/],
    [{ bad: {} }, /exactly one of/],
    [{ bad: { url: 1 } }, /field "url" must be a string/],
    [{ bad: { nodes: "x" } }, /field "nodes" must be an array/],
    [{ bad: { url: "ftp://example.test" } }, /http\(s\) URL/],
    [{ bad: { url: validUrl, interval: -1 } }, /non-negative integer/],
    [{ bad: { url: validUrl, interval: 1.5 } }, /non-negative integer/],
    [{ bad: { nodes: subscriptions.local, interval: 60 } }, /cannot set "interval"/],
    [{ bad: { url: validUrl, enable: "no" } }, /non-boolean "enable"/],
    [{ bad: { url: validUrl, typo: 1 } }, /unknown field "typo"/],
    [{ bad: { nodes: [] } }, /empty array/],
  ]) {
    assert.throws(() => template(input), pattern);
  }
  assert.throws(
    () => template({ off: { url: validUrl, enable: false } }),
    /no enabled providers/
  );
});

test("manual node selection group is absent and no group references it", async () => {
  const groups = (await parsedResponse())["proxy-groups"];
  assert.ok(!groups.some((group) => group.name === "🚀 节点选择"));
  for (const group of groups) assert.ok(!group.proxies?.includes("🚀 节点选择"));
});

test("all AI groups share United States, Japan, and Singapore candidates", async () => {
  const config = await parsedResponse();
  const group = config["proxy-groups"].find((g) => g.name === "🤖 国际 AI");
  for (const name of ["✨ Gemini", "OpenAI", "Anthropic"]) {
    const dedicated = config["proxy-groups"].find((g) => g.name === name);
    assert.equal(group.filter, dedicated.filter);
    assert.equal(group["exclude-filter"], dedicated["exclude-filter"]);
    assert.equal(dedicated["empty-fallback"], "REJECT");
  }
  assert.equal(group.type, "url-test");
  assert.equal(group["empty-fallback"], "REJECT");
  const region = new RegExp(group.filter.replace(/^\(\?i\)/, ""), "i");
  const exclude = new RegExp(group["exclude-filter"].replace(/^\(\?i\)/, ""), "i");
  const selected = (name) => region.test(name) && !exclude.test(name);
  for (const name of [
    "美国 01", "US01", "USA-02", "🇺🇸 03", "日本 04", "JP05", "🇯🇵 06",
    "新加坡 06", "狮城 07", "SG-08", "SGP 09", "Singapore 10", "🇸🇬 11",
  ]) {
    assert.ok(selected(name), `expected ${name} in AI group`);
  }
  for (const name of ["香港 01", "HK-02", "澳门 03", "US01-HK01", "SG01-MO02", "HK01-US", "MO01-US", "HKG01-JP01", "MAC01 JP01", "日本 HK01", "台湾 01", "台灣 02", "台北 03", "TW-04", "TWN05", "Taiwan 06", "🇹🇼 07", "剩余流量", "Trusted", "AUS01", "US 剩余流量", "TAILSCALE", "TAILSCALE-DIRECT"]) {
    assert.equal(selected(name), false, `expected ${name} not in AI group`);
  }
});

test("Gemini uses upstream rules before general AI and pins a regional node", async () => {
  const config = await parsedResponse();
  const group = config["proxy-groups"].find((g) => g.name === "✨ Gemini");
  assert.equal(group.type, "select");
  assert.equal(group["include-all"], true);
  assert.equal(group["empty-fallback"], "REJECT");
  assert.equal(group.url, "https://gemini.google.com/app");
  const rule = "RULE-SET,gemini,✨ Gemini,no-resolve";
  assert.ok(config.rules.includes(rule));
  assert.ok(config.rules.indexOf(rule) < config.rules.indexOf("RULE-SET,ai,🤖 国际 AI,no-resolve"));
  assert.ok(config.rules.indexOf(rule) < config.rules.indexOf("RULE-SET,foreign_services,🌐 国外服务,no-resolve"));
  assert.equal(config["rule-providers"].gemini.url, `${source.release_base_url}/rules/gemini.yaml`);
});

test("OpenAI selects automatically and Anthropic pins a node before general AI routing", async () => {
  const config = await parsedResponse();
  for (const [name, provider, type, url] of [
    ["OpenAI", "openai", "url-test", "https://chatgpt.com/"],
    ["Anthropic", "anthropic", "select", "https://claude.ai/"],
  ]) {
    const group = config["proxy-groups"].find((group) => group.name === name);
    assert.equal(group.type, type);
    assert.equal(group.url, url);
    assert.equal(group["include-all"], true);
    if (type === "select") assert.equal(group["empty-fallback"], "REJECT");
    const ruleIndex = config.rules.indexOf(`RULE-SET,${provider},${name},no-resolve`);
    assert.ok(ruleIndex >= 0);
    assert.ok(ruleIndex < config.rules.indexOf("RULE-SET,ai,🤖 国际 AI,no-resolve"));
    assert.ok(ruleIndex < config.rules.indexOf("RULE-SET,foreign_services,🌐 国外服务,no-resolve"));
    assert.equal(config["rule-providers"][provider].url, `${source.release_base_url}/rules/${provider}.yaml`);
  }
});

test("auth key comes from the subscription URL and errors otherwise", async () => {
  for (const [query, expected] of [
    [`?ts=tsnet&tskey=${fakeKey}&tailscale-secret=tskey-auth-ALIAS_FAKE`, fakeKey],
    ["?ts=tsnet&tailscale-secret=tskey-auth-ALIAS_FAKE", "tskey-auth-ALIAS_FAKE"],
  ]) {
    const config = await parsedResponse(query, template());
    assert.equal(config.proxies.at(-1)["auth-key"], expected);
  }
  for (const query of ["?ts=tsnet", "?ts=both", "?ts=bad", "?ts=tsnet&tskey=invalid"]) assert.equal((await request(query)).status, 400);
});

test("iface validation is restricted to interface and both", async () => {
  for (const mode of ["off", "tsnet"]) assert.equal((await request(`?ts=${mode}&iface=%E7%BD%91%E5%8D%A1&tskey=${fakeKey}`, template())).status, 200);
  for (const mode of ["interface", "both"]) assert.equal((await request(`?ts=${mode}&iface=bad!&tskey=${fakeKey}`)).status, 400);
});

test("path gate precedes KV access and missing profile returns 404", async () => {
  assert.equal((await request("", template(), { PROFILE_KV: { get: () => { throw new Error("must not read"); } } }, "/wrong")).status, 404);
  assert.equal((await request("", null)).status, 404);
});

test("provider keys preserve YAML null and Null spellings and rule references", async () => {
  const config = await parsedResponse("", template({ null: subscriptions.remote, Null: subscriptions.remote }, { ...source, providers: [{ name: "null", target: "DIRECT" }, { name: "Null", target: "DIRECT" }] }));
  assert.deepEqual(Object.keys(config["proxy-providers"]), ["null", "Null"]);
  assert.deepEqual(Object.keys(config["rule-providers"]), ["null", "Null"]);
  assert.ok(config.rules.includes("RULE-SET,null,DIRECT"));
  assert.ok(config.rules.includes("RULE-SET,Null,DIRECT"));
});

for (const node of ["proxies:", "null", "Null", "[]", "- {name: one, type: ss}\n- {name: two, type: ss}", "{name: x}", "{name: 1, type: ss}", "{name: x, type: null}", "{name: '', type: ss}", "{name: x, type: ''}", "{name: x, type: ss", "- {name: x, type: ss}\nrules: [injected]"]) {
  test(`reject invalid node ${JSON.stringify(node)}`, () => assert.throws(() => template({ local: [node] }), /Static node/));
}

test("reject duplicate names across subscriptions and all reserved group names", async () => {
  assert.throws(() => template({ a: subscriptions.local, b: subscriptions.local }), /duplicate/);
  const groups = (await parsedResponse())["proxy-groups"].map((group) => group.name);
  for (const name of [...groups, "DIRECT", "REJECT", "TAILSCALE", "TAILSCALE-DIRECT"]) {
    assert.throws(() => template({ local: [JSON.stringify({ name, type: "ss" })] }), /reserved/);
  }
});

test("placeholder strings inside data survive without replacement", async () => {
  const markerData = "__TAILSCALE_DEFAULT__ [__TAILSCALE_GROUP__]\n  __TAILSCALE_PROXIES__\n    proxies: [__TAILSCALE_GROUP__]";
  const input = { remote: "https://example.test/__TAILSCALE_DEFAULT__/[__TAILSCALE_GROUP__]/__TAILSCALE_PROXIES__", local: [JSON.stringify({ name: "__TAILSCALE_DEFAULT__", type: "ss", password: markerData })] };
  const config = await parsedResponse(`?ts=tsnet&tskey=${fakeKey}`, template(input));
  assert.equal(config.proxies[0].password, markerData);
  assert.equal(config.proxies[0].name, "__TAILSCALE_DEFAULT__");
  assert.equal(config["proxy-providers"].remote.url, input.remote);
  const key = "tskey-auth-__TAILSCALE_DEFAULT__";
  assert.equal((await parsedResponse(`?ts=tsnet&tskey=${key}`, template())).proxies.at(-1)["auth-key"], key);
});

test("reject literal multiline and control characters in static node input", () => {
  for (const node of ["name: multiline\ntype: ss", '- {name: x, type: ss, password: "a\tsecret"}', "- {name: x, type: ss}\u2028"]) {
    assert.throws(() => template({ local: [node] }), /single YAML line/);
  }
});

test("missing, duplicate, or misplaced dedicated placeholders fail closed", async () => {
  for (const marker of ["  __TAILSCALE_PROXIES__", "    proxies: [__TAILSCALE_GROUP__]", "    default-selected: __TAILSCALE_DEFAULT__"]) {
    for (const body of [template().replace(marker, ""), `${template()}${marker}\n`, template().replace(marker, `# ${marker}`)]) {
      const response = await request("", body);
      assert.equal(response.status, 500);
      assert.equal(await response.text(), "Invalid profile template\n");
    }
  }
  assert.equal((await request("", template().replace('  - name: "Tailscale"', '  - name: "Other"'))).status, 500);
  assert.equal((await request("", template().replaceAll("\n", "\r\n"))).status, 200);
});
