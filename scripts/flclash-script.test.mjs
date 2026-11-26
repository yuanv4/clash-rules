import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { renderFlClashScript } from "./render-flclash-script.mjs";

const source = JSON.parse(await readFile(new URL("../sources.json", import.meta.url), "utf8"));
const legacyPrefix = "[clash-rules] ";
const qureBase = "https://raw.githubusercontent.com/Koolson/Qure/b16b260625f873266f6a6a9b88710132774997b8/IconSet/Color";
const dashboardBase = "https://raw.githubusercontent.com/homarr-labs/dashboard-icons/23fc02e7710a66e0c774989f6e78372e9b6c2e15/png";
const icons = {
  "自动选择": `${qureBase}/Auto.png`, "广告过滤": `${qureBase}/Advertising.png`, "成人内容": `${qureBase}/Reject.png`,
  "Google / Gemini": `${dashboardBase}/google.png`, "OpenAI": `${dashboardBase}/chatgpt.png`, "Anthropic": `${dashboardBase}/anthropic.png`,
  "通用 AI": `${qureBase}/AI.png`, "流媒体服务": `${qureBase}/Streaming.png`, "国内服务": `${qureBase}/China.png`,
  "国外服务": `${qureBase}/Global.png`, "漏网之鱼": `${qureBase}/Final.png`, Tailscale: `${dashboardBase}/tailscale-light.png`,
};
const files = { "flclash.js": "off", "flclash-desktop.js": "interface", "flclash-android.js": "tsnet", "flclash-both.js": "both" };
const run = (script, config) => JSON.parse(JSON.stringify(vm.runInNewContext(`${script}; main`)(config)));
const sample = () => ({ dns: { enable: true, listen: "127.0.0.1:7874", "proxy-server-nameserver": ["127.0.0.1:7874"] }, hosts: { "example.test": "192.0.2.1" }, tun: { enable: true }, ipv6: true, sniffer: { enable: true }, "mixed-port": 7890, profile: { "store-selected": true }, unknown: { future: [1, 2] }, "proxy-providers": { airport: { type: "http", url: "https://example.test/sub" } }, proxies: [{ name: "JP01", type: "socks5", server: "example.test", port: 1080 }, { name: "AIRPORT-TAILSCALE", type: "direct" }], "rule-providers": { airport: { type: "file", path: "airport.yaml" } }, "proxy-groups": [{ name: "airport", type: "select", proxies: ["JP01"] }], rules: ["DOMAIN,example.test,airport", "MATCH,airport"] });

for (const [filename, mode] of Object.entries(files)) {
  test(`${filename} replaces routing while preserving airport settings`, () => {
    const script = renderFlClashScript({ source, tailscaleMode: mode });
    const input = sample();
    const original = structuredClone(input);
    const result = run(script, input);
    const groupNames = new Set(result["proxy-groups"].map(({ name }) => name));
    const expectedIcons = Object.entries(icons).filter(([name]) => name !== "Tailscale" || mode !== "off");
    assert.deepEqual([...groupNames].sort(), expectedIcons.map(([name]) => name).sort());
    for (const [name, url] of expectedIcons) {
      assert.equal(result["proxy-groups"].find((group) => group.name === name).icon, url, name);
    }
    assert.ok([...groupNames].every((name) => !name.startsWith(legacyPrefix)));
    assert.deepEqual(Object.keys(result["rule-providers"]), source.providers.map(({ name }) => name));
    assert.ok(Object.keys(result["rule-providers"]).every((name) => !name.startsWith(legacyPrefix)));
    const outboundNames = new Set([...groupNames, ...result.proxies.map(({ name }) => name), "DIRECT", "REJECT"]);
    for (const group of result["proxy-groups"]) for (const name of group.proxies ?? []) assert.ok(outboundNames.has(name), name);
    for (const rule of result.rules) {
      const parts = rule.split(",");
      if (parts[0] === "RULE-SET") assert.ok(Object.hasOwn(result["rule-providers"], parts[1]), rule);
      assert.ok(!rule.includes(legacyPrefix), rule);
      assert.ok(outboundNames.has(parts[0] === "MATCH" ? parts[1] : parts[2]), rule);
    }
    assert.deepEqual(input, original);
    for (const key of Object.keys(original).filter((key) => !["rule-providers", "proxy-groups", "rules", "proxies"].includes(key))) assert.deepEqual(result[key], original[key]);
    assert.deepEqual(result.proxies.slice(0, 2), original.proxies);
    assert.ok(!Object.hasOwn(result["rule-providers"], "airport"));
    assert.ok(!result["proxy-groups"].some(({ name }) => name === "airport"));
    assert.ok(!result.rules.includes("MATCH,airport"));
    assert.deepEqual(result.rules.filter((rule) => /^(MATCH|FINAL),/.test(rule)), ["MATCH,漏网之鱼"]);
    assert.equal(result.rules.at(-1), "MATCH,漏网之鱼");
    assert.equal(result["proxy-groups"].find(({ name }) => name === "漏网之鱼")["default-selected"], "DIRECT");
    assert.deepEqual(run(script, result), result);
    const names = result.proxies.slice(2).map(({ name }) => name);
    assert.deepEqual(names, mode === "off" ? [] : mode === "interface" ? ["TAILSCALE-DIRECT"] : mode === "tsnet" ? ["TAILSCALE"] : ["TAILSCALE-DIRECT", "TAILSCALE"]);
    const ts = result.proxies.find(({ name }) => name === "TAILSCALE");
    if (ts) assert.deepEqual(ts, { name: "TAILSCALE", type: "tailscale", "state-dir": "./tailscale", udp: true, "accept-routes": true, "ip-version": "ipv4-prefer" });
    const direct = result.proxies.find(({ name }) => name === "TAILSCALE-DIRECT");
    if (direct) assert.equal(direct["interface-name"], "Tailscale");
    assert.equal(result.rules.some((rule) => rule.includes(",Tailscale")), mode !== "off");
  });
}

