#!/usr/bin/env node
/**
 * 部署 worker/clash-profile.js 到 Cloudflare Workers。
 *
 * Worker 会按订阅 URL 的查询参数动态注入 Tailscale 出口，所以 profile 里的
 * 占位符必须由它替换。更新顺序要求：先部署 Worker，再推送带占位符的 profile。
 *
 * 环境变量：
 *   CF_API_TOKEN          必填，需 Workers Scripts:Edit（KV 由 CI 负责，这里不写 KV）
 *   CF_ACCOUNT_ID         必填
 *   CF_KV_NAMESPACE_ID    必填，PROFILE_KV 绑定
 *   CF_SECRET_PATH        必填，订阅路径，如 /s/xxxx
 *
 * 用法：node scripts/deploy-clash-worker.mjs
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPT_DIR, "..");
const WORKER_PATH = path.join(ROOT_DIR, "worker", "clash-profile.js");
const API_BASE = "https://api.cloudflare.com/client/v4";
const SCRIPT_NAME = "clash-profile";

const requireEnv = (name) => {
  const value = process.env[name];
  if (!value || !value.trim()) throw new Error(`${name} is required`);
  return value.trim();
};

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
  const token = requireEnv("CF_API_TOKEN");
  const accountId = requireEnv("CF_ACCOUNT_ID");
  const namespaceId = requireEnv("CF_KV_NAMESPACE_ID");
  const secretPath = requireEnv("CF_SECRET_PATH");
  if (!secretPath.startsWith("/")) throw new Error("CF_SECRET_PATH must start with /");

  const source = await fs.readFile(WORKER_PATH, "utf8");

  const bindings = [
    { type: "kv_namespace", name: "PROFILE_KV", namespace_id: namespaceId },
    { type: "plain_text", name: "SECRET_PATH", text: secretPath },
  ];

  const metadata = {
    main_module: "index.js",
    compatibility_date: "2026-11-01",
    bindings,
  };

  const form = new FormData();
  form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
  form.append("index.js", new Blob([source], { type: "application/javascript+module" }), "index.js");

  const upload = await call(`${API_BASE}/accounts/${accountId}/workers/scripts/${SCRIPT_NAME}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!upload.body?.success) {
    throw new Error(`Worker upload failed (HTTP ${upload.status}): ${JSON.stringify(upload.body?.errors ?? {})}`);
  }

  process.stdout.write(
    `Deployed ${SCRIPT_NAME} (${Buffer.byteLength(source)} bytes); bindings: ` +
      `${bindings.map((binding) => binding.name).join(", ")}\n`
  );
};

main().catch((error) => {
  process.stderr.write(`deploy-clash-worker: ${error.message}\n`);
  process.exit(1);
});
