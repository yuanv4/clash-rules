const assert = require("node:assert/strict");
const main = require("../dist/clash-rules.js");

const config = main({
  proxies: [{ name: "JP-01" }],
});

const rules = config.rules ?? [];
const fakeIpFilter = config.dns?.["fake-ip-filter"] ?? [];

assert(
  rules.includes("DOMAIN,localhost,全局直连"),
  "expected localhost callbacks to be routed directly"
);

assert(
  rules.includes("IP-CIDR,127.0.0.0/8,全局直连,no-resolve"),
  "expected loopback IPv4 traffic to be routed directly"
);

assert(
  fakeIpFilter.includes("DOMAIN,localhost,real-ip"),
  "expected localhost to bypass fake-ip with an exact-match rule"
);
