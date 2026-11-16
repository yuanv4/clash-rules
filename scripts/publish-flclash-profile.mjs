#!/usr/bin/env node
/**
 * 把生成的 FlClash profile 推送到 Cloudflare Workers KV。
 *
 * 环境变量：
 *   CF_API_TOKEN        必填，需具备 Workers KV Storage:Edit
 *   CF_ACCOUNT_ID       必填
 *   CF_KV_NAMESPACE_ID  必填
 *   CF_KV_KEY           可选，默认 profile.yaml
 *
 * 用法：node scripts/publish-flclash-profile.mjs <profile.yaml>
 */

import { promises as fs } from "node:fs";
import path from "node:path";

const API_BASE = "https://api.cloudflare.com/client/v4";

const requireEnv = (name) => {
  const value = process.env[name];
  if (!value || !value.trim()) throw new Error(`${name} is required`);
  return value.trim();
};

const usage = () =>
  process.stdout.write("Usage: node scripts/publish-flclash-profile.mjs <profile.yaml>\n");

const call = async (url, options) => {
  const response = await fetch(url, options);
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { status: response.status, body };
};

const main = async () => {
  const target = process.argv[2];
  if (!target || target === "-h" || target === "--help") {
    usage();
    process.exit(target ? 0 : 1);
  }

  const filePath = path.resolve(process.cwd(), target);
  const content = await fs.readFile(filePath, "utf8");
  if (content.trim().length === 0) throw new Error(`${filePath} is empty`);

  const token = requireEnv("CF_API_TOKEN");
  const accountId = requireEnv("CF_ACCOUNT_ID");
  const namespaceId = requireEnv("CF_KV_NAMESPACE_ID");
  const key = (process.env.CF_KV_KEY || "profile.yaml").trim();

  // 单键 PUT 接口在部分账号上返回 10013，统一走 bulk。
  const publish = await call(
    `${API_BASE}/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/bulk`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([{ key, value: content }]),
    }
  );

  if (!publish.body?.success) {
    const detail = JSON.stringify(publish.body?.errors ?? publish.body ?? {});
    throw new Error(`KV publish failed (HTTP ${publish.status}): ${detail}`);
  }

  const keys = await call(
    `${API_BASE}/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/keys`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const names = (keys.body?.result ?? []).map((entry) => entry.name);

  process.stdout.write(
    `Published ${path.basename(filePath)} -> ${namespaceId.slice(0, 8)}…/${key} ` +
      `(${Buffer.byteLength(content)} bytes); keys now: ${names.join(", ") || "(none)"}\n`
  );
};

main().catch((error) => {
  process.stderr.write(`publish-flclash-profile: ${error.message}\n`);
  process.exit(1);
});
