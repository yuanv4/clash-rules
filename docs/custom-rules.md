# Custom foreign-service rules

The custom rules live in [`custom/foreign.txt`](../custom/foreign.txt) and are merged into the
existing `foreign_services` provider. No separate provider, rule set, or proxy group is created.

## Source input

`sources.json` declares the source once, using the release branch as the public raw source:

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

and appends it to the existing provider input list:

```json
{"input": "yuanv4/clash-rules", "path": "custom/foreign.txt"}
```

The file uses the same classical syntax as the other inputs. It currently contains:

```text
DOMAIN-SUFFIX,69shuba.com
```

The build merges it into `dist/rules/foreign_services.yaml`; the Sub-Store override still emits
`RULE-SET,foreign_services,🌐 国外服务,no-resolve`. No `custom` rule-provider entry is generated.

## Release publication

The release branch is the single public artifact branch. It contains:

- `custom/*.txt` source files;
- `rules/*.yaml` and `rules/*.txt` providers;
- `sub-store-override.js` and `sub-store-override-android.js`.

The build reads `custom/foreign.txt` from the checkout, while retaining its release URL
for provenance. Other configured sources are fetched over HTTPS. After a successful build, **Sync release branch** publishes the custom sources
and generated artifacts together in one commit.

At runtime the override's `rule-providers` URL also points at release:
`https://raw.githubusercontent.com/yuanv4/clash-rules/release/rules/foreign_services.yaml`
([render-substore-override.mjs:44](../scripts/render-substore-override.mjs#L44)).

## Ordering

Inputs are merged in the order listed under `foreign_services.inputs`. The custom file is appended
last, after the eight upstream inputs. Identical rules are deduplicated; all rules in this provider
use the same target.

## Build timing

The release workflow watches both `sources.json` and `custom/**`. If the build fails, the
release branch remains unchanged; re-run the workflow to publish the source and artifacts.

`69shuba.com` previously matched `MATCH,🐟 漏网之鱼` (default `DIRECT`); it now matches
`foreign_services` and goes to `🌐 国外服务`.
