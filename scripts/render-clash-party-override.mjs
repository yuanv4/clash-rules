export const renderClashPartyOverride = (providers, releaseBaseUrl, proxyGroup) => {
  const automaticGroup = "⚡ 自动选择";
  const aiGroup = "🤖 AI";
  const microsoftGroup = "🪟 Microsoft";
  const streamingGroup = "📺 流媒体";
  const appleGroup = "🍎 Apple";
  const googleGroup = "🔍 Google";
  const socialGroup = "💬 社交媒体";
  const unmatchedGroup = "🐟 漏网之鱼";
  const testUrl = "https://www.gstatic.com/generate_204";
  const japanNodeFilter =
    "(?i)(?:JP|JPN|Japan|日本|Tokyo|東京|Osaka|大阪|🇯🇵)";

  const domainSelectGroup = (name) => [
    `  - name: ${JSON.stringify(name)}`,
    "    type: select",
    "    proxies:",
    `      - ${JSON.stringify(automaticGroup)}`,
    '      - "DIRECT"',
    "    include-all: true",
  ];

  const lines = [
    "# 自动生成：由 scripts/build.mjs 生成，请勿手动编辑。",
    "# Bind this URL in Clash Party to load these rule providers and rules.",
    "proxy-groups:",
    `  - name: ${JSON.stringify(proxyGroup)}`,
    "    type: select",
    "    include-all: true",
    `  - name: ${JSON.stringify(automaticGroup)}`,
    "    type: url-test",
    `    url: ${JSON.stringify(testUrl)}`,
    "    interval: 300",
    "    tolerance: 50",
    "    include-all: true",
    `  - name: ${JSON.stringify(aiGroup)}`,
    "    type: fallback",
    `    url: ${JSON.stringify(testUrl)}`,
    "    interval: 300",
    "    include-all: true",
    `    filter: ${JSON.stringify(japanNodeFilter)}`,
    '    empty-fallback: "REJECT"',
    ...domainSelectGroup(microsoftGroup),
    ...domainSelectGroup(streamingGroup),
    ...domainSelectGroup(appleGroup),
    ...domainSelectGroup(googleGroup),
    ...domainSelectGroup(socialGroup),
    `  - name: ${JSON.stringify(unmatchedGroup)}`,
    "    type: select",
    "    proxies:",
    `      - ${JSON.stringify(automaticGroup)}`,
    '      - "DIRECT"',
    "    include-all: true",
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
  lines.push(`  - MATCH,${unmatchedGroup}`);

  return `${lines.join("\n")}\n`;
};
