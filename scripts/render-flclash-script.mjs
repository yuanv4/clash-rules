#!/usr/bin/env node
import { readFile, mkdir, readdir, writeFile } from "node:fs/promises";
import { assertSafeOutputDirectory, OUTPUT_MARKER, OUTPUT_MARKER_CONTENT } from "./build.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUILTINS = new Set(["DIRECT", "REJECT", "REJECT-DROP", "PASS", "COMPATIBLE", "GLOBAL"]);
const TEST_URL = "https://cp.cloudflare.com/generate_204";
const FAKE_NODE_ALT =
  "当前流量|剩余流量|距離下次重置|距离下次重置|到期时间|过期时间|套餐|官网|群组|订阅地址";
const TAILSCALE_NODE_ALT = "^TAILSCALE(?:-DIRECT)?$";
const NODE_EXCLUDE_ALT = `${FAKE_NODE_ALT}|${TAILSCALE_NODE_ALT}`;
const NODE_EXCLUDE_PATTERN = `(?:${NODE_EXCLUDE_ALT})`;

// 自动选择组按节点名称识别东亚地区。
const EAST_ASIA_REGION_PATTERN =
  "(?i)(?:香港|澳门|澳門|台湾|台灣|台北|日本|东京|東京|大阪|韩国|韓國|首尔|首爾|中國|中国|大陆|大陸|蒙古|朝鲜|朝鮮|" +
  "🇭🇰|🇲🇴|🇹🇼|🇯🇵|🇰🇷|🇨🇳|🇲🇳|🇰🇵|" +
  "(?:^|[^a-z])(?:hong\\s*kong|macao|macau|taiwan|taipei|japan|tokyo|osaka|south\\s*korea|north\\s*korea|korea|seoul|china|mongolia|" +
  "hk|hkg|mo|mac|tw|twn|jp|jpn|kr|kor|cn|chn|mn|mng|kp|prk)(?:$|[^a-z]))";

// 自动选择排除带已知非东亚地区标签的节点，不判断线路方向。
const NON_EAST_ASIA_ALT =
  "美国|美國|洛杉矶|洛杉磯|圣何塞|聖何塞|西雅图|西雅圖|硅谷|纽约|紐約|新加坡|狮城|獅城|英国|英國|伦敦|倫敦|澳大利亚|澳大利亞|澳洲|悉尼|墨尔本|墨爾本|加拿大|多伦多|多倫多|温哥华|溫哥華|德国|德國|法兰克福|法蘭克福|法国|法國|巴黎|俄罗斯|俄羅斯|莫斯科|印度|孟买|孟買|越南|胡志明|泰国|泰國|曼谷|马来西亚|馬來西亞|吉隆坡|印尼|印度尼西亚|印度尼西亞|雅加达|雅加達|菲律宾|菲律賓|马尼拉|馬尼拉|荷兰|荷蘭|阿姆斯特丹|土耳其|伊斯坦布尔|伊斯坦堡|" +
  "🇺🇸|🇸🇬|🇬🇧|🇦🇺|🇨🇦|🇩🇪|🇫🇷|🇷🇺|🇮🇳|🇻🇳|🇹🇭|🇲🇾|🇮🇩|🇵🇭|🇳🇱|🇹🇷|" +
  "(?:^|[^a-z])(?:united\\s*states|america|los\\s*angeles|san\\s*jose|seattle|silicon\\s*valley|new\\s*york|singapore|united\\s*kingdom|britain|london|australia|sydney|melbourne|canada|toronto|vancouver|germany|frankfurt|france|paris|russia|moscow|india|mumbai|vietnam|ho\\s*chi\\s*minh|thailand|bangkok|malaysia|kuala\\s*lumpur|indonesia|jakarta|philippines|manila|netherlands|amsterdam|turkey|turkiye|istanbul|us|usa|sg|sgp|uk|gbr|gb|au|aus|ca|can|de|deu|fr|fra|ru|rus|in|ind|vn|vnm|th|tha|my|mys|id|idn|ph|phl|nl|nld|tr|tur)(?:$|[^a-z])";
const EAST_ASIA_EXCLUDE_PATTERN = `(?i)(?:${NON_EAST_ASIA_ALT}|${NODE_EXCLUDE_PATTERN})`;

