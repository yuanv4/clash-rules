import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseRules } from "./build.mjs";
import vm from "node:vm";
import { renderFlClashScript } from "./render-flclash-script.mjs";

export const matchesDomain = (rule, domain) => {
  switch (rule.type) {
    case "DOMAIN": return domain === rule.value;
    case "DOMAIN-SUFFIX": return domain === rule.value || domain.endsWith(`.${rule.value}`);
    case "DOMAIN-KEYWORD": return domain.includes(rule.value);
    case "DOMAIN-WILDCARD": {
      const pattern = rule.value.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
      return new RegExp(`^${pattern}$`).test(domain);
    }
    case "DOMAIN-REGEX": return new RegExp(rule.value.replace(/^\(\?i\)/, ""), rule.value.startsWith("(?i)") ? "i" : "").test(domain);
    default: return false;
  }
};

const main = async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const rulesDir = process.argv[2];
  if (!rulesDir) throw new Error("Usage: node scripts/audit-ai-rules.mjs <built-rules-directory> [--list]");
  const source = JSON.parse(await readFile(path.join(root, "sources.json"), "utf8"));
  const main = vm.runInNewContext(`${renderFlClashScript({ source })}; main`);
  const generated = main({});
  const providers = generated.rules.map((rule) => rule.split(","))
    .filter(([type, key]) => type === "RULE-SET" && ["gemini", "anthropic", "ai"].includes(key))
    .map(([, key, target]) => ({ name: key, target }));
  const rules = await Promise.all(providers.map(async (provider) => ({
    ...provider,
    rules: parseRules(await readFile(path.join(rulesDir, `${provider.name}.yaml`), "utf8"), provider.name, "clash-yaml"),
  })));

  const probes = {
    OpenAI: "chatgpt.com", "OpenAI API": "api.openai.com", Codex: "chatgpt.com", Sora: "sora.com",
    Claude: "claude.ai", "Anthropic API": "api.anthropic.com", Gemini: "gemini.google.com",
    "Google AI Studio": "aistudio.google.com", NotebookLM: "notebooklm.google.com",
    Perplexity: "perplexity.ai", "Microsoft Copilot": "copilot.microsoft.com", "GitHub Copilot": "api.githubcopilot.com",
    "Grok / xAI": "grok.com", "xAI API": "api.x.ai", Poe: "poe.com", "Character.AI": "character.ai",
    "Meta AI": "meta.ai", Mistral: "mistral.ai", Cohere: "cohere.com", "You.com": "you.com",
    Phind: "phind.com", DuckDuckGo: "duck.ai", HuggingFace: "huggingface.co", OpenRouter: "openrouter.ai",
    Groq: "groq.com", Cerebras: "cerebras.ai", "Together AI": "together.ai", Replicate: "replicate.com",
    Fireworks: "fireworks.ai", Chutes: "chutes.ai", Cursor: "cursor.com", Windsurf: "windsurf.com",
    "Augment Code": "augmentcode.com", Replit: "replit.com", Bolt: "bolt.new", Lovable: "lovable.dev",
    v0: "v0.dev", Cline: "cline.bot", Continue: "continue.dev", Tabnine: "tabnine.com",
    Sourcegraph: "sourcegraph.com", CodeRabbit: "coderabbit.ai", Zed: "zed.dev", Kiro: "kiro.dev",
    "Amazon Q": "q.us-east-1.amazonaws.com", Midjourney: "midjourney.com", "Stability AI": "stability.ai",
    "Black Forest Labs": "bfl.ai", Civitai: "civitai.com", Runway: "runwayml.com", Pika: "pika.art",
    Suno: "suno.com", Udio: "udio.com", ElevenLabs: "elevenlabs.io", Synthesia: "synthesia.io",
    "Adobe Firefly": "firefly.adobe.com", Clipdrop: "clipdrop.co", Recraft: "recraft.ai",
    "Apple Intelligence": "apple-relay.apple.com",
    "Coze / Cici": "coze.com", Trae: "trae.ai", "Kimi overseas": "kimi.ai", "MiniMax overseas": "minimax.io",
    "Cloudflare AI": "ai.cloudflare.com", "DeepInfra": "deepinfra.com", Novita: "novita.ai", "H2O.ai": "h2o.ai",
    "Pi / Inflection": "pi.ai", Genspark: "genspark.ai", Manus: "manus.im", LMStudio: "lmstudio.ai",
    Ollama: "ollama.com", "LMArena / Arena": "arena.ai", "Artificial Analysis": "artificialanalysis.ai",
    Devin: "devin.ai", Factory: "factory.ai", "JetBrains AI": "jetbrains.ai", "Kilo Code": "kilo.ai",
    "Command Code": "commandcode.ai", "Amp / Cody": "ampcode.com", Qoder: "qoder.com", OpenCode: "opencode.ai",
    Dify: "dify.ai", LangChain: "langchain.com", CrewAI: "crewai.com", OpenClaw: "openclaw.ai",
    AnythingLLM: "anythingllm.com", Context7: "context7.com", YouMind: "youmind.ai", Sider: "sider.ai",
    "Grammarly": "grammarly.com", Jasper: "jasper.ai", Gamma: "gamma.app", "Otter": "otter.ai",
    Descript: "descript.com", Ideogram: "ideogram.ai", Leonardo: "leonardo.ai", "Luma": "lumalabs.ai",
    HeyGen: "heygen.com", OpenArt: "openart.ai", NovelAI: "novelai.net", "Tripo3D": "tripo3d.ai",
    "ComfyUI": "comfy.org", Lovart: "lovart.ai",
  };
  const domainChecks = Object.entries(probes).map(([service, domain]) => {
    for (const provider of rules) {
      const matched = provider.rules.find((rule) => matchesDomain(rule, domain));
      if (matched) return { service, domain, target: provider.target, matched: `${matched.type},${matched.value}` };
    }
    return { service, domain, target: null };
  });
  const processChecks = ["ChatGPT", "ChatGPT.exe", "Codex", "Codex.exe", "chatgpt", "codex", "Claude", "Claude.exe", "claude", "claude.exe", "cowork-svc.exe"].map((process) => ({
    process,
    target: rules.find((provider) => provider.rules.some((rule) => rule.type === "PROCESS-NAME" && rule.value === process))?.target ?? null,
  }));
  for (const check of domainChecks.filter(({ service }) => ["OpenAI", "OpenAI API", "Codex", "Sora", "Claude", "Anthropic API"].includes(service))) {
    assert.equal(check.target, ["Claude", "Anthropic API"].includes(check.service) ? "Anthropic" : "🤖 通用 AI", check.service);
  }
  for (const check of processChecks) {
    assert.equal(check.target, /claude|cowork/i.test(check.process) ? "Anthropic" : "🤖 通用 AI", check.process);
  }
  const networkChecks = [
    ["IP-CIDR", "199.47.142.0/23", "🤖 通用 AI"],
    ["IP-CIDR", "24.199.123.28/32", "🤖 通用 AI"],
    ["IP-CIDR", "64.23.132.171/32", "🤖 通用 AI"],
    ["IP-CIDR6", "2604:f20::/32", "🤖 通用 AI"],
    ["IP-ASN", "401518", "🤖 通用 AI"],
    ["IP-CIDR", "160.79.104.0/21", "Anthropic"],
    ["IP-CIDR6", "2607:6bc0::/32", "Anthropic"],
    ["IP-ASN", "399358", "Anthropic"],
  ].map(([type, value, expected]) => {
    const target = rules.find((provider) => provider.rules.some((rule) => rule.type === type && rule.value === value))?.target ?? null;
    assert.equal(target, expected, `${type},${value}`);
    return { type, value, target };
  });
  const dedicatedRules = new Set(rules.filter(({ name }) => name !== "ai").flatMap(({ rules }) => rules.map((rule) => JSON.stringify(rule))));
  const unshadowedNonDomainRules = rules.find(({ name }) => name === "ai").rules.filter((rule) => !rule.type.startsWith("DOMAIN") && !dedicatedRules.has(JSON.stringify(rule)));
  console.log(JSON.stringify({
    scope: "First matching domain rule among Gemini, Anthropic, and general AI providers. Excludes earlier blocking rules, IP, process, DNS, and live connectivity checks. A null target means these AI providers did not match the probe domain.",
    providerOrder: providers.map(({ name }) => name),
    domainChecks,
    processChecks,
    networkChecks,
    unshadowedNonDomainRules,
    ...(process.argv.includes("--list") ? { generalAiRules: rules.find(({ name }) => name === "ai").rules } : {}),
  }, null, 2));
};

if (import.meta.main) main().catch((error) => {
  console.error(`audit-ai-rules: ${error.message}`);
  process.exitCode = 1;
});
