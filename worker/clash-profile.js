/**
 * Cloudflare Worker：按查询参数动态注入 Tailscale 出口。
 *
 * 订阅地址形如：
 *   https://clash-profile.example.com/s/<secret>             → Tailscale 组只有 DIRECT
 *   https://clash-profile.example.com/s/<secret>?ts=interface → 注入 TAILSCALE-DIRECT（桌面端）
 *   https://clash-profile.example.com/s/<secret>?ts=tsnet     → 注入内嵌 tsnet 节点（Android）
 *   https://clash-profile.example.com/s/<secret>?ts=both      → 两个都注入
 *
 * tsnet 的 auth key 由链接注入（等价于旧 Sub-Store 的 tailscale-secret 参数）：
 *   ?ts=tsnet&tskey=tskey-auth-xxxxx
 *   ?ts=tsnet&tailscale-secret=tskey-auth-xxxxx   旧参数名，同样接受
 * 链接没带 key 时回退到 TS_AUTH_KEY secret（若已配置）。
 *
 * 绑定：
 *   PROFILE_KV   KV，key = profile.yaml，内容是带占位符的 profile
 *   SECRET_PATH  订阅路径（plain_text）
 *   TS_AUTH_KEY  可选 secret_text，链接未带 key 时的回退值
 *   TS_INTERFACE 可选 plain_text，默认为 Tailscale
 */

const PROXIES_PLACEHOLDER = "  __TAILSCALE_PROXIES__";
const GROUP_PLACEHOLDER = "[__TAILSCALE_GROUP__]";
const DEFAULT_PLACEHOLDER = "__TAILSCALE_DEFAULT__";

const yamlString = (value) => JSON.stringify(String(value));

const VALID_MODES = new Set(["off", "interface", "tsnet", "both"]);

const badRequest = (message) =>
  new Response(`bad request: ${message}\n`, {
    status: 400,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });

const buildTailscaleBlock = (mode, interfaceName, authKey) => {
  const lines = [];
  const group = [];
  if (mode === "interface" || mode === "both") {
    lines.push(
      `  - name: TAILSCALE-DIRECT`,
      "    type: direct",
      `    interface-name: ${yamlString(interfaceName)}`
    );
    group.push("TAILSCALE-DIRECT");
  }
  if (mode === "tsnet" || mode === "both") {
    lines.push(
      "  - name: TAILSCALE",
      "    type: tailscale",
      `    auth-key: ${yamlString(authKey)}`,
      "    state-dir: ./tailscale",
      "    udp: true",
      "    accept-routes: true",
      "    ip-version: ipv4-prefer"
    );
    group.push("TAILSCALE");
  }
  group.push("DIRECT");
  return {
    text: lines.length ? `${lines.join("\n")}\n` : "",
    group,
    defaultSelected: group[0],
  };
};

const TS_AUTH_KEY_PATTERN = /^tskey-[A-Za-z0-9_-]{8,}$/;

/** 链接注入优先；没有则回退到 Worker secret。 */
const resolveAuthKey = (url, env) => {
  const fromUrl = (
    url.searchParams.get("tskey") ||
    url.searchParams.get("tailscale-secret") ||
    ""
  ).trim();
  if (fromUrl) {
    if (!TS_AUTH_KEY_PATTERN.test(fromUrl)) return { error: "tskey is not a valid Tailscale auth key" };
    return { key: fromUrl };
  }
  const fallback = (env.TS_AUTH_KEY || "").trim();
  if (fallback) return { key: fallback };
  return { error: "ts=tsnet requires &tskey=tskey-auth-... in the URL (or the TS_AUTH_KEY secret)" };
};

const injectTailscale = (profile, url, env) => {
  const mode = (url.searchParams.get("ts") || "off").trim().toLowerCase();
  if (!VALID_MODES.has(mode)) {
    return { error: `ts must be one of: ${[...VALID_MODES].join(", ")}` };
  }

  const interfaceName = (url.searchParams.get("iface") || env.TS_INTERFACE || "Tailscale").trim();
  if (!/^[A-Za-z0-9 ._-]{1,64}$/.test(interfaceName)) {
    return { error: "iface contains unsupported characters" };
  }

  let authKey = "";
  if (mode === "tsnet" || mode === "both") {
    const resolved = resolveAuthKey(url, env);
    if (resolved.error) return { error: resolved.error };
    authKey = resolved.key;
  }

  const block = buildTailscaleBlock(mode, interfaceName, authKey);

  let body = profile;
  body = body.replace(`${PROXIES_PLACEHOLDER}\n`, block.text);
  // 没有静态节点且未注入 Tailscale 时，避免出现空的 `proxies:` 键。
  body = body.replace(/^proxies:\n\n/gm, "proxies: []\n\n");
  body = body.replace(GROUP_PLACEHOLDER, `[${block.group.join(", ")}]`);
  body = body.replace(DEFAULT_PLACEHOLDER, block.defaultSelected);
  return { body };
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname !== env.SECRET_PATH) {
      return new Response("Not Found", { status: 404 });
    }

    const profile = await env.PROFILE_KV.get("profile.yaml");
    if (!profile) {
      return new Response("Not Found", { status: 404 });
    }

    const result = injectTailscale(profile, url, env);
    if (result.error) return badRequest(result.error);

    return new Response(result.body, {
      headers: {
        "Content-Type": "text/yaml; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  },
};