test("custom provider targets receive a fallback icon", () => {
  const custom = structuredClone(source);
  custom.providers.push({ name: "custom", target: "custom target" });
  const result = run(renderFlClashScript({ source: custom }), sample());
  const group = result["proxy-groups"].find(({ name }) => name === "custom target");
  assert.equal(group.icon, `${qureBase}/Global.png`);
  assert.deepEqual(group.proxies, ["DIRECT", source.proxy_group]);
  assert.ok(result.rules.includes("RULE-SET,custom,custom target"));
});

test("fake-ip DNS gains only the control-plane exception for embedded modes", () => {
  for (const mode of Object.values(files)) {
    const script = renderFlClashScript({ source, tailscaleMode: mode });
    const input = sample();
    input.dns = { ...input.dns, "enhanced-mode": "fake-ip", "fake-ip-filter-mode": "blacklist", "fake-ip-filter": ["duplicate.test", "duplicate.test"] };
    const original = structuredClone(input);
    const result = run(script, input);
    const embedded = mode === "tsnet" || mode === "both";
    assert.deepEqual(result.dns, { ...original.dns, "fake-ip-filter": embedded ? ["duplicate.test", "duplicate.test", "controlplane.tailscale.com"] : original.dns["fake-ip-filter"] });
    assert.deepEqual(input, original);
    assert.deepEqual(run(script, result), result);
    const node = result.proxies.find(({ name }) => name === "TAILSCALE");
    if (node) { assert.equal(Object.hasOwn(node, "auth-key"), false); assert.equal(Object.hasOwn(node, "dialer-proxy"), false); }
  }
});

test("embedded modes preserve existing and unsupported DNS shapes", () => {
  for (const mode of ["tsnet", "both"]) {
    const script = renderFlClashScript({ source, tailscaleMode: mode });
    const existing = { "enhanced-mode": "fake-ip", "fake-ip-filter": ["controlplane.tailscale.com", "repeat", "repeat"] };
    const main = vm.runInNewContext(`${script}; main`);
    assert.equal(main({ dns: existing }).dns, existing);
    for (const dns of [existing, null, [], "dns", { "enhanced-mode": "redir-host", "fake-ip-filter": ["example.test"] }, { "enhanced-mode": "fake-ip", "fake-ip-filter-mode": "whitelist", "fake-ip-filter": [] }, { "enhanced-mode": "fake-ip", "fake-ip-filter": "invalid" }, { "enhanced-mode": "fake-ip", "fake-ip-filter": null }]) {
      const input = { ...sample(), dns };
      const original = structuredClone(input);
      assert.deepEqual(run(script, input).dns, dns);
      assert.deepEqual(input, original);
    }
    const input = sample();
    delete input.dns;
    assert.equal(Object.hasOwn(run(script, input), "dns"), false);
    input.dns = { "enhanced-mode": "fake-ip", "proxy-server-nameserver": ["127.0.0.1:7874"] };
    assert.deepEqual(run(script, input).dns, { ...input.dns, "fake-ip-filter": ["controlplane.tailscale.com"] });
  }
});

