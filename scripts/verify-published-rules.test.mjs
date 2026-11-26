import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { normalizeConfiguration, renderDomainText, renderYaml } from "./build.mjs";
import { verifyPublishedRules } from "./verify-published-rules.mjs";

const source = JSON.parse(await readFile(new URL("../sources.json", import.meta.url), "utf8"));
const config = normalizeConfiguration(source);
const artifacts = () => new Map(config.providers.map((provider) => {
  const domain = provider.behavior === "domain";
  const content = domain
    ? renderDomainText(provider, [{ type: "DOMAIN-TEXT", value: "+.fixture.test", options: [] }])
    : renderYaml(provider, [{ type: "DOMAIN-SUFFIX", value: "fixture.test", options: [] }]);
  return [`${config.releaseBaseUrl}/rules/${provider.name}.${domain ? "txt" : "yaml"}`, content];
}));
const urlFor = (name) => `${config.releaseBaseUrl}/rules/${name}.yaml`;
const reader = (files) => async (url) => {
  if (!files.has(url)) throw new Error("HTTP status 404");
  return files.get(url);
};

test("published provider check accepts ready artifacts of both formats", async () => {
  await verifyPublishedRules(source, reader(artifacts()));
});

test("published provider check rejects a missing rule artifact", async () => {
  const files = artifacts();
  files.delete(urlFor("ai"));
  await assert.rejects(verifyPublishedRules(source, reader(files)), /404/);
});

test("published provider check blocks stale foreign rules before developer merge", async () => {
  const files = artifacts();
  const foreign = config.providers.find(({ name }) => name === "foreign_services");
  files.set(urlFor("foreign_services"), renderYaml({
    ...foreign,
    inputs: foreign.inputs.filter(({ sourceUrl }) => !sourceUrl.endsWith("category-dev.yaml")),
  }, [{ type: "DOMAIN", value: "fixture.test", options: [] }]));
  await assert.rejects(verifyPublishedRules(source, reader(files)), /foreign_services.*configured sources/);
});

test("published provider check rejects a stale filtered artifact after removing its filter", async () => {
  const unfilteredSource = structuredClone(source);
  delete unfilteredSource.providers.find(({ name }) => name === "openai").inputs[1].include_rule_types;
  await assert.rejects(verifyPublishedRules(unfilteredSource, reader(artifacts())), /provider openai .*configured sources/);
});

test("published provider check rejects stale type filters and empty payloads", async () => {
  const files = artifacts();
  const url = urlFor("anthropic");
  files.set(url, files.get(url).replace(/^# Included rule types.*\n/mu, ""));
  await assert.rejects(verifyPublishedRules(source, reader(files)), /anthropic.*configured sources/);
  const empty = artifacts();
  empty.set(url, renderYaml(config.providers.find(({ name }) => name === "anthropic"), []).replace("payload:\n", "payload: []\n"));
  await assert.rejects(verifyPublishedRules(source, reader(empty)), /no usable rules/);
});
