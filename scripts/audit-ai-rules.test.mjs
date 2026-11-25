import assert from "node:assert/strict";
import { test } from "node:test";
import { parseRules } from "./build.mjs";
import { matchesDomain } from "./audit-ai-rules.mjs";

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
