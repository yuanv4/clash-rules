/**
 * Render the sub-store override script for the DS420 sub-store service.
 *
 * The output is a standalone `async function main(config = {}) { ... }` JS
 * file consumed by sub-store's mihomoConfig "Script Operator" (mode=link).
 *
 * Because this script runs inside sub-store (not inside mihomo), it cannot
 * use runtime `include-all` + `filter` and must build STATIC proxy lists
 * for each group from the parsed nodes.
 *
 * Android credentials are selected explicitly at build time; ordinary mode
 * optionally binds its direct Tailscale route to a caller-provided interface.
 */
export const renderSubstoreOverride = (providers, releaseBaseUrl, proxyGroup, mode = "ordinary") => {
  if (!new Set(["ordinary", "android"]).has(mode)) {
    throw new Error(`Unsupported sub-store override mode: ${mode}`);
  }
  const isAndroid = mode === "android";
  const tailscaleProxy = isAndroid ? "TAILSCALE" : "DIRECT";
  const domesticGroup = "🇨🇳 国内服务";
  const foreignAiGroup = "🤖 国际 AI";
  const developerGroup = "🧑‍💻 开发服务";
  const foreignGroup = "🌐 国外服务";
  const streamingGroup = "🎬 流媒体服务";
  const adBlockGroup = "🛑 广告过滤";
  const adultContentGroup = "🔞 成人内容";
  const fallbackGroup = "🐟 漏网之鱼";
  const automaticGroup = proxyGroup;
  const aiRegionPattern = String.raw`(?:🇸🇬|新加坡|Singapore|(?<![\p{L}\p{N}])(?:SG|SGP)(?=$|[^\p{L}\p{N}]|\d))`;
  const aiExcludedRegionPattern = String.raw`(?:🇭🇰|🇲🇴|香港|澳门|澳門|Hong\s*Kong|Macao|Macau|(?<![\p{L}\p{N}])(?:HK|HKG|MO|MAC)(?=$|[^\p{L}\p{N}]|\d))`;
  const tailscaleGroup = "Tailscale";
  const testUrl = "https://cp.cloudflare.com/generate_204";
  const hongKongNodePattern = String.raw`(?:🇭🇰|\bHKG?(?=\b|\d)|Hong\s*Kong|香港|港)`;

  const ruleProviders = Object.fromEntries(
    providers.map((provider) => [
      provider.name,
      {
        type: "http",
        behavior: provider.behavior ?? "classical",
        format: provider.behavior === "domain" ? "text" : "yaml",
        interval: 86400,
        url: `${releaseBaseUrl}/rules/${provider.name}.${provider.behavior === "domain" ? "txt" : "yaml"}`,
      },
    ]),
  );
  const rules = providers.map((provider) => {
    const noResolve = provider.noResolve ? ",no-resolve" : "";
    return `RULE-SET,${provider.name},${provider.target}${noResolve}`;
  });
  rules.push(`MATCH,${fallbackGroup}`);

  const businessGroups = [
    tailscaleGroup,
    adBlockGroup,
    adultContentGroup,
    domesticGroup,
    foreignGroup,
    foreignAiGroup,
    developerGroup,
    streamingGroup,
    fallbackGroup,
  ];
  const businessGroupSet = new Set(businessGroups);
  const providerGroupOrder = [];
  for (const provider of providers) {
    if (
      businessGroupSet.has(provider.target) &&
      provider.target !== tailscaleGroup &&
      provider.target !== fallbackGroup &&
      !providerGroupOrder.includes(provider.target)
    ) {
      providerGroupOrder.push(provider.target);
    }
  }
  const groupOrder = [
    tailscaleGroup,
    ...providerGroupOrder,
    ...businessGroups.filter(
      (name) => name !== tailscaleGroup && name !== fallbackGroup && !providerGroupOrder.includes(name),
    ),
    fallbackGroup,
    automaticGroup,
  ];

  const tailscaleRules = [
    "IP-CIDR,100.64.0.0/10,Tailscale,no-resolve",
    "IP-CIDR,100.100.100.100/32,Tailscale,no-resolve",
    "DOMAIN-SUFFIX,ts.net,Tailscale",
  ];

  const runtimeSetup = [];
  if (isAndroid) {
    runtimeSetup.push(
      "  const runtimeOptions = typeof $options === 'undefined' ? undefined : $options;",
      "  const tailscaleSecret = runtimeOptions === undefined ? undefined : runtimeOptions['tailscale-secret'];",
      "  if (typeof tailscaleSecret !== 'string' || tailscaleSecret.length === 0) throw new Error('Android subscription requires non-empty string $options[\\u0027tailscale-secret\\u0027]');",
      "",
    );
  } else {
    runtimeSetup.push(
      "  const runtimeOptions = typeof $options === 'undefined' ? undefined : $options;",
      "  const tailscaleInterfaceName = runtimeOptions === undefined ? undefined : runtimeOptions['interface-name'];",
      "  if (tailscaleInterfaceName !== undefined && typeof tailscaleInterfaceName !== 'string') throw new Error('$options.interface-name must be a string');",
      "",
    );
  }
  runtimeSetup.push(
    "  const nodeLinks = runtimeOptions === undefined ? undefined : runtimeOptions.links;",
    "  if (nodeLinks !== undefined && typeof nodeLinks !== 'string') throw new Error('$options.links must be a string');",
    "  if (typeof nodeLinks === 'string' && nodeLinks.trim()) {",
    "    if (typeof ProxyUtils === 'undefined' || typeof ProxyUtils.parse !== 'function') throw new Error('Node links require ProxyUtils.parse');",
    "    const injectedProxies = [];",
    `    const reservedNames = new Set(${JSON.stringify([...new Set(['DIRECT', 'REJECT', 'PASS', 'COMPATIBLE', 'TAILSCALE', ...(!isAndroid ? ['TAILSCALE-DIRECT'] : []), ...businessGroups, automaticGroup])])});`,
    "    for (const [index, line] of nodeLinks.split(/\\r?\\n/).entries()) {",
    "      if (!line.trim()) continue;",
    "      if (!/^[a-z][a-z0-9+.-]*:\\/\\/\\S+$/i.test(line.trim()) || /^https?:\\/\\//i.test(line.trim())) throw new Error('Invalid node link at line ' + (index + 1));",
    "      let parsed;",
    "      try { parsed = ProxyUtils.parse(line.trim()); } catch { throw new Error('Could not parse node link at line ' + (index + 1)); }",
    "      if (!Array.isArray(parsed) || parsed.length !== 1 || !parsed[0] || typeof parsed[0].name !== 'string' || !parsed[0].name.trim()) throw new Error('Node link at line ' + (index + 1) + ' must produce exactly one named proxy');",
    "      const name = parsed[0].name;",
    "      if (reservedNames.has(name) || config.proxies.some((proxy) => proxy && proxy.name === name) || injectedProxies.some((proxy) => proxy.name === name)) throw new Error('Duplicate or reserved node name at line ' + (index + 1));",
    "      injectedProxies.push(parsed[0]);",
    "    }",
    "    config.proxies.push(...injectedProxies);",
    "  }",
    "",
  );

  const tailscaleNodeSetup = [];
  if (isAndroid) {
    tailscaleNodeSetup.push(
      "  config.proxies = config.proxies.filter((p) => !(p && p.name === 'TAILSCALE'));",
      "  config.proxies.unshift({",
      "    name: 'TAILSCALE', type: 'tailscale',",
      "    'auth-key': tailscaleSecret,",
      "    'state-dir': './tailscale',",
      "    udp: true,",
      "    'accept-routes': true,",
      "    'ip-version': 'ipv4-prefer',",
      "  });",
    );
  } else {
    tailscaleNodeSetup.push(
      "  if (tailscaleInterfaceName) {",
      "    config.proxies = config.proxies.filter((p) => !(p && p.name === 'TAILSCALE-DIRECT'));",
      "    config.proxies.unshift({ name: 'TAILSCALE-DIRECT', type: 'direct', 'interface-name': tailscaleInterfaceName });",
      "  }",
    );
  }

  return [
    "// Generated by scripts/build.mjs; do not edit.",
    "// Consumed by the DS420 sub-store mihomoConfig override (Script Operator, mode=link).",
    "async function main(config = {}) {",
    ...runtimeSetup,
    "  const names = config.proxies.map((p) => p?.name);",
    "  if (!names.length) throw new Error('Subscription has no proxies');",
    `  const hongKongPattern = new RegExp(${JSON.stringify(hongKongNodePattern)}, 'iu');`,
    "  const hongKongNames = names.filter((name) => hongKongPattern.test(name));",
    "  if (!hongKongNames.length) throw new Error('Subscription has no Hong Kong proxies');",
    `  const aiRegionPattern = new RegExp(${JSON.stringify(aiRegionPattern)}, 'iu');`,
    `  const aiExcludedRegionPattern = new RegExp(${JSON.stringify(aiExcludedRegionPattern)}, 'iu');`,
    "  const aiNames = names.filter((name) => aiRegionPattern.test(name) && !aiExcludedRegionPattern.test(name));",
    ...(!isAndroid ? [
      "  const tailscaleProxies = tailscaleInterfaceName ? ['TAILSCALE-DIRECT'] : ['DIRECT'];",
      "  const tailscaleDefault = tailscaleInterfaceName ? 'TAILSCALE-DIRECT' : 'DIRECT';",
    ] : [
      `  const tailscaleProxies = ['${tailscaleProxy}'];`,
      `  const tailscaleDefault = '${tailscaleProxy}';`,
    ]),
    "  const proxyGroups = [",
    `    { name: '${automaticGroup}', type: 'url-test', url: '${testUrl}', interval: 300, tolerance: 50, proxies: hongKongNames },`,
    `    { name: '${foreignGroup}', type: 'select', proxies: ['DIRECT', '${automaticGroup}'], 'default-selected': '${automaticGroup}' },`,
    `    { name: '${fallbackGroup}', type: 'select', proxies: ['DIRECT', '${automaticGroup}'], 'default-selected': 'DIRECT' },`,
    `    { name: '${tailscaleGroup}', type: 'select', proxies: tailscaleProxies, 'default-selected': tailscaleDefault },`,
    `    { name: '${domesticGroup}', type: 'select', proxies: ['DIRECT', '${automaticGroup}'], 'default-selected': 'DIRECT' },`,
    `    { name: '${foreignAiGroup}', type: 'url-test', url: '${testUrl}', interval: 60, tolerance: 50, proxies: aiNames.length ? aiNames : ['REJECT'] },`,
    `    { name: '${developerGroup}', type: 'select', proxies: ['DIRECT', '${automaticGroup}'], 'default-selected': '${automaticGroup}' },`,
    `    { name: '${streamingGroup}', type: 'select', proxies: ['DIRECT', '${automaticGroup}'], 'default-selected': '${automaticGroup}' },`,
    `    { name: '${adBlockGroup}', type: 'select', proxies: ['REJECT', 'DIRECT'], 'default-selected': 'REJECT' },`,
    `    { name: '${adultContentGroup}', type: 'select', proxies: ['REJECT', 'DIRECT'], 'default-selected': 'REJECT' }`,
    "  ];",
    `  const groupOrder = ${JSON.stringify(groupOrder)};`,
    "  config['proxy-groups'] = groupOrder.map((name) => proxyGroups.find((group) => group.name === name));",
    "",
    "  config.mode = 'Rule';",
    "  config['log-level'] = 'info';",
    `  config['rule-providers'] = ${JSON.stringify(ruleProviders)};`,
    `  config.rules = ${JSON.stringify([...tailscaleRules, ...rules])};`,
    "",
    ...tailscaleNodeSetup,
    "",
    "  // Enable X25519MLKEM768 REALITY handshakes for Mihomo/FlClash compatibility with Xray 26.x.",
    "  for (const proxy of config.proxies) {",
    "    if (proxy !== null && typeof proxy === 'object' && proxy.type === 'vless' && proxy['reality-opts'] !== null && typeof proxy['reality-opts'] === 'object') {",
    "      proxy['reality-opts']['support-x25519mlkem768'] = true;",
    "    }",
    "  }",
    "",
    "  return config;",
    "}",
    "",
  ].join("\n");
};
