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

The build validates the list in `normalizeConfiguration`, and
[`render-flclash-profile.mjs`](../scripts/render-flclash-profile.mjs) emits it directly into the
generated profile's `dns` section:

```yaml
dns:
  enable: true
  enhanced-mode: fake-ip
  fake-ip-range: 198.18.0.1/16
  nameserver:
    - https://223.5.5.5/dns-query
    - https://1.12.12.12/dns-query
  fake-ip-filter:
    - "+.github.com"
    # ...
```

The generated profile is the single source for this list, so clients consuming it inherit the entries
without any per-device override. Other DNS keys are fixed by the generator, not per device.

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
