# NeedMesh web (`@promesa/frontend`)

Next.js 15 App Router, React 19, TanStack Query, Tailwind 4 and Anime.js 4. The UI uses a light
fintech style: white paper on a cool canvas, PayPal-adjacent blues, tabular numbers and an
editorial serif for headings. There are no gradients, blobs or glassmorphism.

**NeedMesh is the product.** About 80% of the surface is missions, the marketplace, merchants,
funding and outcomes. **PromiseTwin** appears as built-in protection on every mission order and as
standalone purchase protection.

Feature status: [`docs/NEEDMESH_FEATURE_AUDIT.md`](../docs/NEEDMESH_FEATURE_AUDIT.md).

## Routes

| Route                              | Audience                 | What                                                                                                       |
| ---------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `/`                                | Public                   | "Tell us what's needed. Our AI finds a way." Create a Mission / Explore Missions; PromiseTwin further down |
| `/explore`                         | Public, sponsors         | Reverse marketplace: search, categories, public-safe mission cards, sponsor match                          |
| `/how-it-works`                    | Public                   | Agents plan, policy decides, PayPal executes                                                               |
| `/sign-in`                         | Demo                     | Persona picker (Jordan, Priya, Leo, Dana, Sam, Maya)                                                       |
| `/dashboard`                       | All roles                | Missions and pending actions first, then shortage forecast and PromiseTwin purchases                       |
| `/missions/new`                    | Organizations            | AI Mission Studio: text or voice, source highlights, Mission Blueprint, confirmation                       |
| `/missions/:id`                    | Org, sponsors, merchants | Mission Control (see below) and the Procurement Canvas                                                     |
| `/merchant`                        | Merchants                | Matching opportunities, offers and counteroffers, orders, catalog                                          |
| `/analytics`                       | Org, sponsor, merchant   | Outcomes, captured vs never-charged, recoveries, per-merchant stats                                        |
| `/notifications`                   | All                      | Pending actions and activity (bell badge in the header)                                                    |
| `/settings`                        | Org, sponsor             | Verification request, saved purchasing preferences and funding interests                                   |
| `/protection`                      | All                      | PromiseTwin overview: mission orders and standalone purchases                                              |
| `/purchases/new`, `/purchases/:id` | Businesses               | Standalone purchase protection                                                                             |
| `/twins/:id`, `/twins/:id/history` | Businesses               | PromiseTwin: Promise Threads, Faultline, Recovery Workbench, Proof Passport, Timefold                      |

## Mission Control (`components/needmesh/`)

`mission-control.tsx` lays out the mission page. `mission-panels.tsx` holds the signature
interactions. All of them render live API data:

- **Mission Pulse**: the latest mission event; it animates only when a new event arrives.
- **Mission Atlas**: requested → sourced → funded → paid → shipped → received, kept separate.
- **Allocation Ribbon**: the budget split by merchant order, with each sponsor and released amounts.
- **Agent graph**: the stored planning or recovery run, node by node.
- **Supply Constellation**: every listing considered (eligible, excluded or allocated), with freshness
  labels and the discovery sources (Channel3 is shown as not configured).
- **Negotiation**: merchant offers, the agent's recommendation and the org's accept, counter or decline.
- **Sponsors**: who funded which order, and what is still unfunded.
- **Order cards**: PayPal IDs, funded-by and negotiated badges, and a per-order **PromiseTwin** panel
  with four tracks, gaps and remedies.
- **Mission Receipt**: JSON download and print. **Publish / Repeat** controls for org admins.

The **Mission Blueprint** lives in `components/intent/intent-composer.tsx`. The landing-page Atlas
is a labelled demo fixture.

## Conventions

- The server decides what is allowed (`allowedActions`, `nextStep`). The UI only renders it.
- Simulated data is always labelled (`SimulatedTag`, "Simulated rail", "Demo fixture").
- Public views never show delivery addresses or beneficiary identities.
- Motion goes through `useAnimeScope` (`lib/motion.ts`), which respects reduced-motion settings.
- Unsafe requests carry `X-Promesa-Csrf`; the session is an HTTP-only cookie (`lib/api.ts`).

## Scripts

```powershell
npm run dev -w @promesa/frontend     # http://localhost:3000 (API on :4000)
npm run build -w @promesa/frontend   # set NEXT_DIST_DIR to build next to a running dev server
npm run e2e                          # browser E2E from the repo root (web + API running)
node scripts/e2e-needmesh.mjs        # NeedMesh mission walk-through
```
