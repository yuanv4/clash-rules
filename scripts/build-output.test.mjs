import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { assertSafeOutputDirectory, replaceOutputDirectory } from "./build.mjs";

const root = path.resolve(import.meta.dirname, "..");
const marker = ".clash-rules-output";
const markerContent = "clash-rules generated output v1\n";

test("script generation initializes a replaceable output root without claiming user files", async () => {
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "clash-script-output-test-"));
  const cli = fileURLToPath(new URL("./render-flclash-script.mjs", import.meta.url));
  const generate = (dir) => spawnSync(process.execPath, [cli, "--output-dir", dir], { encoding: "utf8" });
  try {
    const output = path.join(fixture, "dist");
    const scripts = path.join(output, "scripts");
    let result = generate(scripts);
    assert.equal(result.status, 0, result.stderr);
    await assertSafeOutputDirectory(output);
    const names = (await fs.readdir(scripts)).sort();
    assert.deepEqual(names, ["flclash-android.js", "flclash-both.js", "flclash-desktop.js", "flclash.js"]);
    const first = await Promise.all(names.map((name) => fs.readFile(path.join(scripts, name), "utf8")));
    result = generate(scripts);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(await Promise.all((await fs.readdir(scripts)).sort().map((name) => fs.readFile(path.join(scripts, name), "utf8"))), first);
    const staging = path.join(fixture, "staging");
    await fs.mkdir(staging);
    await fs.writeFile(path.join(staging, marker), markerContent);
    await fs.mkdir(path.join(staging, "rules"));
    await replaceOutputDirectory(staging, output);
    assert.deepEqual((await fs.readdir(output)).sort(), [marker, "rules"]);

    const userRoot = path.join(fixture, "user");
    await fs.mkdir(userRoot);
    await fs.writeFile(path.join(userRoot, "important.txt"), "keep");
    assert.equal(generate(path.join(userRoot, "scripts")).status, 0);
    await assert.rejects(assertSafeOutputDirectory(userRoot), /unmarked/);
    assert.equal(await fs.readFile(path.join(userRoot, "important.txt"), "utf8"), "keep");
    await assert.rejects(fs.access(path.join(userRoot, marker)), { code: "ENOENT" });

    const arbitrary = path.join(fixture, "other-output");
    assert.equal(generate(arbitrary).status, 0);
    await assert.rejects(fs.access(path.join(fixture, marker)), { code: "ENOENT" });
  } finally {
    await fs.rm(fixture, { recursive: true, force: true });
  }
});

// All destructive checks use newly-created, disposable fixtures, never user output.
test("rejects repository, ancestors and source output directories", async () => {
  for (const target of [root, path.dirname(root), ...["scripts", "worker", "docs", "custom", ".github", ".git"].map(p => path.join(root, p, "output"))]) {
    await assert.rejects(assertSafeOutputDirectory(target), /protected output/);
  }
});

test("only replaces empty or explicitly marked output and preserves unrelated files", async () => {
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "clash-build-output-test-"));
  try {
    const output = path.join(fixture, "output");
    const staging = path.join(fixture, "staging");
    const alias = path.join(fixture, "source-alias");
    await fs.symlink(path.join(root, "scripts"), alias, "junction");
    await assert.rejects(assertSafeOutputDirectory(path.join(alias, "output")), /protected output/);
    await assertSafeOutputDirectory(output);
    await fs.mkdir(output);
    await assertSafeOutputDirectory(output);
    await fs.writeFile(path.join(output, "important.txt"), "keep");
    await fs.mkdir(staging);
    await fs.writeFile(path.join(staging, marker), markerContent);
    await fs.mkdir(path.join(staging, "rules"));
    await assert.rejects(replaceOutputDirectory(staging, output), /unmarked/);
    assert.equal(await fs.readFile(path.join(output, "important.txt"), "utf8"), "keep");
    await fs.writeFile(path.join(output, marker), markerContent);
    await assert.rejects(replaceOutputDirectory(staging, output), /Unexpected files/);
    await fs.unlink(path.join(output, "important.txt"));
    await fs.writeFile(path.join(output, marker), "wrong");
    await assert.rejects(assertSafeOutputDirectory(output), /unmarked/);
    await fs.writeFile(path.join(output, marker), markerContent);
    await replaceOutputDirectory(staging, output);
    assert.deepEqual((await fs.readdir(output)).sort(), [marker, "rules"]);
    await assertSafeOutputDirectory(output);
  } finally {
    await fs.rm(fixture, { recursive: true, force: true });
  }
});
