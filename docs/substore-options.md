# Sub-Store runtime options

Both generated override scripts accept an optional `$options.links` string containing one share URI or newline-separated share URIs. For example, configure this JSON parameter:

```json
{"links":"ss://YWVzLTEyOC1nY206ZXhhbXBsZS1wYXNzd29yZA@example.invalid:8388#JP%20ISP\nvless://00000000-0000-4000-8000-000000000001@example.invalid:443?security=tls#Singapore"}
```

Blank or omitted `links` leaves subscription proxies unchanged. Link protocols depend on the deployed Sub-Store `ProxyUtils.parse` support. Parsed proxy names determine existing group membership; the automatic group includes matching Hong Kong names, and the manual `🤖 国际 AI` group includes only Singapore names (🇸🇬, 新加坡, Singapore, or bounded SG/SGP identifiers), excluding names that explicitly mention Hong Kong or Macao. Other regions are not included in that AI group. The Android override still requires its existing non-empty `$options["tailscale-secret"]`.

Share links may contain credentials. Although validation errors do not echo links, Sub-Store's parser may log its inputs; use the option only in an appropriately protected runtime.
