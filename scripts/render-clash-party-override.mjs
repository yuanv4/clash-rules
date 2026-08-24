export const renderClashPartyOverride = (providers, releaseBaseUrl) => {
  const automaticGroup = "⚡ 自动选择";
  const aiGroup = "🤖 AI";
  const domesticGroup = "🌐 国内";
  const fallbackGroup = "🐟 漏网之鱼";
  const testUrl = "https://cp.cloudflare.com/generate_204";
  const singaporeNodeFilter =
    "(?i)(?:SG|SGP|Singapore|新加坡|🇸🇬)";

  const lines = [
    "# 自动生成：由 scripts/build.mjs 生成，请勿手动编辑。",
    "# Bind this URL in Clash Party to load these rule providers and rules.",
    "proxy-groups:",
    `  - name: ${JSON.stringify(automaticGroup)}`,
    "    type: url-test",
    `    url: ${JSON.stringify(testUrl)}`,
    "    interval: 300",
    "    tolerance: 50",
    "    include-all: true",
    `  - name: ${JSON.stringify(aiGroup)}`,
    "    type: url-test",
    `    url: ${JSON.stringify(testUrl)}`,
    "    interval: 300",
    "    tolerance: 50",
    "    include-all: true",
    `    filter: ${JSON.stringify(singaporeNodeFilter)}`,
    `  - name: ${JSON.stringify(domesticGroup)}`,
    "    type: select",
    "    proxies:",
    '      - "DIRECT"',
    `      - ${JSON.stringify(automaticGroup)}`,
    `  - name: ${JSON.stringify(fallbackGroup)}`,
    "    type: select",
    "    proxies:",
    `      - ${JSON.stringify(automaticGroup)}`,
    '      - "DIRECT"',
    "rule-providers!:",
  ];

  for (const provider of providers) {
    const providerUrl = `${releaseBaseUrl}/rules/${provider.name}.yaml`;
    lines.push(
      `  ${provider.name}:`,
      "    type: http",
      "    behavior: classical",
      "    format: yaml",
      "    interval: 86400",
      `    path: ./rules/${provider.name}.yaml`,
      `    url: ${JSON.stringify(providerUrl)}`,
      `    proxy: ${JSON.stringify(automaticGroup)}`
    );
  }

  lines.push("rules:");
  for (const provider of providers) {
    const noResolve = provider.noResolve ? ",no-resolve" : "";
    lines.push(`  - RULE-SET,${provider.name},${provider.target}${noResolve}`);
  }
  lines.push(`  - MATCH,${fallbackGroup}`);

  return `${lines.join("\n")}\n`;
};