// 所有 AI 组共用美国、日本、新加坡候选标签。
const AI_REGION_PATTERN =
  "(?i)(?:日本|东京|東京|大阪|japan|tokyo|osaka|🇯🇵|" +
  "新加坡|狮城|獅城|singapore|🇸🇬|" +
  "美国|美國|洛杉矶|洛杉磯|圣何塞|聖何塞|西雅图|西雅圖|硅谷|纽约|紐約|united\\s*states|🇺🇸|" +
  "(?:^|[^a-z])(?:jp|jpn|sg|sgp|us|usa)(?:$|[^a-z]))";

// 显式排除港澳标签，以及订阅信息和 Tailscale 节点。
const REGION_EXCLUDED_ALT =
  "🇭🇰|🇲🇴|香港|澳门|澳門|hong\\s*kong|macao|macau|(?:^|[^a-z])(?:hk|hkg|mo|mac)(?:$|[^a-z])";
const REGION_EXCLUDE_PATTERN = `(?i)(?:${REGION_EXCLUDED_ALT}|${NODE_EXCLUDE_ALT})`;



export function buildRoutingExtension(source, tailscaleMode = "off") {
  if (!["off", "interface", "tsnet", "both"].includes(tailscaleMode)) throw new Error("Invalid Tailscale mode");
  if (!source || !Array.isArray(source.providers) || !source.providers.length || !source.proxy_group || !source.release_base_url) throw new Error("Invalid rule sources");
  const auto = source.proxy_group;
  const ruleProviders = {};
  const groups = [{ name: auto, type: "url-test", url: TEST_URL, interval: 300, tolerance: 50, "include-all": true, filter: EAST_ASIA_REGION_PATTERN, "exclude-filter": EAST_ASIA_EXCLUDE_PATTERN, "empty-fallback": "REJECT" }];
  const rules = [];
  if (tailscaleMode !== "off") {
    const nodes = [];
    if (tailscaleMode === "interface" || tailscaleMode === "both") nodes.push("TAILSCALE-DIRECT");
    if (tailscaleMode === "tsnet" || tailscaleMode === "both") nodes.push("TAILSCALE");
    groups.push({ name: "Tailscale", type: "select", proxies: [...nodes, "DIRECT"], "default-selected": nodes[0] });
    rules.push("IP-CIDR,100.64.0.0/10,Tailscale,no-resolve", "IP-CIDR,100.100.100.100/32,Tailscale,no-resolve", "DOMAIN-SUFFIX,ts.net,Tailscale");
  }
  for (const target of new Set(source.providers.map((p) => p.target))) {
    if (BUILTINS.has(target) || target === source.proxy_group) continue;
    const name = target;
    if (target === "🛑 广告过滤" || target === "🔞 成人内容") groups.push({ name, type: "select", proxies: ["REJECT", "DIRECT"], "default-selected": "REJECT" });
    else if (["✨ Gemini", "Anthropic", "🤖 通用 AI"].includes(target)) {
      const general = target === "🤖 通用 AI";
      groups.push({ name, type: general ? "url-test" : "select", url: general ? "https://chatgpt.com/" : target === "✨ Gemini" ? "https://gemini.google.com/app" : "https://claude.ai/", ...(general ? { "expected-status": 200, interval: 90, timeout: 5000, tolerance: 50, lazy: false } : {}), "include-all": true, filter: AI_REGION_PATTERN, "exclude-filter": REGION_EXCLUDE_PATTERN, "empty-fallback": "REJECT" });
    } else groups.push({ name, type: "select", proxies: ["DIRECT", auto], "default-selected": target === "🇨🇳 国内服务" ? "DIRECT" : auto });
  }
  for (const provider of source.providers) {
    const behavior = provider.behavior ?? "classical";
    const extension = behavior === "domain" ? "txt" : "yaml";
    ruleProviders[provider.name] = { type: "http", behavior, format: behavior === "domain" ? "text" : "yaml", interval: 86400, url: `${source.release_base_url}/rules/${provider.name}.${extension}`, path: `./rules/${provider.name}.${extension}` };
    rules.push(`RULE-SET,${provider.name},${provider.target}${provider.no_resolve ? ",no-resolve" : ""}`);
  }
  groups.push({ name: "🐟 漏网之鱼", type: "select", proxies: ["DIRECT", auto], "default-selected": "DIRECT" });
  rules.push("MATCH,🐟 漏网之鱼");
  return { ruleProviders, groups, rules, tailscaleMode };
}

