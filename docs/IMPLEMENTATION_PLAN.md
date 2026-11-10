# NeedMesh — Implementation Plan

**NeedMesh** is the headline product: PayPal-powered agentic commerce missions. **Promesa PromiseTwin** is the
important secondary feature and fallback safety net. They share one domain model (the repository and internal
package names still say `promesa`):

- **NeedMesh missions** (primary) — outcome-driven, agent-assisted commerce for organizations and sponsors. See
  [NeedMesh 2.0 addendum](#needmesh-20-addendum) below.
- **PromiseTwin** (safety net) — a per-purchase digital twin that compares human intent, seller-accepted commitments, PayPal payment state and fulfillment evidence, and coordinates approval-gated recovery.

Binding specifications: [`docs/specs/backend-spec.md`](specs/backend-spec.md) and [`docs/specs/frontend-spec.md`](specs/frontend-spec.md) (copied verbatim from the root `backend_readme.md` and `frontend_README (2).md`).

**Conflict rule:** backend spec wins for security and financial integrity; frontend spec wins for user experience.

---

## 0. Decisions and deviations (documented, deliberate)

| Topic                     | Spec                     | Decision                                                                                                                        | Reason                                                                                                                                                                                                                               |
| ------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Package manager           | pnpm workspace           | **npm workspaces**                                                                                                              | pnpm is not installed on the build machine and its hard-link store is unreliable inside OneDrive-synced folders. Scripts mirror the pnpm quality gate (`npm run lint`, `typecheck`, `test`, `build`). Switching later is mechanical. |
| Local Postgres            | Docker Compose           | `compose.yaml` **and** `scripts/dev-db.mjs` (real PostgreSQL 17 binaries via `embedded-postgres`)                               | No Docker on the build machine. Both paths run genuine PostgreSQL, not an emulator.                                                                                                                                                  |
| Redis / BullMQ            | required                 | Redis in `compose.yaml`; readiness reports it; BullMQ workers land in **Phase 2**                                               | Phase 1 has no background side effects. The transactional outbox in Postgres is already the durable record, so nothing is lost before workers exist.                                                                                 |
| Versions                  | "current"                | TypeScript 5.9, NestJS 11 + Fastify 5, Prisma 6, Next.js 15.5, React 19.1, Tailwind 4.1, Anime.js 4, Zod 3.25                   | Newer majors (TS 7, Nest 12, Prisma 7/8, Next 16) exist but were not verifiable against official docs during this build; pinning proven majors avoids invented APIs.                                                                 |
| API types on the frontend | OpenAPI-generated client | Shared `@promesa/contracts` Zod schemas (single source) + OpenAPI generated from the same schemas                               | Frontend spec explicitly allows `packages/contracts`. `openapi-typescript` generation is added in Phase 2 as a contract test.                                                                                                        |
| Identity                  | OIDC                     | **Demo identity provider** (signed HTTP-only cookie, explicit persona selection), refused at startup when `NODE_ENV=production` | Spec Phase 1 allows "a clearly non-production demo identity provider". OIDC lands in Phase 6.                                                                                                                                        |
| Brand                     | NeedMesh                 | **NeedMesh** is the product and headline; **Promesa PromiseTwin** is the named safety-net feature                               | Per project owner (hackathon positioning).                                                                                                                                                                                           |

---

## 1. System architecture

Modular monolith API + (Phase 2) separate durable workers.

```text
frontend (Next.js App Router)  ──REST + SSE (cookie session, CSRF header)──▶  backend (NestJS/Fastify)
                                                                               ├── identity      demo IdP, sessions, RBAC, tenant scope
                                                                               ├── intent        compiler (LLMProvider), deterministic validation
                                                                               ├── commerce      catalog fixtures, offer matcher/solver
                                                                               ├── missions      NeedMesh missions
                                                                               ├── purchases     purchases + PromiseTwin bootstrap
                                                                               ├── promisetwin   evaluator, contrast, threads, snapshots
                                                                               ├── policy        deterministic financial policy engine
                                                                               ├── paypal        gateway (Orders v2 / Payments v2), MCP adapter, health
                                                                               ├── events        transactional outbox, SSE stream
                                                                               ├── audit         append-only, hash-chained audit log
                                                                               └── demo          fixtures, simulated clock, scenario controls
packages/contracts  Zod schemas, enums, money + datetime utilities shared by both apps
PostgreSQL (Prisma)  source of truth   ·   Redis (Phase 2) queues   ·   S3-compatible store (Phase 3) evidence files
```

Rules that shape the code:

1. Business state + outbox row are written in one transaction; UI events are derived from the outbox.
2. All money is integer minor units (`BigInt` in Postgres, decimal strings in JSON).
3. Every displayed claim carries provenance (`source`, `sourceId`, `observedAt`, `ingestedAt`, `verification`).
4. Simulated data is tagged `SIMULATED` from database to browser. No PayPal IDs are ever fabricated.
5. LLM code lives only behind `LLMProvider`; financial decisions run through the deterministic policy engine.

## 2. Service responsibilities

| Module        | Responsibility                                                                                                                                                 | Phase                                                               |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `identity`    | Demo personas, signed session cookie, `/v1/me`, explicit role switching, `TenantGuard` + `RolesGuard`                                                          | 1 (OIDC: 6)                                                         |
| `intent`      | `IntentCompilerService` → `LLMProvider` (fixture now, OpenAI/Anthropic/Gemini in 2); `validateIntent` deterministic checks; source spans                       | 1                                                                   |
| `commerce`    | Catalog fixtures (labelled `DEMO_FIXTURE`), `matchOffers` hard-constraint solver, Pareto plan alternatives                                                     | 1 (Channel3: 2)                                                     |
| `missions`    | Create/list/get NeedMesh missions with confirmed immutable intent; offers                                                                                      | 1                                                                   |
| `purchases`   | Create purchase from confirmed intent; auto-create PromiseTwin; offers                                                                                         | 1                                                                   |
| `promisetwin` | `evaluateTwin` pure evaluator; `ContrastService` (Faultline), `ThreadService` (Promise Threads), snapshots (Timefold), health breakdown                        | 1 (core), 3 (monitoring jobs)                                       |
| `policy`      | `evaluateFinancialPolicy` — ALLOW / DENY / REVIEW with reason codes                                                                                            | 1 (engine + tests), 2 (wired to checkout)                           |
| `paypal`      | `PayPalGateway` (OAuth client-credentials, Orders v2, Payments v2 refunds, `PayPal-Request-Id`), `PayPalMcpAdapter` (official MCP SDK + `@paypal/mcp`), health | 1 (interfaces + real OAuth health check), 2 (checkout), 4 (refunds) |
| `events`      | Outbox writer, SSE `/v1/stream` with `Last-Event-ID` replay and tenant filtering                                                                               | 1                                                                   |
| `audit`       | Append-only audit records with rolling SHA-256 chain                                                                                                           | 1                                                                   |
| `demo`        | Bakery + shelter fixtures, simulated scenario clock, labelled simulated fulfillment events, reset                                                              | 1                                                                   |

## 3. Database schema

Implemented in `backend/prisma/schema.prisma`. Phase 1 creates the full normalized core so later phases add behaviour, not churn:

`users`, `tenants`, `memberships`, `merchant_connections`, `missions`, `intents`, `catalog_products`, `offers`, `seller_commitments`, `purchases`, `checkout_attempts`, `paypal_captures`, `paypal_refunds`, `promise_twins`, `twin_evaluations`, `constraint_evaluations`, `twin_snapshots`, `evidence`, `fulfillments`, `incidents`, `recovery_proposals`, `recovery_approvals`, `financial_commands`, `paypal_webhook_inbox`, `outbox_events`, `audit_log`, `agent_runs`, `mission_receipts`, `demo_clocks`.

Integrity: UUID PKs, `BigInt` minor units + `CHAR(3)` currency, `version` columns for optimistic locking, unique constraints on every PayPal resource ID / request ID / webhook event ID, `(tenant_id, id)` indexes, append-only snapshots/evaluations/audit, immutable `confirmed_snapshot_json` and `accepted_terms_json` + `terms_hash`.

Deferred to the phase that needs them: `purchase_plans`, `twin_event_links`, `recovery_option_sets`, `receipt_manifests`, `impact_rollups` (read models are computed from normalized tables until load tests justify materialization).

## 4. API contracts

Prefix `/v1`, camelCase JSON, `{ error: { code, message, details?, correlationId } }` errors, 409 state conflicts, 422 rule violations. OpenAPI at `/openapi.json`, Swagger UI at `/docs` (non-production).

| Endpoint                                                                                                                                                               | Phase | Status                                     |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ------------------------------------------ |
| `GET /health/live`, `GET /health/ready`                                                                                                                                | 1     | ✅                                         |
| `GET /v1/auth/personas`, `POST /v1/auth/session`, `DELETE /v1/auth/session`, `POST /v1/auth/role`, `GET /v1/me`                                                        | 1     | ✅                                         |
| `POST /v1/intent/compile`                                                                                                                                              | 1     | ✅ fixture provider                        |
| `POST /v1/missions`, `GET /v1/missions`, `GET /v1/missions/:id`, `GET /v1/missions/:id/offers`                                                                         | 1     | ✅                                         |
| `POST /v1/purchases`, `GET /v1/purchases`, `GET /v1/purchases/:id`, `GET /v1/purchases/:id/offers`                                                                     | 1     | ✅                                         |
| `GET /v1/twins`, `GET /v1/twins/:id`, `/evidence`, `/threads`, `/contrast`, `/health-breakdown`, `/snapshots`, `/snapshots/:snapshotId`, `POST /v1/twins/:id/evaluate` | 1     | ✅                                         |
| `GET /v1/stream` (SSE)                                                                                                                                                 | 1     | ✅ outbox-backed                           |
| `GET /v1/integrations/paypal/health`                                                                                                                                   | 1     | ✅ real OAuth check when credentials exist |
| `GET /v1/demo/scenarios`, `POST /v1/demo/scenarios/:key/clock`, `POST /v1/demo/scenarios/:key/reset`                                                                   | 1     | ✅ demo mode only                          |
| `POST /v1/missions/:id/plan`, `/confirm-plan`, `POST /v1/checkout/orders`, `/capture`, `/status`, `POST /v1/paypal/webhooks`                                           | 2     | planned                                    |
| `POST /v1/twins/:id/incidents/:incidentId/propose-recovery`, `/v1/recoveries/*`, `/v1/fulfillments/*`                                                                  | 3–4   | planned                                    |
| `/v1/atlas/summary`, `/v1/missions/:id/receipt(/manifest)`, `/v1/operations/summary`, `/v1/agent-runs/:id/explain`                                                     | 5     | planned                                    |

## 5. Agent orchestration design (Phase 2–3)

LangGraph.js `StateGraph` with typed state, Postgres checkpointer, bounded recursion and per-node tool budgets:

`intent.compile → intent.validate → [clarify?] → merchant.discover → plan.optimize → human.confirmPlan (interrupt) → commitment.verify → paypal.inspect (MCP read tool) → promise.observe → promise.evaluate → [breach/risk?] → recovery.propose → human.approve (interrupt) → recovery.execute (deterministic command handler, not an agent tool) → reconcile`.

Agents: Intent Compiler, Mission Planning, Merchant Discovery, PayPal Commerce, Promise Monitoring, Failure Diagnosis, Financial Recovery, Reconciliation. Each node emits structured output validated by Zod; the deterministic validator/solver/policy has the final word (disagreement ⇒ `REQUIRES_REVIEW`). Tool calls pass through `ToolExecutionGate` (tenant, merchant, allowlist, purpose, max amount, replay protection). Merchant text and tool descriptions are untrusted data.

Phase 1 already ships the deterministic halves (validator, solver, evaluator, policy) plus the `LLMProvider` interface and a deterministic fixture provider, so graph nodes in Phase 2 wrap tested code.

## 6. PayPal integration sequence (Phase 2 onwards)

1. Server resolves locked quote → policy `CREATE_ORDER` → `POST /v2/checkout/orders` (`intent=CAPTURE`, stable `PayPal-Request-Id`) → persist `checkout_attempts`.
2. Browser renders JS SDK v6 (`window.paypal.createInstance({ clientId, components: ['paypal-payments'] })`), `createOrder` resolves `{ orderId }`.
3. After buyer approval, server re-checks policy `CAPTURE` → `POST /v2/checkout/orders/{id}/capture` idempotently → persist `paypal_captures` + evidence (`PAYPAL_API_VERIFIED`) + outbox.
4. Webhooks: raw body → `POST /v1/notifications/verify-webhook-signature` → inbox (unique event ID) → worker → reconcile.
5. Runtime MCP: `PayPalMcpAdapter` connects to official `@paypal/mcp` (stdio) via `@modelcontextprotocol/sdk`, calls `listTools`, enforces `PAYPAL_MCP_ALLOWED_TOOLS`, invokes a discovered read tool inside `paypal.inspect`, records sanitized trace in `agent_runs`.
6. Refunds (Phase 4): merchant approval bound to proposal snapshot hash → `financial_commands` → `POST /v2/payments/captures/{id}/refund` with stable request ID → reconcile; timeout ⇒ `UNKNOWN_RECONCILING`.

`ENABLE_LIVE_PAYPAL_WRITES=false` by default; without credentials every PayPal surface shows `NOT_CONFIGURED`, never a fake success.

## 7. Frontend implementation milestones

| Milestone | Content                                                                                                            | Phase |
| --------- | ------------------------------------------------------------------------------------------------------------------ | ----- |
| F1        | Outcome Atelier tokens (light + dark), fonts, AppShell, demo banner, sign-in persona picker                        | 1 ✅  |
| F2        | Landing (hero reveal, fold specimen, 3-step story, honest PayPal section), How it works                            | 1 ✅  |
| F3        | Intent composer with source-span highlighting, Promise Fold, constraint editor, confirm → mission/purchase         | 1 ✅  |
| F4        | Mission + purchase detail with offer comparison and exclusion reasons                                              | 1 ✅  |
| F5        | PromiseTwin: three panels, health badge, Promise Threads, Faultline, four-track rail, demo clock, Timefold history | 1 ✅  |
| F6        | PayPal SDK v6 checkout, payment state banner, merchant acceptance workspace                                        | 2     |
| F7        | Recovery Workbench, approvals, incident centre                                                                     | 3–4   |
| F8        | Proof Passport, Mission Atlas, AG Grid operations, Playwright + visual regression                                  | 5     |

## 8. Testing strategy

- **Unit (Vitest):** intent compiler (paper-not-plastic, 100 units, USD 100 cap, Friday 17:00 America/New_York), validation, offer solver (material beats price, budget, stock, deadline), evaluator (late ETA before deadline ⇒ `AT_RISK`; after deadline ⇒ `BREACHED`; no evidence ⇒ `UNDETERMINED`; buyer-only deadline is never a seller breach; forbidden material ⇒ `AI_SELECTION_ERROR`; capture never implies delivery), policy engine (wrong merchant, missing approval, expired quote, over budget, buyer-only refund, over-refund), money/datetime utils.
- **Integration:** API smoke script against a running backend + real Postgres (`npm run smoke`): auth, compile, create purchase, twin read models, demo clock breach, SSE replay.
- **Frontend:** Vitest for intent-draft helpers (span segmentation, zone-aware deadline input, budget parsing, schema validation). A Playwright E2E script (`npm run e2e`) drives the locally installed Edge through the main Phase 1 flows; axe and visual regression follow in Phase 5.
- **Later:** PayPal Sandbox contract tests (credential-gated, labelled optional), webhook signature tests, concurrency/idempotency property tests, k6 budgets.

## 9. Deployment strategy

Render blueprint (Phase 6): `promesa-web` (Next.js), `promesa-api` (NestJS), `promesa-worker` (BullMQ + LangGraph), managed Postgres + Redis. Startup refuses production when `DEMO_MODE=true`, demo auth enabled, weak `AUTH_SESSION_SECRET`, or wildcard origins. Separate sandbox and production credentials by environment. Dockerfiles per app.

## 10. Phases and completion criteria

### Phase 1 — Functional foundation

Done when: workspace installs; lint, typecheck, unit tests and builds pass for contracts/backend/frontend; Prisma migration applies on real Postgres; seed creates the labelled bakery and shelter scenarios; landing, sign-in, dashboard, mission creation, purchase creation, purchase/mission detail, PromiseTwin and Timefold pages render against the live API; demo clock advance produces an evidence-backed `BREACHED` evaluation and a new snapshot; SSE delivers the resulting outbox event.

### Phase 2 — AI + PayPal commerce

LLM providers, LangGraph graph with checkpoints, BullMQ workers, seller acceptance workspace, PayPal Sandbox order/capture, SDK v6 button, verified webhooks, runtime MCP `listTools` + one real read invocation, automatic twin linkage to verified capture. Done when a Sandbox capture ID is stored from a real PayPal response (with credentials) and offline tests cover every path without credentials.

### Phase 3 — PromiseTwin intelligence

Deadline monitoring jobs, shipment events, merchant evidence submission, diagnosis agent with cause hypotheses, incidents, explainable reasoning. Done when bakery breach is detected by a scheduled job, not a button.

### Phase 4 — Financial recovery

Recovery options solver, proposal snapshot hashing, buyer/merchant approvals, `financial_commands` with idempotent refund execution, replacement checkout, reconciliation. Done when duplicate approvals/executions provably produce one PayPal call.

### Phase 5 — Premium experience

Recovery Workbench, Proof Passport, Mission Atlas, AG Grid operations, receipts, Playwright + axe + visual regression, performance budgets measured.

### Phase 6 — Production readiness

OIDC, RLS, secret manager, rate limits, OpenTelemetry, Sentry, CI/CD, Render deployment, security review, runbooks.

---

## 11. Progress log

_Updated after each verification run. Only verified facts are recorded here._

### Phase 1 status

Complete. See "Phase 1 verification" below.

## Phase 1 verification

Run on 2026-11-09 on Windows 11, Node 24.19, npm 11, embedded PostgreSQL 17 (UTF-8 cluster, `--locale=C`). Docker was not available, so `compose.yaml` was not exercised.

| Gate                                           | Command                | Result                                                                                            |
| ---------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------- |
| Install                                        | `npm install`          | OK (install scripts approved for Prisma, esbuild, embedded-postgres; `@scarf/scarf` left blocked) |
| Lint                                           | `npm run lint`         | 0 errors, 0 warnings                                                                              |
| Format                                         | `npm run format:check` | Clean                                                                                             |
| Typecheck                                      | `npm run typecheck`    | Clean (contracts, backend, frontend)                                                              |
| Unit tests                                     | `npm test`             | 51 passed: contracts 6, backend 38, frontend 7                                                    |
| Build                                          | `npm run build`        | OK; first-load JS per route 102–145 kB (budget 180 kB)                                            |
| Migration                                      | `npm run db:deploy`    | `20261109171748_init` applied to a fresh cluster                                                  |
| Seed                                           | `npm run demo:seed`    | Bakery twin `AT_RISK` with 3 snapshots; shelter mission seeded                                    |
| API smoke (running API + Postgres)             | `npm run smoke`        | 25/25 checks                                                                                      |
| Browser E2E (running web + API, headless Edge) | `npm run e2e`          | 12/12 steps, no console or page errors                                                            |

What the smoke test proves against the live stack: health/readiness, OpenAPI, honest PayPal health (`NOT_CONFIGURED` without credentials), 401 without a session, 403 for unsafe requests without the CSRF header, demo sign-in, scenario reset, every twin read model, intent compilation, purchase + twin creation, offer solving, SSE resume from `Last-Event-ID` delivering the twin outbox event, evidence-backed `BREACHED` after the clock passes the seller-committed deadline, forward-only clock, and role enforcement (a merchant cannot create a purchase).

What the E2E proves in a real browser: landing and how-it-works render with live PayPal status; persona sign-in honours `next`; dashboard → PromiseTwin; demo reset and clock advance flip the health stamp and Faultline (`AT_RISK` → `BREACHED`); Timefold lists ≥ 3 immutable snapshots; dark mode; intent composer highlights source spans, unfolds the Promise Fold editor, and creates a purchase whose offer board shows plans and exclusions; the new twin starts `UNDETERMINED`; mobile twin layout falls back to the threads list; an ORG admin creates a mission; unauthenticated workspace access redirects to sign-in. Screenshots: `docs/screenshots/phase1/`.

Not verified in Phase 1 (by design): any PayPal call (no Sandbox credentials), Redis/BullMQ, LLM providers other than the deterministic fixture, `compose.yaml`, accessibility audits (axe), reduced-motion visual checks beyond code review.

### Issues found and fixed during verification

- The embedded cluster first initialised as WIN1252 and rejected `≤` in seed text; `scripts/dev-db.mjs` now initialises UTF-8 with `--locale=C` in `.data/postgres-utf8`. The old `.data/postgres` directory is unused and can be deleted manually.
- Snapshot pagination requested `limit=100` against a maximum of 50 (HTTP 400); fixed in the client.
- One action emits several outbox events, which caused bursts of duplicate refetches; the SSE hook now coalesces invalidations (300 ms).
- The API bound `0.0.0.0` in development; it now binds loopback unless `HOST` is set or `NODE_ENV=production`.
- `DATABASE_URL` uses `127.0.0.1` with an explicit pool size after a transient connection failure under heavy local load.
- The `prisma generate` step in `typecheck` failed with `EPERM` while the API held the engine DLL (Windows); generation now runs at `postinstall` and `build` only.

### Known constraints carried into later phases

- **Cross-site cookies in deployment.** Locally, web (`:3000`) and API (`:4000`) are same-site, so the `SameSite=Lax` session cookie works. `*.onrender.com` is on the public-suffix list, so separate Render subdomains are cross-site: Phase 6 must serve both under one registrable domain or proxy `/v1` through the web origin.
- **CSP** still allows `'unsafe-inline'` scripts (theme bootstrap, Next runtime) until nonce-based CSP lands in Phase 6; PayPal SDK origins are added in Phase 2.
- **TLS-intercepting networks** need `NODE_OPTIONS=--use-system-ca` for Prisma engine downloads and Google Fonts at build time.
- **OneDrive-synced checkout.** The Postgres data directory lives inside the synced folder; under load this can add I/O stalls. Moving `.data/` outside OneDrive is recommended for long sessions.

---

## NeedMesh 2.0 addendum

Agents plan and explain; a deterministic policy engine (`mission-policy@1.0.0`) allows or denies every money
action; PayPal (or the labelled simulated rail) executes. The model never moves money.

| Agent            | Implementation                                                                                                                                         |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Mission Planner  | Intent compiler + `planMission` (cheapest eligible units first, budget and stock capped)                                                               |
| Commerce Planner | Reuses `solveOffers` hard-constraint checks; excludes with reasons                                                                                     |
| PayPal Commerce  | `PayPalRail`: Sandbox REST (Orders v2 AUTHORIZE, authorize, capture, void, refund, tracking) or Simulated                                              |
| Recovery         | Reads PayPal state (REST + optional MCP `get_order`), `decideRemedy`, re-plans with the failed product blocked; replacement needs new sponsor approval |
| Fulfillment      | Shipment tracking + recipient acknowledgement                                                                                                          |
| Reconciliation   | `POST /missions/:id/reconcile` and verified webhooks                                                                                                   |

Key properties: deterministic `PayPal-Request-Id` per action (`nm-<order>-create|authorize|capture|void|refund|track`),
external calls outside DB transactions, optimistic claiming (`updateMany` on state+version), hash-chained audit,
transactional outbox + SSE, provenance tags on every timeline event (`PAYPAL_API`, `PAYPAL_WEBHOOK`, `SIMULATED`,
`AI_DERIVED`, `POLICY_DERIVED`, `MERCHANT`, `RECIPIENT`, `BUYER`).

Endpoints (`/v1/missions/:id/...`): `GET lifecycle`, `POST agents/plan`, `POST orders/:orderId/approve|authorize|merchant|acknowledge`,
`POST reconcile`; public `POST /v1/paypal/webhooks`.

### Verification log

- Unit tests (Vitest): planner, policy engine, mission state/remedy, narration guard, Sandbox and Simulated rails with mocked fetch.
- `npm run smoke:needmesh`: plan → approve → authorize → stockout → void + re-plan → replacement → capture → ship → acknowledge → receipt.
- `node scripts/e2e-needmesh.mjs`: the same flow through the UI as Jordan and Priya, with screenshots.
- **Not verified:** real PayPal Sandbox calls, the PayPal MCP server and LLM narration (no credentials were available).

### Honest limits

No escrow, no official PayPal partnership, Store Sync / Agent Ready are future only, merchants and delivery are simulated,
MCP is read-only, and refunds of captured payments require merchant approval.
