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
    for (const rule of config.rules.filter((r) => r.startsWith("RULE-SET,"))) assert.ok(Object.hasOwn(config["rule-providers"], rule.split(",")[1]));
  });
}

test("remote-only and static-only output remain valid", async () => {
  assert.deepEqual((await parsedResponse("", template({ remote: subscriptions.remote }))).proxies, []);
  assert.equal((await parsedResponse("", template({ local: subscriptions.local }))).proxies.length, 1);
});

test("auth key priority, alias, fallback, and errors", async () => {
  for (const [query, env, expected] of [
    [`?ts=tsnet&tskey=${fakeKey}&tailscale-secret=tskey-auth-ALIAS_FAKE`, { TS_AUTH_KEY: "tskey-auth-FALLBACK_FAKE" }, fakeKey],
    ["?ts=tsnet&tailscale-secret=tskey-auth-ALIAS_FAKE", {}, "tskey-auth-ALIAS_FAKE"],
    ["?ts=tsnet", { TS_AUTH_KEY: fakeKey }, fakeKey],
  ]) {
    const config = await parsedResponse(query, template(), env);
    assert.equal(config.proxies.at(-1)["auth-key"], expected);
  }
  for (const query of ["?ts=tsnet", "?ts=both", "?ts=bad", "?ts=tsnet&tskey=invalid"]) assert.equal((await request(query)).status, 400);
});

test("iface validation is restricted to interface and both", async () => {
  for (const mode of ["off", "tsnet"]) assert.equal((await request(`?ts=${mode}&iface=%E7%BD%91%E5%8D%A1&tskey=${fakeKey}`, template(), { TS_INTERFACE: "bad!" })).status, 200);
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
  const fallback = "tskey-auth-__TAILSCALE_DEFAULT__";
  assert.equal((await parsedResponse("?ts=tsnet", template(), { TS_AUTH_KEY: fallback })).proxies.at(-1)["auth-key"], fallback);
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
