/**
 * Cloudflare Worker：按查询参数动态注入 Tailscale 出口。
 *
 * 订阅地址形如：
 *   https://clash-profile.example.com/s/<secret>             → Tailscale 组只有 DIRECT
 *   https://clash-profile.example.com/s/<secret>?ts=interface → 注入 TAILSCALE-DIRECT（桌面端）
 *   https://clash-profile.example.com/s/<secret>?ts=tsnet     → 注入内嵌 tsnet 节点（Android）
 *   https://clash-profile.example.com/s/<secret>?ts=both      → 两个都注入
 *
 * 绑定：
 *   PROFILE_KV   KV，key = profile.yaml，内容是带占位符的 profile
 *   SECRET_PATH  订阅路径（plain_text）
 *   TS_AUTH_KEY  可选 secret_text，tsnet 模式的 auth key
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

const injectTailscale = (profile, url, env) => {
  const mode = (url.searchParams.get("ts") || "off").trim().toLowerCase();
  if (!VALID_MODES.has(mode)) {
    return { error: `ts must be one of: ${[...VALID_MODES].join(", ")}` };
  }

  const interfaceName = (url.searchParams.get("iface") || env.TS_INTERFACE || "Tailscale").trim();
  if (!/^[A-Za-z0-9 ._-]{1,64}$/.test(interfaceName)) {
    return { error: "iface contains unsupported characters" };
  }

  if (mode === "tsnet" || mode === "both") {
    if (!env.TS_AUTH_KEY) {
      return { error: "ts=tsnet requires the TS_AUTH_KEY secret to be configured" };
    }
  }

  const block = buildTailscaleBlock(mode, interfaceName, env.TS_AUTH_KEY);

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
