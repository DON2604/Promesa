# NeedMesh

> Tell us what's needed. Our AI finds a way.

**NeedMesh** is an AI procurement network and reverse marketplace on PayPal. An organization
describes a need ("30 fragrance-free hygiene kits for a shelter by Friday, under $175") in words or
by voice. AI turns it into a structured mission and discovers and compares merchant offers. It
negotiates with merchants connected to the platform and optimizes a multi-merchant plan. Sponsors
from any organization fund specific merchant orders through PayPal. Every unit is tracked until the
recipient confirms it arrived. When a supplier fails, the **Recovery Agent reads the real PayPal
state, releases the money and re-plans** inside the budget.

**PromiseTwin** is built in. Every purchase gets a living twin that keeps the intent, the merchant's
commitment, the PayPal state and the delivery evidence on separate tracks, detects broken promises
and proposes policy-checked remedies. It also works as standalone protection for a single business
purchase. Built for the PayPal AI Hackathon.

- **Feature audit (what is working, simulated or future):** [`docs/NEEDMESH_FEATURE_AUDIT.md`](docs/NEEDMESH_FEATURE_AUDIT.md)
- Package guides: [`backend/README.md`](backend/README.md), [`frontend/README.md`](frontend/README.md)
- Roadmap, architecture and verification log: [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md)
- Source specifications: [`docs/specs/`](docs/specs)
- Screenshots: [`docs/screenshots/needmesh/`](docs/screenshots/needmesh), [`docs/screenshots/phase1/`](docs/screenshots/phase1)

## What is real and what is simulated

| Piece                                  | Status                                                                                                                                                                                                                                   |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mission planning, policy engine, state | Real, deterministic, unit-tested                                                                                                                                                                                                         |
| PayPal Orders v2 / Payments v2         | Real **PayPal Sandbox** REST calls when `PAYPAL_CLIENT_ID/SECRET` are set and `ENABLE_LIVE_PAYPAL_WRITES=true`. Written to the PayPal docs and tested against a mocked fetch. Not yet exercised against a live Sandbox account.          |
| Without Sandbox credentials            | A **Simulated rail** (`SIM-…` ids) runs the same lifecycle. Every order, the header and the receipt are labelled Simulated. It never looks like a PayPal record.                                                                         |
| PayPal MCP (Agent toolkit)             | Official `@paypal/mcp` over stdio, used **read-only** (`get_order`) before the Recovery Agent acts. It has no authorization-void tool, so voids use REST.                                                                                |
| Webhooks                               | `POST /v1/paypal/webhooks` verifies the signature through PayPal and de-duplicates events. Needs `PAYPAL_WEBHOOK_ID`.                                                                                                                    |
| LLM narration                          | Optional Gemini (`gemini-3.5-flash-lite`). Every number in the narration is checked against the planner's figures; otherwise the deterministic text is used. Defaults to offline fixtures.                                               |
| Marketplace, offers, sponsors          | Real code paths (publish, offers, counteroffers, cross-tenant sponsor funding). Merchants and sponsors are fictional demo personas.                                                                                                      |
| Channel3 discovery                     | Real catalog search when `CHANNEL3_API_KEY` is set. Results are merchant-reported prices and affiliate links, labelled as such, and are not NeedMesh orders or a stock guarantee. Without a key the UI shows Channel3 as not configured. |
| Org verification                       | Demo review only (`DEMO_REVIEW`), no real KYC.                                                                                                                                                                                           |
| Merchants, stock, shipping, delivery   | Fictional and simulated (demo merchant console). Labelled.                                                                                                                                                                               |

Not claimed: escrow, an official PayPal partnership, or PayPal Store Sync / Agent Ready (a future path
only). NeedMesh never holds funds, and refunds of captured payments need the merchant's approval.

## The hackathon demo (shelter mission, 13 steps)

Personas: **Jordan** (Harbor Light Shelter staff), **Priya** (sponsor at the shelter), **Leo**
(Northside Community Fund, an external sponsor), **Dana** (Beacon Basics merchant), **Sam**
(Kraftfold merchant), **Maya** (bakery owner, standalone PromiseTwin).

1. **Describe the need.** Jordan opens _Create a Mission_ and types or speaks the request.
2. **AI creates a structured mission.** Source highlights show where each rule came from. The
   Mission Blueprint separates hard rules from preferences, and Jordan confirms.
3. **Discover and compare.** Run the agents. The Supply Constellation shows every listing; the
   scented kit is excluded with a reason. The Procurement Canvas compares alternative plans.
4. **Optimize and negotiate.** The plan splits 30 kits across CleanStart and Beacon. The mission is
   public, so Dana (Beacon) offers 30 at $6.00; the Negotiation agent recommends a counter; Jordan
   counters $5.20, Dana accepts, and Jordan re-plans with the accepted offer.
5. **Sponsors fund specific orders.** On _Explore Missions_, Leo sees a match and funds the Beacon
   order; Priya funds CleanStart. There is one PayPal order per merchant and no pooled wallet.
6. **PayPal processes the payment.** Real Sandbox when credentials are set; otherwise the labelled
   simulated rail runs the same lifecycle.
7. **Track procurement.** Mission Atlas, Allocation Ribbon and Mission Pulse update live.
8. **A stockout interrupts the mission.** The demo merchant console reports a stockout.
9. **AI re-plans** the unmet quantity within the remaining budget.
10. **PromiseTwin inspects the affected order.** It records the breach (root cause: merchant
    stockout), voids the uncaptured authorization and lists permitted remedies.
11. **The replacement payment** needs a fresh sponsor approval.
12. **The organization confirms receipt.** This is the only delivery evidence.
13. **Mission Atlas and the Mission Receipt** show paid, never charged and received. The receipt can be
    downloaded.

