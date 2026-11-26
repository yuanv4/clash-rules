# Custom foreign-service rules

The rules in [`custom/foreign.txt`](../custom/foreign.txt) are merged into the existing `foreign_services` provider. They do not create another rule set or proxy group.

## Source input

[`sources.json`](../sources.json) declares the local source with its public release URL for provenance:

```json
{
	"name": "yuanv4/clash-rules",
	"repository": "https://github.com/yuanv4/clash-rules",
	"base_url": "https://raw.githubusercontent.com/yuanv4/clash-rules/release/",
	"license": {
		"id": "MIT",
		"url": "https://spdx.org/licenses/MIT.html"
	},
	"input_format": "raw-list"
}
```

The `foreign_services.inputs` list includes this source:

```json
{"input": "yuanv4/clash-rules", "path": "custom/foreign.txt"}
```

The file uses classical rules without an outbound target. For example:

```text
DOMAIN-SUFFIX,69shuba.com
```

The build reads the file from the checkout and merges it into `dist/rules/foreign_services.yaml`. The extension script points that rule set at `国外服务`.

## Release publication

The [release workflow](../.github/workflows/release.yml) publishes these artifacts together:

- `custom/*.txt` source files;
- `rules/*.yaml` and `rules/*.txt` providers;
- the four FlClash extension scripts in `scripts/`.

The runtime rule-provider URL is:

```text
https://raw.githubusercontent.com/yuanv4/clash-rules/release/rules/foreign_services.yaml
```

The workflow watches `sources.json` and `custom/**`. A failed build does not update the release branch.

## Matching order

Inputs are merged in their configured order, with duplicate rules removed. A domain in this file cannot override an earlier blocking or domestic-service rule that already matches it.

The extension replaces the airport's `rules`, `proxy-groups`, and `rule-providers`, while keeping its DNS, hosts, nodes, and other settings. Unmatched traffic reaches the project's final catch-all group, which defaults to `DIRECT`. Adding a domain here routes it through the foreign-service group instead.
