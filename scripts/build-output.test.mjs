import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { test } from "bun:test";
import { assertSafeOutputDirectory, replaceOutputDirectory } from "./build.mjs";

const root = path.resolve(import.meta.dir, "..");
const marker = ".clash-rules-output";
const markerContent = "clash-rules generated output v1\n";

// All destructive checks use newly-created, disposable fixtures, never user output.
test("rejects repository, ancestors and source output directories", async () => {
  for (const target of [root, path.dirname(root), ...["scripts", "worker", "docs", "custom", ".github", ".git"].map(p => path.join(root, p, "output"))]) {
    await assert.rejects(assertSafeOutputDirectory(target), /protected output/);
  }
});

test("only replaces empty or explicitly marked output and preserves unrelated files", async () => {
  const fixture = await fs.mkdtemp(path.join(root, ".cf-build-output-test-"));
  assert.equal(path.dirname(fixture), root);
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
