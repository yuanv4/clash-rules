# Shared `dns.fake-ip-filter`

`fake-ip-filter` is a list of domains that must resolve to real addresses even when the client runs
`dns.enhanced-mode: fake-ip`. It contains only domain suffixes, so unlike `listen`, `nameserver`, or
`fake-ip-range` it is not device-specific. It is therefore published once from the subscription
instead of being repeated in every client's local override.

## Configuration

The list lives in [`sources.json`](../sources.json) under the root key `fake_ip_filter`:

```json
"fake_ip_filter": [
  "+.github.com",
  "+.githubusercontent.com",
  "+.githubassets.com",
  "+.github.io",
  "+.msftncsi.com",
  "+.msftconnecttest.com"
]
```

GitHub entries exist because the editor and CLI tooling want real addresses instead of fake ones.
The two Microsoft entries cover Windows connectivity probes: mihomo's built-in defaults contain
`dns.msftnsci.com` and `www.msftnsci.com` (note `msftnsci`), so the real `msftncsi.com` probe name never
matches them; `+.msftncsi.com` and `+.msftconnecttest.com` cover `dns.msftncsi.com`,
`www.msftconnecttest.com`, and their siblings.

Entries must be domain suffixes: `example.com` or `+.example.com` (the `+.` form covers the domain and
its subdomains). Wildcards, CIDR ranges, and other mihomo filter syntax are rejected so the shared
list cannot silently change resolver behavior beyond DNS exemptions. Order is preserved and duplicate
entries are dropped.

The build validates the list in `normalizeConfiguration` and passes it to
[`renderSubstoreOverride`](../scripts/render-substore-override.mjs), which emits a merge step into the
generated `sub-store-override*.js` artifacts:

```js
const sharedFakeIpFilter = ["+.github.com", /* ... */];
const sharedDns = config.dns !== null && typeof config.dns === 'object' && !Array.isArray(config.dns) ? config.dns : {};
const existingFakeIpFilter = Array.isArray(sharedDns['fake-ip-filter']) ? sharedDns['fake-ip-filter'] : [];
config.dns = { ...sharedDns, 'fake-ip-filter': [...new Set([...existingFakeIpFilter, ...sharedFakeIpFilter])] };
```

The merge is deliberate: an upstream subscription or another Sub-Store script may already publish
`dns.fake-ip-filter`, and replacing the array would drop those entries. The override only contributes
this array — it never writes `enhanced-mode`, `nameserver`, or any other DNS key, which stay
client-specific.

## Scope and limits

- The list applies to every client consuming the subscription, not just the machine that requested it.
- It only matters when the client actually runs fake-ip mode. A client using `redir-host` ignores it.
- Some clients regenerate the `dns` section from their own settings and may discard the subscription's
  value. After publishing, switch subscriptions on one device and inspect the generated `config.yaml`:
  if `dns.fake-ip-filter` still contains these entries, the shared list is in effect; if it is missing,
  that client replaces `dns` wholesale and the entries have to be added in its local override instead.
- Excluding a domain from fake-ip means it is resolved through the client's real resolvers. Only add
  domains that genuinely need real addresses (certificate pinning, non-HTTP clients, IP checks); a
  blocked or poisoned resolver gets worse, not better, once fake-ip stops hiding it.
