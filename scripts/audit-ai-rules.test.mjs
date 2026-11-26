import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeConfiguration, parseRules, renderYaml } from "./build.mjs";
import { matchesDomain } from "./audit-ai-rules.mjs";

test("audit CLI reports dedicated AI routes and rejects missing OpenAI and Anthropic process rules", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clash-audit-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = JSON.parse(await readFile(new URL("../sources.json", import.meta.url), "utf8"));
  const providers = normalizeConfiguration(source).providers;
  const fixtures = {
    gemini: ["DOMAIN-SUFFIX,google.com", "DOMAIN-SUFFIX,youtube.com", "PROCESS-NAME,Antigravity"],
    openai: [
      "DOMAIN-SUFFIX,chatgpt.com", "DOMAIN-SUFFIX,openai.com", "DOMAIN-SUFFIX,sora.com",
      ...["ChatGPT", "ChatGPT.exe", "Codex", "Codex.exe", "chatgpt", "codex"].map((name) => `PROCESS-NAME,${name}`),
      "IP-CIDR,199.47.142.0/23", "IP-CIDR,24.199.123.28/32", "IP-CIDR,64.23.132.171/32", "IP-CIDR6,2604:f20::/32", "IP-ASN,401518",
    ],
    anthropic: [
      "DOMAIN-SUFFIX,claude.ai", "DOMAIN-SUFFIX,anthropic.com",
      ...["Claude", "Claude.exe", "claude", "claude.exe", "cowork-svc.exe"].map((name) => `PROCESS-NAME,${name}`),
      "IP-CIDR,160.79.104.0/21", "IP-CIDR6,2607:6bc0::/32", "IP-ASN,399358",
    ],
    ai: ["DOMAIN-SUFFIX,perplexity.ai", "DOMAIN-SUFFIX,google.com", "DOMAIN-SUFFIX,chatgpt.com", "DOMAIN-SUFFIX,claude.ai", "PROCESS-NAME,Codex", "PROCESS-NAME,Claude", "PROCESS-NAME,Antigravity", "PROCESS-NAME,Cursor", "IP-ASN,401518", "IP-ASN,399358"],
  };
  for (const [name, lines] of Object.entries(fixtures)) {
    await writeFile(path.join(root, `${name}.yaml`), renderYaml(providers.find((provider) => provider.name === name), parseRules(lines.join("\n"), "fixture")));
  }
  const runAudit = (...args) => spawnSync(process.execPath, [fileURLToPath(new URL("./audit-ai-rules.mjs", import.meta.url)), root, ...args], { encoding: "utf8", timeout: 20_000 });
  const result = runAudit("--list");
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.providerOrder, ["gemini", "openai", "anthropic", "ai"]);
  for (const [service, target] of [["OpenAI", "OpenAI"], ["Codex", "OpenAI"], ["Claude", "Anthropic"], ["Anthropic API", "Anthropic"], ["Perplexity", "通用 AI"], ["Gemini", "Google / Gemini"]]) {
    assert.equal(report.domainChecks.find((check) => check.service === service).target, target, service);
  }
  assert.equal(report.processChecks.find(({ process }) => process === "Codex").target, "OpenAI");
  assert.equal(report.processChecks.find(({ process }) => process === "Claude").target, "Anthropic");
  assert.ok(report.generalAiRules.some((rule) => rule.type === "PROCESS-NAME" && rule.value === "Codex"));
  assert.ok(report.generalAiRules.some((rule) => rule.type === "PROCESS-NAME" && rule.value === "Claude"));
  assert.ok(!Object.hasOwn(report, "internationalAiRules"));
  assert.ok(report.unshadowedNonDomainRules.some((rule) => rule.type === "PROCESS-NAME" && rule.value === "Cursor"));
  assert.ok(!report.unshadowedNonDomainRules.some((rule) => rule.type === "PROCESS-NAME" && rule.value === "Claude"));
  assert.ok(!report.unshadowedNonDomainRules.some((rule) => rule.type === "PROCESS-NAME" && rule.value === "Antigravity"));
  await writeFile(path.join(root, "openai.yaml"), renderYaml(providers.find(({ name }) => name === "openai"), parseRules(fixtures.openai.filter((line) => line !== "PROCESS-NAME,Codex").join("\n"), "fixture")));
  const missingProcess = runAudit();
  assert.equal(missingProcess.status, 1);
  assert.match(missingProcess.stderr, /Codex/);
  await writeFile(path.join(root, "openai.yaml"), renderYaml(providers.find(({ name }) => name === "openai"), parseRules(fixtures.openai.join("\n"), "fixture")));
  await writeFile(path.join(root, "anthropic.yaml"), renderYaml(providers.find(({ name }) => name === "anthropic"), parseRules(fixtures.anthropic.filter((line) => line !== "PROCESS-NAME,Claude").join("\n"), "fixture")));
  const missingClaudeProcess = runAudit();
  assert.equal(missingClaudeProcess.status, 1);
  assert.match(missingClaudeProcess.stderr, /Claude/);
});

for (const [line, matches, misses] of [
  ["DOMAIN,example.com", ["example.com"], ["sub.example.com", "notexample.com"]],
  ["DOMAIN-SUFFIX,example.com", ["example.com", "a.b.example.com"], ["notexample.com", "example.com.evil"]],
  ["DOMAIN-KEYWORD,example", ["example.com", "myexample.net"], ["other.com"]],
  ["DOMAIN-WILDCARD,*.example.com", ["api.example.com", "a.b.example.com"], ["example.com", "api.exampleXcom", "api.example.com.evil"]],
  ["DOMAIN-WILDCARD,api?.example.com", ["api1.example.com"], ["api.example.com", "api12.example.com"]],
  ["DOMAIN-REGEX,(?i)^api[0-9]\\.example\\.com$", ["api1.example.com", "API2.example.com"], ["api12.example.com", "sub.api1.example.com"]],
  ["IP-CIDR,192.0.2.0/24,no-resolve", [], ["192.0.2.1"]],
]) {
  test(`audit matches domain semantics for ${line}`, () => {
    const [rule] = parseRules(`${line}\n`, "fixture");
    for (const domain of matches) assert.equal(matchesDomain(rule, domain), true, domain);
    for (const domain of misses) assert.equal(matchesDomain(rule, domain), false, domain);
  });
}