function applyRoutingExtension(config, extension) {
  const mapping = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
  if (!mapping(config)) throw new Error("Configuration must be an object");
  if (Object.prototype.hasOwnProperty.call(config, "proxies") && !Array.isArray(config.proxies)) throw new Error("Configuration proxies must be an array");
  const proxies = config.proxies || [];
  if (proxies.some((item) => !mapping(item) || typeof item.name !== "string")) throw new Error("Configuration contains invalid routing entries");
  const direct = { name: "TAILSCALE-DIRECT", type: "direct", "interface-name": "Tailscale" };
  const tsnet = { name: "TAILSCALE", type: "tailscale", "state-dir": "./tailscale", udp: true, "accept-routes": true, "ip-version": "ipv4-prefer" };
  const definitions = [direct, tsnet];
  const owned = (proxy) => ["[clash-rules] TAILSCALE", "[clash-rules] TAILSCALE-DIRECT"].includes(proxy.name) || definitions.some((node) => Object.keys(proxy).length === Object.keys(node).length && Object.keys(node).every((key) => proxy[key] === node[key]));
  const retained = proxies.filter((proxy) => !owned(proxy));
  const result = { ...config, "rule-providers": { ...extension.ruleProviders }, "proxy-groups": [...extension.groups], rules: [...extension.rules] };
  const nodes = [];
  if (extension.tailscaleMode === "interface" || extension.tailscaleMode === "both") nodes.push(direct);
  if (extension.tailscaleMode === "tsnet" || extension.tailscaleMode === "both") {
    nodes.push(tsnet);
    const dns = config.dns;
    if (mapping(dns) && dns["enhanced-mode"] === "fake-ip" && (!Object.prototype.hasOwnProperty.call(dns, "fake-ip-filter-mode") || dns["fake-ip-filter-mode"] === "blacklist") && (!Object.prototype.hasOwnProperty.call(dns, "fake-ip-filter") || Array.isArray(dns["fake-ip-filter"]))) {
      const filter = dns["fake-ip-filter"] || [];
      if (!filter.includes("controlplane.tailscale.com")) result.dns = { ...dns, "fake-ip-filter": [...filter, "controlplane.tailscale.com"] };
    }
  }
  for (const node of nodes) if (retained.some((proxy) => proxy.name === node.name)) throw new Error(`Tailscale node name conflict: ${node.name}`);
  if (Object.prototype.hasOwnProperty.call(config, "proxies") || nodes.length) result.proxies = [...retained, ...nodes];
  return result;
}

export function renderFlClashScript({ source, tailscaleMode = "off" }) {
  const data = buildRoutingExtension(source, tailscaleMode);
  return `function main(config) {\n  return (${applyRoutingExtension.toString().replace(/\r\n/g, "\n")})(config, ${JSON.stringify(data)});\n}\n`;
}

async function main() {
  const args = process.argv.slice(2);
  let outputDir = path.join(ROOT, "dist", "scripts");
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--help" || args[i] === "-h") { console.log("Usage: node scripts/render-flclash-script.mjs [--output-dir DIR]\nDefault: dist/scripts"); return; }
    if (args[i] === "--output-dir" && args[i + 1] && !args[i + 1].startsWith("-")) { outputDir = path.resolve(args[++i]); continue; }
    throw new Error("Invalid arguments");
  }
  const source = JSON.parse(await readFile(path.join(ROOT, "sources.json"), "utf8"));
  if (path.basename(outputDir) === "scripts") {
    const outputRoot = path.dirname(outputDir);
    await mkdir(outputRoot, { recursive: true });
    if ((await readdir(outputRoot)).length === 0) {
      await assertSafeOutputDirectory(outputRoot);
      await writeFile(path.join(outputRoot, OUTPUT_MARKER), OUTPUT_MARKER_CONTENT, { flag: "wx" });
    }
  }
  await mkdir(outputDir, { recursive: true });
  for (const [file, tailscaleMode] of Object.entries({ "flclash.js": "off", "flclash-desktop.js": "interface", "flclash-android.js": "tsnet", "flclash-both.js": "both" })) await writeFile(path.join(outputDir, file), renderFlClashScript({ source, tailscaleMode }));
  console.log(`Generated FlClash scripts in ${outputDir}`);
}
if (import.meta.main) main().catch((error) => { console.error(`render-flclash-script: ${error.message}`); process.exitCode = 1; });
