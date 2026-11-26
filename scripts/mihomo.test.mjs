import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { stringify } from "yaml";
import vm from "node:vm";
import { renderFlClashScript } from "./render-flclash-script.mjs";

const source = JSON.parse(await readFile(new URL("../sources.json", import.meta.url), "utf8"));
const generated = vm.runInNewContext(`${renderFlClashScript({ source })}; main`);
const aiGroups = ["🤖 通用 AI", "✨ Gemini"];
const cases = [
  { names: ["US01", "JP01", "SG01", "HK01-US", "MO01-SG01", "TW01"], groups: aiGroups, expected: ["JP01", "SG01", "US01"] },
  { names: ["DE01", "HK01-US"], groups: aiGroups, expected: ["REJECT"] },
  { names: ["HK01", "香港 02", "MO01", "香港中转-美国01", "HK01-SG01"], provider: ["Hong Kong 03", "HKG04", "TW01", "JP01", "US01-HK01", "HK01-JP01", "新加坡-日本01", "HK01-UK01"], groups: [source.proxy_group], expected: ["HK01", "HKG04", "Hong Kong 03", "香港 02"] },
  { names: ["US01-HK01", "JP01", "TW01"], provider: ["HK01-SG01", "HK01-JP01"], groups: [source.proxy_group], expected: ["REJECT"] },
  { names: ["US01"], provider: ["SG01"], groups: [source.proxy_group], expected: ["REJECT"] },
];
for (const { names, provider = [], groups, expected } of cases) {
  test(`Mihomo enforces ${groups.join(", ")} membership: ${[...names, ...provider].join(", ")}`, { skip: !process.env.MIHOMO_PATH }, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "clash-core-test-"));
    let child;
    try {
      const listener = net.createServer();
      listener.listen(0, "127.0.0.1");
      await once(listener, "listening");
      const port = listener.address().port;
      await new Promise((resolve) => listener.close(resolve));
      const config = generated({ proxies: names.map((name) => ({ name, type: "socks5", server: "127.0.0.1", port: 9 })) });
      delete config["rule-providers"];
      config.rules = ["MATCH,REJECT"];
      if (provider.length) {
        const providerFile = path.join(root, "provider.yaml");
        await writeFile(providerFile, stringify({ proxies: provider.map((name) => ({ name, type: "socks5", server: "127.0.0.1", port: 9 })) }));
        config["proxy-providers"] = { fixture: { type: "file", path: providerFile } };
      }
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
          if (response.ok) {
            const candidate = (await response.json()).proxies;
            if (groups.every((group) => candidate?.[group])) { proxies = candidate; break; }
          }
        } catch {}
        if (child.exitCode !== null) break;
        await delay(50);
      }
      assert.ok(proxies, "Mihomo did not initialize the requested groups");
      for (const group of groups) {
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
