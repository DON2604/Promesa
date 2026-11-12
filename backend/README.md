# NeedMesh API (`@promesa/backend`)

NestJS 11 on Fastify, Prisma 6 on PostgreSQL, Zod contracts shared with the web app
(`@promesa/contracts`). It powers **NeedMesh**: AI procurement missions funded by sponsors through
PayPal, with **PromiseTwin** protection built into every purchase.

> Agents plan. Policy decides. PayPal executes. Models never move money.

Feature status against the product brief: [`docs/NEEDMESH_FEATURE_AUDIT.md`](../docs/NEEDMESH_FEATURE_AUDIT.md).
Internal package names (`@promesa/*`) and the `X-Promesa-Csrf` header are kept for compatibility.

## Domain map

| Bounded context                  | Code                                                                           |
| -------------------------------- | ------------------------------------------------------------------------------ |
| Identity, tenants, roles         | `src/modules/identity` (demo personas, HTTP-only session, CSRF)                |
| Missions and needs               | `src/modules/missions`, `needmesh/needmesh.service.ts`                         |
| Intent compilation               | `src/modules/intent` (deterministic parser + optional LLM)                     |
| Merchant catalogs and offers     | `src/modules/commerce` (catalog, offer solver)                                 |
| Reverse marketplace, negotiation | `needmesh/marketplace.service.ts`, `negotiation.ts`, `matching.ts`             |
| Procurement planning             | `needmesh/mission-planner.ts` (deterministic split within budget)              |
| Policy                           | `needmesh/mission-policy.ts` (`mission-policy@1.0.0`), `policy/`               |
| PayPal commerce gateway          | `needmesh/paypal-rail.ts`, `paypal/paypal-gateway.ts`, `paypal-mcp.adapter.ts` |
| Orchestration and agent traces   | `needmesh.service.ts` → `AgentRun` rows (`needmesh-graph@1.0.0`)               |
| Fulfillment, receipts, analytics | `needmesh.service.ts`, `marketplace.service.ts`                                |
| PromiseTwin monitoring           | `src/modules/promisetwin` (evaluator, twin engine), `needmesh/protection.ts`   |
| Audit, evidence, events          | `src/modules/audit` (hash chain), `src/modules/events` (outbox → SSE)          |

## Agent graph

There is no LangGraph runtime. Each planning or recovery run is a deterministic node sequence
recorded in the `AgentRun` table with a summarized trace. Planning nodes: mission understanding,
product discovery, merchant matching, offer evaluation, procurement optimization, policy validation,
funding coordination. Recovery has six nodes, ending in a PromiseTwin breach record. An LLM (if
configured) may only narrate; every number in the narration is checked against the planner.

## Money rules enforced in code

- Money is BigInt minor units, serialized as strings.
- One PayPal order per merchant, `intent=AUTHORIZE`. Capture needs merchant stock confirmation.
- Every authorize, capture, void and refund passes `evaluateMissionPolicy`. Sponsors on **public**
  missions may fund cross-tenant; nothing else crosses tenants.
- No pooled wallet, escrow or split transactions. Each order records its own `sponsorTenantId`.
- Refunds of captured payments require merchant approval. Replacement orders need a fresh approval.
- A capture never marks delivery. Only recipient acknowledgment does.
- Optimistic concurrency (`version`) on missions, orders and proposals.

## HTTP API (prefix `/v1`)

| Area        | Routes                                                                                                                                                                     |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth        | `GET auth/personas`, `POST/DELETE auth/session`, `POST auth/role`, `GET me`                                                                                                |
| Intent      | `POST intent/compile`                                                                                                                                                      |
| Missions    | `POST/GET missions`, `GET missions/:id`, `GET missions/:id/offers`                                                                                                         |
| Lifecycle   | `GET missions/:id/lifecycle`, `POST missions/:id/agents/plan`, `POST missions/:id/orders/:orderId/{approve,authorize,merchant,acknowledge}`, `POST missions/:id/reconcile` |
| Marketplace | `GET marketplace/missions` (public), `POST missions/:id/{publish,repeat,proposals}`, `POST proposals/:proposalId/decision`, `GET merchant/workspace`                       |
| Org         | `GET org/profile`, `PUT org/preferences`, `POST org/verification`                                                                                                          |
| Insight     | `GET analytics`, `GET forecast`, `GET notifications`, `GET operations/summary`                                                                                             |
| PromiseTwin | `POST/GET purchases`, `GET purchases/:id(/offers)`, `GET twins`, `GET twins/:id/{evidence,threads,contrast,health-breakdown,snapshots}`, `POST twins/:id/evaluate`         |
| PayPal      | `POST paypal/webhooks`, `GET integrations/paypal/health`                                                                                                                   |
| Platform    | `GET stream` (SSE), `GET /health/{live,ready}`, `GET/POST demo/scenarios(/:key/{clock,reset})`                                                                             |

OpenAPI at `/docs` and `/openapi.json`.

## Configuration

Copy `.env.example` to `.env`. Secrets are optional. Without them the API runs fully offline on
labelled simulations.

| Variable                                   | Effect when unset                                                |
| ------------------------------------------ | ---------------------------------------------------------------- |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | Simulated PayPal rail (`SIM-…` ids), labelled everywhere         |
| `ENABLE_LIVE_PAYPAL_WRITES`                | Sandbox writes disabled even with credentials                    |
| `PAYPAL_WEBHOOK_ID`                        | Webhook endpoint returns 503 `WEBHOOKS_NOT_CONFIGURED`           |
| `PAYPAL_MCP_ENABLED`                       | Recovery reads PayPal through REST instead of MCP                |
| `LLM_PROVIDER=gemini` + `GEMINI_API_KEY`   | Deterministic `fixture` provider                                 |
| `CHANNEL3_API_KEY`                         | Mission discovery searches Channel3. Unset: Channel3 is off      |
| `DEMO_MODE`, `DEMO_AUTH_ENABLED`           | Demo merchant console, demo verification and persona sign-in off |

Gemini, when configured, defaults to `gemini-3.5-flash-lite` and a local free-tier budget of
4 requests per minute and 15 per day (under the tightest published free-tier figures). Past that
budget, or if Gemini answers 429, narration uses the deterministic text and the mission request
still succeeds. There are no retries. Set `GEMINI_RPM`, `GEMINI_RPD` and `GEMINI_TPM` to the
numbers in AI Studio if your project shows a higher quota. `gemini-2.0-flash` is not called unless
you set those, because its free quota is reported as zero.

## Scripts

```powershell
npm run dev -w @promesa/backend      # prisma generate, tsc watch, node --watch
npm run db:deploy                    # migrations (from repo root)
npm run demo:seed                    # shelter, history missions, bakery (fictional, labelled)
npm test -w @promesa/backend         # Vitest: policy, planner, state, negotiation, protection, forecast, PayPal rail
npm run smoke:needmesh               # full lifecycle incl. stockout recovery (API running)
npm run smoke:marketplace            # publish → offer → counter → accept → two sponsors → atlas/analytics
```
