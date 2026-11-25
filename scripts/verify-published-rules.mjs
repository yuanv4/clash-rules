import { readFile } from "node:fs/promises";
import { normalizeConfiguration, loadSource, parseRules, renderDomainText, renderYaml } from "./build.mjs";

export const verifyPublishedRules = async (source, readPublished = (url) => loadSource({ inputName: "published", sourceUrl: url })) => {
  const { providers, releaseBaseUrl } = normalizeConfiguration(source);
  for (const provider of providers) {
    const domain = provider.behavior === "domain";
    const url = `${releaseBaseUrl}/rules/${provider.name}.${domain ? "txt" : "yaml"}`;
    const published = await readPublished(url);
    const expected = (domain ? renderDomainText : renderYaml)(provider, []);
    const metadataPattern = /^# (?:Source|License|Included rule types)/u;
    const metadata = expected.split("\n").filter((line) => metadataPattern.test(line));
    const publishedMetadata = new Set(published.split(/\r?\n/u).filter((line) => metadataPattern.test(line)));
    if (metadata.length !== publishedMetadata.size || !metadata.every((line) => publishedMetadata.has(line))) {
      throw new Error(`Published provider ${provider.name} does not match the configured sources; publish rules before the profile`);
    }
    parseRules(published, url, domain ? "domain-text" : "clash-yaml");
  }
};

if (import.meta.main) {
  try {
    const source = JSON.parse(await readFile(new URL("../sources.json", import.meta.url), "utf8"));
    await verifyPublishedRules(source);
    console.log("Published rule providers are ready for this profile");
  } catch (error) {
    console.error(`verify-published-rules: ${error.message}`);
    process.exitCode = 1;
  }
}
