# Build with AI (/docs/get-started/ai-tools)

These docs are built to be read by AI tools as easily as by people. Point your
assistant at any of the following:

## Machine-readable endpoints [#machine-readable-endpoints]

| What                      | URL                                                                                                                       | Use it for                                                |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Docs index for LLMs       | [/llms.txt](/llms.txt)                                                                                                    | Give an agent a map of every page with descriptions       |
| Full docs as one file     | [/llms-full.txt](/llms-full.txt)                                                                                          | Paste the entire documentation into a large-context model |
| Any page as Markdown      | append `.md` to any docs URL, e.g. [/docs/accept-payments/payment-sessions.md](/docs/accept-payments/payment-sessions.md) | Feed a single topic to a model without HTML noise         |
| OpenAPI 3.1 specification | [/openapi.yaml](/openapi.yaml)                                                                                            | Code generation, API clients, agent tool definitions      |

## On every page [#on-every-page]

Each docs page has a **Copy Markdown** button and an **Open** menu that sends
the page straight to ChatGPT or Claude — useful when you want to ask questions
about one integration.

## Suggested prompts [#suggested-prompts]

Working in Cursor, Claude Code, or another coding agent? Try:

```text
Read https://developers.kashier.io/llms.txt, then fetch the pages relevant to
accepting a card payment with Kashier and implement it in my checkout flow.
Use the test environment (test-api.kashier.io) and my test keys from .env.
```

```text
Generate a typed API client for Kashier from
https://developers.kashier.io/openapi.yaml. Payments only.
```

## Notes for agents [#notes-for-agents]

- Authentication is two headers: `Authorization` (the merchant secret key, raw
  value — not a Bearer token) and `api-key`. See
  [API keys](/docs/get-started/api-keys).
- Test and live are separate environments; test base URLs are prefixed
  `test-`. Never use live keys while developing.
- Amounts are strings in EGP for payment sessions (for example `"100.00"`).
