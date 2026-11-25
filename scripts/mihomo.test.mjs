import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { parse, stringify } from "yaml";
import { renderProfile } from "./render-flclash-profile.mjs";
import { injectTailscale } from "../worker/clash-profile.js";

const source = JSON.parse(await readFile(new URL("../sources.json", import.meta.url), "utf8"));
for (const names of [["US01", "JP01", "SG01", "HK01-US", "MO01-SG01", "TW01"], ["DE01", "HK01-US"]]) {
  test(`Mihomo enforces AI candidate membership: ${names.join(", ")}`, { skip: !process.env.MIHOMO_PATH }, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "clash-core-test-"));
    let child;
    try {
      const listener = net.createServer();
      listener.listen(0, "127.0.0.1");
      await once(listener, "listening");
      const port = listener.address().port;
      await new Promise((resolve) => listener.close(resolve));
      const local = names.map((name) => `- {name: ${JSON.stringify(name)}, type: socks5, server: 127.0.0.1, port: 9}`);
      const template = renderProfile(source, JSON.stringify({ local }));
      const config = parse(injectTailscale(template, new URL("https://example.test/?ts=off")).body);
      delete config["rule-providers"];
      delete config.dns;
      config.rules = ["MATCH,REJECT"];
      config["mixed-port"] = 0;
      config["external-controller"] = `127.0.0.1:${port}`;
      const file = path.join(root, "config.yaml");
      await writeFile(file, stringify(config));
      child = spawn(process.env.MIHOMO_PATH, ["-d", root, "-f", file], { stdio: "ignore" });
      const exited = once(child, "exit");
      child.on("error", () => {});
      let proxies;
      for (let attempt = 0; attempt < 100; attempt++) {
        try {
          const response = await fetch(`http://127.0.0.1:${port}/proxies`, { signal: AbortSignal.timeout(300) });
          if (response.ok) { proxies = (await response.json()).proxies; break; }
        } catch {}
        if (child.exitCode !== null) break;
        await delay(50);
      }
      assert.ok(proxies, "Mihomo controller did not start");
      const expected = names.includes("US01") ? ["JP01", "SG01", "US01"] : ["REJECT"];
      for (const group of ["🤖 通用 AI", "Anthropic", "✨ Gemini"]) {
        assert.deepEqual([...proxies[group].all].sort(), expected, group);
      }
      child.kill();
      await exited;
      child = undefined;
    } finally {
      if (child && child.exitCode === null) {
        const exited = once(child, "exit");
        child.kill();
        await exited;
      }
      await rm(root, { recursive: true, force: true });
    }
  });
}
