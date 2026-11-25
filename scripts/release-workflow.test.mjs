import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { parse } from "yaml";

const workflow = parse(await readFile(new URL("../.github/workflows/release.yml", import.meta.url), "utf8"));
const profileWorkflow = parse(await readFile(new URL("../.github/workflows/deploy-profile.yml", import.meta.url), "utf8"));

test("profile source changes publish rules before triggering the profile", () => {
  assert.equal(profileWorkflow.on.push, undefined);
  assert.ok(profileWorkflow.on.workflow_run.workflows.includes(workflow.name));
  assert.ok(profileWorkflow.jobs.deploy.if.includes("conclusion == 'success'"));
  for (const input of [".github/workflows/deploy-profile.yml", "scripts/publish-flclash-profile.mjs", "scripts/verify-published-rules.mjs", "sources.json"]) {
    assert.ok(workflow.on.push.paths.includes(input), input);
  }
});

const syncStep = workflow.jobs.publish.steps.find(({ name }) => name === "Sync release branch");
const bash = process.platform === "win32" ? path.join(process.env.ProgramFiles, "Git", "bin", "bash.exe") : "bash";
const run = (command, args, cwd, env = process.env) => {
  const result = spawnSync(command, args, { cwd, env, encoding: "utf8", timeout: 30_000 });
  assert.equal(result.status, 0, `${command}: ${result.error?.message ?? ""}\n${result.stdout}\n${result.stderr}`);
  return result.stdout.trim();
};

for (const legacyProviders of [[], ["dev_services"], ["openai"], ["dev_services", "openai"]]) {
  test(`release sync preserves legacy providers: ${legacyProviders.join(", ") || "none"}`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "clash-release-test-"));
    try {
      const origin = path.join(root, "origin.git");
      const checkout = path.join(root, "checkout");
      const runner = path.join(root, "runner");
      await mkdir(checkout);
      await mkdir(runner);
      run("git", ["init", "--bare", origin], root);
      run("git", ["init"], checkout);
      run("git", ["config", "user.name", "Rule test"], checkout);
      run("git", ["config", "user.email", "rule-test@example.test"], checkout);
      run("git", ["remote", "add", "origin", origin], checkout);
      await mkdir(path.join(checkout, "rules"));
      await mkdir(path.join(checkout, "custom"));
      await writeFile(path.join(checkout, "rules", "old.yaml"), "payload: [DOMAIN,old.test]\n");
      const legacyTexts = {
        dev_services: "payload:\n  - DOMAIN-SUFFIX,developer.test\n",
        openai: "payload:\n  - DOMAIN-SUFFIX,openai.test\n",
      };
      for (const provider of legacyProviders) await writeFile(path.join(checkout, "rules", `${provider}.yaml`), legacyTexts[provider]);
      await writeFile(path.join(checkout, "custom", "foreign.txt"), "DOMAIN-SUFFIX,custom.test\n");
      run("git", ["add", "."], checkout);
      run("git", ["commit", "-m", "Seed publication"], checkout);
      run("git", ["push", "origin", "HEAD:release"], checkout);
      await mkdir(path.join(checkout, "dist", "rules"), { recursive: true });
      const publishedText = "payload:\n  - DOMAIN-SUFFIX,new.test\n";
      await writeFile(path.join(checkout, "dist", "rules", "foreign_services.yaml"), publishedText);
      const script = syncStep.run.replaceAll("${{ github.run_number }}", "1");
      run(bash, ["-euo", "pipefail", "-c", script], checkout, { ...process.env, RUNNER_TEMP: runner });
      const published = run("git", ["--git-dir", origin, "show", "release:rules/foreign_services.yaml"], root);
      assert.equal(published, publishedText.trim());
      const files = run("git", ["--git-dir", origin, "ls-tree", "-r", "--name-only", "release"], root).split("\n");
      assert.deepEqual(files.sort(), ["custom/foreign.txt", ...legacyProviders.map((provider) => `rules/${provider}.yaml`), "rules/foreign_services.yaml"].sort());
      for (const provider of legacyProviders) {
        assert.equal(run("git", ["--git-dir", origin, "show", `release:rules/${provider}.yaml`], root), legacyTexts[provider].trim());
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
