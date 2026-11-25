# Linkvite docs

The source of [docs.linkvite.io](https://docs.linkvite.io), built with [Mintlify](https://mintlify.com).

```bash
npm i -g mint
mint dev              # preview at http://localhost:3000
mint validate         # build checks
mint broken-links
```

CI (`.github/workflows/ci.yml`) runs `mint validate` and `mint broken-links` on every pull request; Mintlify deploys `main` itself. It also checks that `api-reference/openapi.json` matches the spec in [linkvite/js](https://github.com/linkvite/js) (advisory: the SDK lags until its releases merge).

## Layout

| Path | |
| --- | --- |
| `docs.json` | Site config and navigation |
| `index.mdx`, `guides/`, `help/` | Guides for people using Linkvite |
| `developers/`, `sdks/` | Developer docs |
| `api-reference/openapi.json` | The API reference, generated (don't edit) |
| `legal/` | Privacy policy, terms, copyright |

## Updating the API reference

The reference is generated from cultus's OpenAPI document (`make openapi` in cultus), filtered to public endpoints, with JavaScript, Go and curl samples added:

```bash
node scripts/sync-openapi.mjs ../cultus/api/openapi.json
```