test("mode switches replace project nodes and preserve absent proxies in off mode", () => {
  const scripts = Object.fromEntries(Object.values(files).map((mode) => [mode, renderFlClashScript({ source, tailscaleMode: mode })]));
  const bare = run(scripts.off, {});
  assert.equal(Object.hasOwn(bare, "proxies"), false);
  for (const first of Object.keys(scripts)) for (const second of Object.keys(scripts)) {
    const input = sample();
    assert.deepEqual(run(scripts[second], run(scripts[first], input)), run(scripts[second], input));
  }
});

test("legacy project nodes migrate without removing unrelated nodes", () => {
  for (const mode of Object.values(files)) {
    const input = sample();
    input.proxies.push({ name: `${legacyPrefix}TAILSCALE`, type: "old" }, { name: `${legacyPrefix}TAILSCALE-DIRECT`, type: "old" }, { name: `${legacyPrefix}OTHER`, type: "direct" });
    const result = run(renderFlClashScript({ source, tailscaleMode: mode }), input);
    assert.ok(!result.proxies.some(({ name }) => name === `${legacyPrefix}TAILSCALE` || name === `${legacyPrefix}TAILSCALE-DIRECT`));
    assert.ok(result.proxies.some(({ name }) => name === `${legacyPrefix}OTHER`));
  }
});

test("project node ownership does not depend on property order", () => {
  const input = { proxies: [
    { "interface-name": "Tailscale", type: "direct", name: "TAILSCALE-DIRECT" },
    { udp: true, "ip-version": "ipv4-prefer", name: "TAILSCALE", "accept-routes": true, type: "tailscale", "state-dir": "./tailscale" },
  ] };
  assert.deepEqual(run(renderFlClashScript({ source }), input).proxies, []);
});

test("different same-name nodes survive off mode and cause safe conflicts when wanted", () => {
  for (const [name, mode, variants] of [
    ["TAILSCALE", "tsnet", [{ type: "direct" }, { type: "tailscale", "state-dir": "./tailscale", udp: true, "accept-routes": true, "ip-version": "ipv4-prefer", secret: "private-credential" }]],
    ["TAILSCALE-DIRECT", "interface", [{ type: "direct", "interface-name": "other", secret: "private-credential" }, { type: "direct", "interface-name": "Tailscale", secret: "private-credential" }]],
  ]) for (const variant of variants) {
    const input = { proxies: [{ name, ...variant }] };
    const original = structuredClone(input);
    assert.deepEqual(run(renderFlClashScript({ source }), input).proxies, input.proxies);
    const main = vm.runInNewContext(`${renderFlClashScript({ source, tailscaleMode: mode })}; main`);
    assert.throws(() => main(input), (error) => error.message.includes(name) && !error.message.includes("private-credential"));
    assert.deepEqual(input, original);
  }
});

test("old routing values are replaced while nodes and DNS remain intact", () => {
  const script = renderFlClashScript({ source });
  const expected = run(script, sample());
  for (const old of [null, "old", 42, [{ invalid: true }], { arbitrary: true }]) {
    const input = { ...sample(), rules: old, "proxy-groups": old, "rule-providers": old };
    const result = run(script, input);
    for (const key of ["rules", "proxy-groups", "rule-providers"]) assert.deepEqual(result[key], expected[key]);
    assert.deepEqual(result.proxies, input.proxies);
    assert.deepEqual(result.dns, input.dns);
    assert.deepEqual(result.hosts, input.hosts);
  }
});

test("invalid configuration shapes fail without revealing values", () => {
  const main = vm.runInNewContext(`${renderFlClashScript({ source })}; main`);
  for (const value of [null, [], { proxies: null }, { proxies: "secret-value" }, { proxies: [{ secret: "secret-value" }] }]) {
    assert.throws(() => main(value), (error) => !error.message.includes("secret-value"));
  }
});