The API smoke scripts cover both halves: `smoke:needmesh` runs steps 3 and 5–13, and
`smoke:marketplace` runs the publish → offer → counter → accept → two-sponsor path in step 4.

**Secondary example:** sign in as Maya to see PromiseTwin protect a single bakery purchase that is
about to be late.

## Layout

| Path                           | What                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------- |
| `packages/contracts`           | Shared Zod schemas, enums, read-model types, money and time-zone helpers        |
| `backend`                      | NestJS 11 + Fastify API, Prisma 6 / PostgreSQL, deterministic engines, SSE      |
| `backend/src/modules/needmesh` | Mission planner, policy engine, lifecycle service, PayPal rail, narration guard |
| `frontend`                     | Next.js 15 App Router, React 19, Tailwind 4, TanStack Query, Anime.js 4         |
| `scripts`                      | Embedded Postgres, API smoke tests, browser E2E (Edge via Playwright)           |

## Run locally

Requirements: Node 22+ (tested on Node 24) and npm 10+. Docker is optional (`compose.yaml`
provides Postgres, Redis and MinIO); without Docker, `npm run db:start` runs an embedded PostgreSQL 17.

```powershell
npm install
copy backend\.env.example backend\.env      # then set AUTH_SESSION_SECRET to a long random value
copy frontend\.env.example frontend\.env.local

npm run db:start                              # terminal 1: PostgreSQL on :5432 (keep running)
npm run build:contracts
npm run db:deploy                             # apply migrations
npm run demo:seed                             # shelter + bakery scenarios (fictional, labelled)
npm run dev                                   # API on :4000, web on :3000
```

Open [http://localhost:3000](http://localhost:3000) and choose **Create a Mission** (signs in as Jordan) or **Explore Missions**.
API docs: [http://localhost:4000/docs](http://localhost:4000/docs) (OpenAPI JSON at `/openapi.json`).

### Using real PayPal Sandbox

1. Create a Sandbox REST app and a Sandbox business and personal account in the PayPal Developer Dashboard.
2. In `backend/.env` set `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `ENABLE_LIVE_PAYPAL_WRITES=true`.
   The rail switches from Simulated to **PayPal Sandbox**, and the sponsor is redirected to PayPal to
   approve each order (`PUBLIC_BASE_URL` must be reachable from the browser).
3. Optional: `PAYPAL_MCP_ENABLED=true` lets the Recovery Agent read orders through the official PayPal MCP server.
4. Optional: register a webhook at `<public url>/v1/paypal/webhooks` and set `PAYPAL_WEBHOOK_ID`.
5. Optional: `LLM_PROVIDER=gemini` with `GEMINI_API_KEY` for narration.
6. Set `DEMO_MODE=false` so merchants act from their own accounts instead of the simulated console.

### Two-browser demo (Sandbox)

Every seeded account signs in with email and password (`DEMO_ACCOUNT_PASSWORD`, default
`needmesh-sandbox`). Each browser keeps its own session, so use two browsers (or one normal and one
private window):

| Account                      | Role                                                |
| ---------------------------- | --------------------------------------------------- |
| `jordan@harborlight.example` | Shelter admin: runs the agents, confirms receipt    |
| `priya@sponsor.example`      | Shelter sponsor: approves orders on PayPal          |
| `leo@northsidefund.example`  | External sponsor (Northside Community Fund)         |
| `alex@cleanstart.example`    | CleanStart merchant: confirm stock, ship, stockout  |
| `dana@beaconbasics.example`  | Beacon Basics merchant: offers, confirm stock, ship |
| `hana@harborgoods.example`   | Harbor Goods merchant: picks up recovery re-plans   |

1. Browser A: Jordan opens the shelter mission and clicks **Run NeedMesh agents**. The AI Command
   Center shows the agents working, Gemini's explanation and the policy check.
2. Browser B: Priya opens the same mission, clicks **Approve & authorize in PayPal** and logs in with
   the Sandbox **personal** account. Browser A sees the PayPal authorization arrive live.
3. Browser B: sign in as Alex (CleanStart) and click **Confirm stock**; the PayPal agent captures the
   payment. Or click **Report stockout**: the Recovery agent voids the authorization on PayPal and
   re-plans.
4. Browser A: Jordan confirms receipt and the Mission Receipt is issued.

`npm run demo:seed` resets the shelter mission to a fresh state.

### Corporate networks with TLS inspection

If Prisma engine downloads or Google Fonts fail with `self-signed certificate in certificate chain`,
let Node trust the OS certificate store for that shell:

```powershell
$env:NODE_OPTIONS = '--use-system-ca'
```

## Quality gates

```powershell
npm run lint              # ESLint across the workspace
npm run format:check      # Prettier
npm run typecheck         # contracts, backend, frontend
npm test                  # Vitest unit tests (policy, planner, state, PayPal rail with mocked fetch)
npm run build             # contracts, backend, frontend
npm run smoke             # PromiseTwin API smoke test (needs the API running)
npm run smoke:needmesh    # full NeedMesh lifecycle over the API incl. stockout recovery
npm run smoke:marketplace # marketplace, negotiation, two sponsors, analytics, forecast, repeat
npm run e2e               # browser E2E (needs web + API running)
node scripts/e2e-needmesh.mjs   # browser walk-through of the NeedMesh demo
```

## Safety net walkthrough (Promesa PromiseTwin)

1. **Dashboard** as Maya: Crumb & Co. Bakery has one PromiseTwin, which is **At risk**.
2. Kraftfold (fictional) accepted delivery before Fri 5:00 PM ET, then revised its estimate to
   Monday. The twin shows the drift and separates facts from predictions.
3. The **demo clock** moves past the deadline and the twin becomes **Breached**, backed by evidence.
4. **History** pages through the immutable snapshots.