test("AI and automatic selection filters and rule priorities follow routing requirements", () => {
  const result = run(renderFlClashScript({ source, tailscaleMode: "both" }), sample());
  const group = (name) => result["proxy-groups"].find((g) => g.name === name);
  const selected = (g, name) => (!g.filter || new RegExp(g.filter.replace(/^\(\?i\)/, ""), "i").test(name)) && !new RegExp(g["exclude-filter"].replace(/^\(\?i\)/, ""), "i").test(name);
  for (const name of ["通用 AI", "Google / Gemini"]) {
    const g = group(name);
    assert.equal(g.type, name === "通用 AI" ? "url-test" : "select");
    for (const node of ["US01", "USA 02", "美国 03", "🇺🇸 04"]) assert.ok(selected(g, node), node);
    for (const node of ["HK01-US", "MO01-SG01", "美国 剩余流量", "TAILSCALE", "TAILSCALE-DIRECT"]) assert.ok(!selected(g, node), node);
  }
  const google = group("Google / Gemini");
  for (const node of ["JP01", "SG01", "日本 02", "新加坡 02"]) assert.ok(!selected(google, node), node);
  for (const node of ["JP01", "SG01", "日本 02", "新加坡 02"]) assert.ok(selected(group("通用 AI"), node), node);
  assert.equal(google.url, "https://gemini.google.com/app");
  assert.equal(google["empty-fallback"], "REJECT");
  assert.equal(google["include-all"], true);
  assert.equal(result["rule-providers"].gemini.url, `${source.release_base_url}/rules/gemini.yaml`);
  assert.ok(result.rules.includes("RULE-SET,gemini,Google / Gemini,no-resolve"));
  for (const [name, type] of [["OpenAI", "url-test"], ["Anthropic", "select"]]) {
    const g = group(name);
    assert.equal(g.type, type);
    assert.equal(g["empty-fallback"], "REJECT");
    assert.equal(g["include-all"], true);
    for (const node of ["TW01", "TWN 01", "台灣 01", "台湾 01", "Taipei 01", "🇹🇼 01", "JP01", "JPN 01", "日本 01", "🇯🇵 01", "SG01", "SGP 01", "新加坡 01", "🇸🇬 01"]) assert.ok(selected(g, node), node);
    for (const node of ["US01", "JP01-US01", "台湾 美国", "🇸🇬 🇺🇸", "HK01-JP01", "MO01-SG01", "台湾 剩余流量", "TAILSCALE"]) assert.ok(!selected(g, node), node);
  }
  const auto = group(source.proxy_group);
  assert.equal(auto["include-all"], true);
  assert.equal(auto["empty-fallback"], "REJECT");
  for (const node of ["HK01", "香港 02", "Hong Kong 03", "🇭🇰 04", "HKG05", "JP01", "TW01", "MO01", "KR01", "CN01", "US01", "HK01-US", "HK01-JP01", "JP01-SG01", "香港中转-美国01", "US01-HK01", "无地区标签"]) assert.ok(selected(auto, node), node);
  for (const node of ["香港 剩余流量", "到期时间 2027", "TAILSCALE", "TAILSCALE-DIRECT"]) assert.ok(!selected(auto, node), node);
  const ruleIndex = (name) => result.rules.findIndex((rule) => rule.startsWith(`RULE-SET,${name},`));
  assert.ok(ruleIndex("adult_content") < ruleIndex("gemini"));
  assert.ok(ruleIndex("gemini") >= 0 && ruleIndex("ai") >= 0);
  assert.ok(ruleIndex("gemini") < ruleIndex("openai"));
  assert.ok(ruleIndex("openai") < ruleIndex("anthropic"));
  assert.ok(ruleIndex("anthropic") < ruleIndex("ai"));
  assert.ok(ruleIndex("ai") < ruleIndex("foreign_services"));
  assert.equal(group("国内服务")["default-selected"], "DIRECT");
  assert.equal(group("广告过滤")["default-selected"], "REJECT");
  assert.equal(group("成人内容")["default-selected"], "REJECT");
});

test("CLI writes four runnable scripts and supports help", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "clash-scripts-"));
  try {
    const cli = fileURLToPath(new URL("./render-flclash-script.mjs", import.meta.url));
    const result = spawnSync(process.execPath, [cli, "--output-dir", dir], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual((await readdir(dir)).sort(), Object.keys(files).sort());
    for (const [name, mode] of Object.entries(files)) assert.deepEqual(run(await readFile(path.join(dir, name), "utf8"), sample()), run(renderFlClashScript({ source, tailscaleMode: mode }), sample()));
    assert.equal(spawnSync(process.execPath, [cli, "--help"]).status, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
