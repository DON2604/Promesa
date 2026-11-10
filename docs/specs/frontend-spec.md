# NeedMesh + PromiseTwin AI — Frontend README | The Outcome Atelier

> **Realignment note (Nov 2026):** The product hierarchy is NeedMesh first. The homepage leads with
> "Tell us what's needed. Our AI finds a way." Its calls to action are Create a Mission and Explore
> Missions, and PromiseTwin is presented further down as built-in protection. The UI is a light-only
> fintech theme; the dark theme was removed. NeedMesh signature interactions (Mission Blueprint,
> Supply Constellation, Procurement Canvas, Mission Pulse, Allocation Ribbon, Mission Atlas) sit
> alongside the PromiseTwin ones described below. Current status:
> [`../NEEDMESH_FEATURE_AUDIT.md`](../NEEDMESH_FEATURE_AUDIT.md). As-built guide:
> [`../../frontend/README.md`](../../frontend/README.md).

> **Cursor build instruction:** You are the lead frontend engineer. Build a complete, runnable, production-grade Next.js application for the product specified below. This README is an executable specification, not an invitation to create another plan. Implement screens, accessible components, authentication, typed API integration, PayPal Sandbox checkout, tests, and a deployable demo. Work through the numbered phases, run checks after each phase, and fix failures. Never pretend a backend or payment integration exists; where credentials or a running backend are absent, provide a clearly labeled demo adapter and preserve the real integration path.

**Product:** NeedMesh — outcome-driven agentic commerce, with **PromiseTwin AI** as the post-purchase intent/fulfillment/recovery engine.  
**Tagline:** *From payment intent to proven outcome.*  
**Positioning:** An independent hackathon project showcasing PayPal's AI developer tools, MCP integration, and commerce APIs. **Not** an official PayPal product or partnership.

Read `../backend/README.md` before building; it defines domain rules, API payloads, security contracts, and production architecture. Implement against the shared API contracts. Do not invent endpoints or turn real payment flows into silent mocks. **This is a build brief for working software, not just visuals.** The uploaded Synex screenshot is a reference for *editorial whitespace, sculptural composition, deliberate hierarchy and framed product mockups*; do not copy its logo, words, rock photograph, site assets or layout exactly.

---

## 1. Product narrative and user types

### Core principle
A successful PayPal payment is **not** the same as a fulfilled promise. NeedMesh first arranges an authorized purchase. Every purchase creates a PromiseTwin: an independently inspectable, evolving representation of (a) buyer intent, (b) seller commitments, (c) PayPal payment state, and (d) delivery/recipient evidence. If the intent is not achieved, agents investigate and propose a safe remedy.

### Two entry experiences, one underlying engine

1. **NeedMesh Missions — organization/sponsor:** A vetted organization requests supplies, such as 30 hygiene kits under USD 175. AI creates a sourcing plan. A sponsor reviews and approves individual merchant purchases through PayPal. Organization confirms receipt; a Mission Receipt links funds and fulfillment.
2. **PromiseTwin Purchases — small-business buyer:** A bakery requests 100 food-safe *paper* packaging boxes under USD 100, needed by Friday. AI evaluates offers, seller expressly confirms delivery terms, buyer approves checkout, and the twin monitors delivery. If the promise fails, AI explains why and recommends an authorized resolution.

Roles (multi-tenant with backend-enforced authorization): `BUYER`, `SPONSOR`, `ORG_ADMIN`, `ORG_OPERATOR`, `MERCHANT_ADMIN`, `MERCHANT_OPERATOR`, `PLATFORM_SUPPORT`, `PLATFORM_ADMIN`. Users may hold multiple roles scoped to one or more organizations. Role switching must be explicit.

### Three unforgettable demo moments

- **AI understands intent:** A natural-language request transforms into editable, testable constraints: SKU/attributes, prohibited materials, count, unit, total budget, deadline and time zone.
- **PayPal actually transacts:** A sponsor or buyer sees accurate line items and authorizes a PayPal Sandbox order, with a real PayPal order ID and subsequent verified payment status.
- **PromiseTwin self-heals responsibly:** A mock merchant stockout or late delivery produces an evidence-backed, severity-ranked incident. AI proposes a replacement, partial remedy, or refund request. Only permitted merchant-authorized refunds run; a new purchase requires the buyer to confirm again.

---

## 2. Stack and repository conventions

- Next.js (stable App Router release) + React + TypeScript `strict`.
- Tailwind CSS, shadcn/ui primitives + Radix for accessible dialogs, TanStack Query for server state, React Hook Form + Zod for validated forms, Zustand for ephemeral UI-only state.
- AG Grid Community for mission and financial operations tables; optionally integrate AG Studio or Enterprise features only when permitted by license.
- Visually restrained charts (Recharts or native SVG as appropriate), Lucide icons, **Anime.js v4** for purposeful choreographed motion, React Aria where needed. **Do not install Framer Motion or Motion** alongside Anime.js; default to CSS transitions or Web Animations API for simple state changes.
- OpenAPI-generated typed client from backend `/openapi.json` (e.g., `openapi-typescript` + `openapi-fetch`). No handwritten duplicate server DTOs unless generated client is temporarily unavailable.
- Playwright E2E; Vitest + Testing Library for unit/component tests; axe accessibility checks.
- Prefer `pnpm` workspaces. Frontend path is `frontend/`; backend at `backend/`; optional `packages/contracts/` if the workspace uses generated shared types.

Target structure:

```text
frontend/
  app/
    (public)/page.tsx
    (public)/how-it-works/page.tsx
    (auth)/sign-in/page.tsx
    (workspace)/layout.tsx
    (workspace)/onboarding/page.tsx
    (workspace)/dashboard/page.tsx
    (workspace)/missions/new/page.tsx
    (workspace)/missions/[id]/page.tsx
    (workspace)/missions/[id]/offers/page.tsx
    (workspace)/missions/[id]/checkout/page.tsx
    (workspace)/missions/[id]/receipt/page.tsx
    (workspace)/purchases/new/page.tsx
    (workspace)/purchases/[id]/page.tsx
    (workspace)/twins/[id]/page.tsx
    (workspace)/twins/[id]/recover/page.tsx
    (workspace)/twins/[id]/history/page.tsx
    (workspace)/atlas/page.tsx
    (workspace)/merchant/orders/page.tsx
    (workspace)/merchant/orders/[id]/page.tsx
    (workspace)/operations/page.tsx
    (workspace)/settings/page.tsx
    api/auth/[...]/route.ts   # only if needed for auth callbacks; do not proxy PayPal secrets
    layout.tsx
  components/
    layout/ mission/ intent/ offers/ paypal/ twin/ evidence/ recovery/ analytics/ common/
    atelier/                    # paper, ink, proof, seams, tokenized status UI
    storytelling/               # interactive promise trace and receipt fold
    motion/                    # Anime.js dynamic-import animations + reduced-motion policy
  features/
    auth/ missions/ purchases/ paypal/ twins/ merchants/ recovery/ reporting/
    promise-threads/ timefold/ recovery-bench/ proof-passport/
  lib/
    api/ auth/ config/ currency/ datetime/ errors/ events/ security/
    design-tokens/ animation-policy/ feature-flags/ provenance/
  hooks/ styles/ public/ tests/ e2e/
  .env.example
  package.json
  README.md
```

Build mobile-first for 360px widths while prioritizing clear desktop dashboards. Use SSR/server components where practical; payment button, charts, live updates, dialogs and forms require explicit client components.

---

## 3. Design system: The Outcome Atelier (NOT another fintech template)

**Design philosophy: _Editorial evidence × tactile commerce × precise instruments._** The UI should feel crafted by a small, opinionated product-design team: the calm of a contemporary editorial magazine, the tactility of folded packaging/receipts, and the trustworthiness of a well-engineered instrument. The user-provided Synex image establishes the *mood*: lots of blank white space, exceptional type, a dashboard revealed beneath a sculptural composition. Translate that into an ORIGINAL NeedMesh language. Never reproduce Synex branding, exact hero, rock assets or dashboard.

### Art direction and visual story

- **Signature motif — the Fold:** a seam, crease, or thin dual-ruled line represents the distance between a promise and its outcome. On a successful mission, two visual ends meet; on a breach, the seam separates and exposes the factual gap. This is an original NeedMesh brand motif, not a decorative graph.
- **The world of tangible commerce:** asymmetrically cropped photographs or custom SVG/3D-lite illustrations of cardboard folds, paper edges, parcel labels, seals, clipped invoices and shipping textiles. Use licensed human-made photography or CSS/SVG geometry; avoid shiny AI-generated blobs, hand-with-phone stock photographs, random coins or crypto imagery. Image assets should be optional and below a visible, text-first first render.
- **One large editorial idea per viewport:** landing page hero has a two-line contrast headline, an oversized proof object or folded receipt silhouette, and a restrained floating UI preview below the fold. Let the form feel like a product studio, not a neon trading terminal.
- **Interfaces as readable artifacts:** quotes look like purchase orders, constraints like stamped specifications, merchant acceptance like an actual signed agreement, and the final Mission Receipt like a crisp printable document. The *data and actions* remain accessible HTML, not text burned into images.
- **Graphic restraint:** prefer thin ink lines, overlapping pale surfaces, grid gutters, large black numbers and tiny monospaced annotations. Keep the highest-contrast action a real primary button, not a fake interactive decoration.
- **No stereotypical AI styling:** no purple gradients, neon halos, glassmorphism everywhere, astronaut illustrations, infinite spinning orbs, generic chatbot bubbles, emoji-based branding, synthetic 3D faces, or dashboard walls of interchangeable KPI cards.

### Design tokens — implement as CSS custom properties and Tailwind theme

| Token | Light value | Job |
| --- | --- | --- |
| `--canvas` | `#F7F6F2` | warm gallery/off-white background |
| `--paper` | `#FFFEFB` | cards, invoices, receipt surfaces |
| `--ink` | `#171A18` | primary typography and outlines |
| `--muted-ink` | `#6F746E` | factual secondary text |
| `--hairline` | `#DCDDD5` | fine document rules |
| `--signal` | `#2852D7` | one restrained commerce accent (not PayPal brand artwork) |
| `--good` | `#287B58` | verified successful stage *with text* |
| `--caution` | `#B46B28` | deadlines approaching, uncertainty |
| `--breach` | `#B8453C` | evidence-backed breach, never use for AI guess alone |
| `--cutout` | `#E8E4D9` | tactile editorial panels, not a second background gradient |
| `--radius-sheet` | `10px` | small paper corners |
| `--radius-ui` | `12px` | interactive controls |
| `--line-weight` | `1px` | separators and visible provenance |

- **Type system:** choose one strong editorial display face with an appropriate open license and one legible UI sans; optional mono for IDs, timestamps and evidence tags. Download/self-host subsets; no font files should be committed unless licensed. Maintain legibility with fallback stacks. Display headings should be bold and dense, NOT default extra-large gradient marketing headers. Aim at 72–112px desktop hero (using `clamp()`), 40–60px mobile, 14–16px body, 12–13px evidence labels; adapt to content.
- **Visual grid:** narrow max reading width (60–75 characters), 12-column editorial desktop grid, 8px spacing scale, 4/8/12px interior rhythm, desktop top nav thin and unobtrusive; tablet and mobile collapse into a single deliberate reading path. Use container queries for artifacts, not JS window listeners for basic layout.
- **Material vocabulary:** visible sheet edges, 1px offsets, paper folds via pseudo-elements, subtle grain only if compressed and not covering text. Absolutely no browser-window chrome copied from reference screenshot.
- **Brand rule:** PayPal logos/buttons and payment confirmation UI must follow current PayPal branding and SDK restrictions. NeedMesh's visual metaphor is its own brand; never visually impersonate a PayPal-issued confirmation or suggest an official partnership.
- **Accessibility:** target WCAG 2.2 AA; semantic forms, keyboard navigable stepper, focus visibility, reduced-motion support, 44px touch targets, text alternatives for graphs, time zone and provenance read aloud. Build a solid dark theme manually only after light theme is excellent.

### Signature page compositions

```text
LANDING / DESKTOP
  minimal topbar: NeedMesh mark                  [How it works] [Open studio]
  ---------------------------------------------------------------
                 [ small chapter label / 01 ]
           THE PAYMENT WAS SUCCESSFUL.
             DID THE PROMISE ARRIVE?                <- display line contrast
             short, useful subhead
               [Create a mission] [Protect a purchase]
  left: stacked clipped intent cards     right: dramatic FOLDED PAPER sculpture
         with one visible promise seam           (CSS/SVG, not heavy WebGL)
  ----------------------- seam / progress rule -------------------
       live PromiseTwin preview overlaps pale paper specimen below
  bottom: "One goal. Multiple transactions. One traceable outcome."

PROMISETWIN / DESKTOP
  headline: "A payment is a moment. A promise is a timeline."
  left rail: what was requested / agreed  |  center: evidence threads
  right inspection drawer: PayPal truth   |  lower: Recovery Workbench

MOBILE
  1-column story, sticky compact status ribbon, touch-friendly timeline,
  evidence drawer as sheet, no horizontal document overflow.
```

### Purposeful bespoke UI elements (not generic fintech cards)

| Element | Appearance and interaction | Information that makes it real |
| --- | --- | --- |
| **Promise Fold** | Click to unfold a folded-paper intent card into testable constraints; reverse to inspect the original quote | raw request, approved intent version and user confirmation |
| **Promise Threads** | A fine, interactive branching thread connecting Intent → Merchant Commitment → PayPal Payment → Evidence → Outcome | timestamped immutable event IDs, source labels, gaps and discrepancies |
| **The Faultline** | A subtle seam separates when a real breach is determined; inspection reveals the precise unmet criterion | `BREACHED` evaluation, breach criteria, earliest justified timestamp |
| **Recovery Workbench** | Three tactile proposal strips: replace, refund/request remedy, or wait/escalate; each lays out cost/time/tradeoffs | policy-eligible options, estimates, permission state and approvals |
| **Timefold** | Drag through **historical** promise snapshots like pages in a booklet; live events continue separately | immutable snapshots and event sequence, never invented history |
| **Proof Passport** | A clean fold-out Mission Receipt with paper-stamp evidence provenance, transaction links and share/print | PayPal-sourced transaction IDs and distinctly attributed delivery evidence |
| **Mission Atlas** | Small connected-field diagram showing needed, sourced, funded and recipient-confirmed units | backend-derived aggregates, never speculative impact scoring |
| **Quiet Signals** | Minimal inline indicator bars and typographic changes instead of endless dashboard animations | actual state changes received over SSE or refreshed APIs |

Creative details must reveal decisions or evidence. If the user cannot understand what a motion or effect explains, remove it.

### Design implementation guardrails

- Use a bespoke mark and original iconography built from simple vector shapes; avoid pasting a template logo or using image-generation output as the entire hero.
- Keep photography optional, properly licensed, localized and optimized. Provide a text/CSS/SVG fallback. Never load a 3D engine only for atmosphere.
- Use restrained HTML/CSS composition first. Anime.js enhances 4–6 signature moments, not every mouse hover or number update.
- First screen must communicate an actual value proposition, and first CTA must be functional.
- Make the name PromiseTwin visually subordinate to NeedMesh in navigation while giving it a distinct detail view. Distinguish branded product visuals from actual PayPal-controlled payment UI.

---

## 4. Required routes and screen-level behavior

### A. Public landing (`/`)
- Impactful hero: “Payments should achieve promises.” Two product entrances: **Start a mission** and **Protect a purchase**.
- 3-step narrative illustration (intent → PayPal transaction → PromiseTwin monitoring/recovery), animated only as progressive disclosure.
- Real vs simulated demonstration labels; product rationale and privacy statements; CTA **Try Sandbox demo**.
- “Built with PayPal Agent Toolkit, MCP, Orders and Webhooks” technology section with carefully qualified wording.

### B. Onboarding and role selection (`/onboarding`)
- Choose buyer, organization, sponsor or merchant. Create or join tenant; enter business/organization profile and timezone.
- For a merchant: show available PayPal connectivity status and a truthful permissions explanation. MVP may use one configured Sandbox merchant; more merchants are fictional catalog entries unless separately connected.
- No bank-account, PayPal password, or PayPal client-secret form in browser.

### C. Workspace dashboard (`/dashboard`)
- Role-specific cards: active missions, twin health, pending approvals, captured spend, at-risk purchases, delivered units.
- Metric source tags and drilldowns. “Impact” is calculated only from recipient-confirmed quantities.
- Recent activity feed with verified event provenance. Filter by `SOURCE`, `STATUS`, `DATE` and `MISSION`.

### D. Mission creator (`/missions/new`)
- Natural language textarea with optional voice input using browser-supported APIs; text entry must always work.
- Example: “Our shelter needs 30 hygiene kits by Friday at 6 p.m., total budget $175, no fragrances.”
- Call `POST /v1/intent/compile`; show AI interpretation side-by-side with raw request.
- Editable **hard constraints** (quantity, required materials, deadline, exclusion list, max total) and **soft preferences** (brand, proximity, reusable packaging).
- Explain assumptions and unresolved questions; require deliberate user confirmation before sourcing.
- Add organization delivery address only after role authorization; redact for public/sponsor view as appropriate.

### E. Personal purchase creator (`/purchases/new`)
- Same intent compiler but optimized for small-business procurement; bakery example is seeded.
- Display structured contract objectives and an obvious caveat: a desired Friday deadline is NOT a merchant commitment until that merchant explicitly agrees.
- Distinguish “requested” vs “seller accepted” terms with two columns.

### F. Offer exploration (`/missions/[id]/offers` and `/purchases/[id]`)
- Merchant cards compare: attributes, units, pricing, shipping, availability freshness, accepted delivery terms, evidence source, payment eligibility, overall budget fit.
- Color-code hard constraint conflicts and show why options are excluded. A low price never overrides a hard material requirement.
- Provide `Why this offer?` evidence drawer with cited source, timestamp and freshness.
- For a multi-seller mission, plan separate merchant orders and separate required buyer approvals unless an actually enabled PayPal partner product supports a different authorized flow.
- Sponsorship allocation: donor chooses a specific proposed merchant order, not a generic communal wallet. No fundraising-pool or tax-deductible donation claims.

### G. PayPal checkout (`/missions/[id]/checkout`)
- Locked review summary (merchant identifier, exact items, count, taxes/shipping, currency, final amount, budget remaining, accepted terms).
- Request a server-created order and render genuine PayPal JavaScript SDK v6 checkout for the connected merchant. Show PayPal-branded checkout only if initialized correctly.
- For v6 specifically, the `createOrder` callback must resolve to **`{ orderId: string }`**, not the v5-style raw string. Consult and implement the **current** official PayPal v6 session/button API from https://developer.paypal.com/sdk/js/set-up before coding; do not blindly paste v5 examples.
- Display pending state after UI approval until backend has verified capture/order state. Never assume `onApprove` equals successful capture.
- Disable duplicate submission and expose non-destructive retry/status refresh. If session expires, clear stale state safely.
- Non-USD currencies require verified availability and PayPal eligibility; MVP demo uses USD.

### H. PromiseTwin observability (`/twins/[id]`)
This is the hero feature. Three synchronized panels:

1. **Human intent:** Original user prompt, immutable intent snapshot, hard/soft constraint pills, total ceiling, time zone and requested arrival deadline.
2. **Seller promise:** Versioned offer acceptance with specific quantities, material/type, delivery commitment and refund/cancellation terms. Show “Not accepted” when no commitment exists.
3. **Reality:** Verified PayPal transaction lifecycle; merchant shipment reports; external tracking if genuinely connected; buyer/organization handover evidence. Each entry includes source, event time, ingestion time, confidence and evidence link.

Also include:
- Large **Promise Health** badge: `ON_TRACK`, `AT_RISK`, `BREACHED`, `FULFILLED`, `UNDETERMINED`, `UNDER_RECOVERY`.
- Four-track chronological rail (`Intent`, `Merchant`, `PayPal`, `Delivery`) that aligns commitments with observations.
- Evidence provenance tags. AI-generated conclusions are marked as interpretations.
- “Why is this at risk?” explanation with facts vs predictions clearly separated.
- Evaluation version and **Re-evaluate** command; show last data refresh.
- UI must not diagnose cause as fact when evidence is incomplete.

### I. Recovery center (`/twins/[id]/recover`)
- Incident summary, breach classification, evidence, seller terms, proposed recovery options and estimated time/cost differences.
- Options may include: contact merchant, request revised fulfillment, request merchant-authorized partial/full refund, void eligible uncaptured authorization, consider separately approved replacement purchase, escalation to support. Never promise refund eligibility or success.
- Two-stage explicit consent: a buyer may approve a **replacement transaction**; a connected merchant authorized to operate on its account may approve a **refund**. A buyer cannot grant the app power to refund a merchant's captured payments.
- Confirmation dialog with terms, amount, merchant, currency, effect on existing payment, whether merchant permission exists and whether funds are actually available.
- State machine statuses `PROPOSED`, `AWAITING_BUYER`, `AWAITING_MERCHANT`, `AUTHORIZED`, `EXECUTING`, `SUCCEEDED`, `FAILED`, `CANCELLED`.
- Never display “Refunded” until PayPal API/webhook reconciliation confirms it.
- Human override and support escalation with audit trail.

- Replace generic action cards with structured proposal strips. Compare earliest estimated recovery time, new spend amount, refund-dependent funds, confidence/evidence and policy reasons.
- Include side-by-side seller/buyer approval panel with exact snapshot hash/version, never a single ambiguous “auto-heal” button.
- When refund is impossible, display merchant response/request and escalation path; provide no false “refund available” button.

### J. Merchant workspace (`/merchant/orders/[id]`)
- Merchant reviews/accepts terms BEFORE a commitment is displayed as agreed.
- Show captured order lines, confirmation of inventory, delivery commitment and refund eligibility policy.
- Update fulfillment; add permitted PayPal tracking info (merchant-authorized), attach evidence, respond to incidents, and approve or reject eligible remedy/refund.
- Restrict UI and backend actions by merchant account ownership; merchant user cannot change someone else's order.

### K. Organization receipt (`/missions/[id]/receipt`)
- Printable and shareable **Mission Receipt**, generated from a backend snapshot, not a client-only fabricated PDF.
- Separate sections for PayPal financial state, merchant fulfillment, recipient acknowledgment and observed impact metrics.
- Show one row per PayPal capture; if not paid say “Payment not completed”. If not received say “Delivery not confirmed”.
- Public receipt view must mask buyer names, email, precise delivery address, recipient identity and private evidence unless opted in.
- Generate/download via authenticated backend endpoint and provide stable share link with revocation.

### L. Operations (`/operations`)
- AG Grid table: mission ID, owner, payable amount, merchant, payment state, promise state, SLA deadline, evidence gaps, actions.
- Filter, sort, group, export authorized data only. Status drilldown routes to original source evidence.
- Analytics show time to mission plan, funding conversion, at-risk count, confirmed units fulfilled, refund time. No fictitious claims of “lives saved”.

---

### M. Promise Atlas (`/atlas`)
- A compact editorial exploration, not a gamified map. Use SVG/HTML accessible controls to display aggregate mission lifecycle: requested quantities, eligible offers, PayPal-confirmed paid quantities, seller-acknowledged shipment, recipient acknowledgment.
- Each segment is clickable and routes to the real records that justify it. No extra meaning added to payment status.
- Mobile uses an ordered list, never an unreadable network blob. Cross-tenant data stays aggregated and authorized.

### N. Timefold historical viewer (`/twins/[id]/history`)
- A timeline slider to inspect immutable state snapshots and dated evidence. Clearly indicate `Historical view` and `Live view`; never turn the current transaction state backward.
- Show what the user and merchant knew at a selected historical point, and label evidence that arrived later.
- Do not invoke expensive AI computation on every scrub; use cached/paginated snapshot data.


## 5. Concrete interaction design and components

```text
AppShell
├── Topbar (workspace, role selector, command search, notifications, avatar)
├── Sidebar (Missions, Purchases, PromiseTwins, Recovery, Merchant, Insights)
└── ResponsiveContent
    ├── IntentComposer / IntentConstraintEditor / AssumptionList
    ├── AgentExecutionTimeline / ToolCallEvidenceDrawer
    ├── OfferComparisonGrid / ComplianceChip / SellerCommitmentPanel
    ├── CheckoutReview / PayPalPaymentButton / PaymentStateBanner
    ├── PromiseTwinVisualizer / EvidenceTimeline / HealthMeter
    ├── RecoveryOptionCards / ApprovalDialog / ResolutionTimeline
    ├── MissionReceipt / ProvenanceBadge / ReceiptDownload
    └── MissionOperationsGrid / MetricCard / FilterBar
```

### Required interaction states
Every data-driven component must implement meaningful loading, empty, partial, error, stale and success states. PayPal `PENDING` is not a success state. Use accessible optimistic UI only for harmless local preferences; never optimistic payment confirmation, refund, shipment or delivery acknowledgment.

### Updates
Use authenticated Server-Sent Events at `GET /v1/stream` with reconnection/backoff and last-event IDs; fallback to polling when SSE is unavailable. Update TanStack Query caches after receiving domain events. Do not stream raw agent chain-of-thought or credentials; show sanitized tool names, inputs summary, status, duration, and non-sensitive references.

---

## 5A. Motion language — Anime.js v4, art-directed and fast

**Motion is an explanation system, not decoration.** All business state comes from typed backend events; animations are derived views. Prefer CSS transitions for buttons, dropdowns and focused inputs. Use **Anime.js v4** only for distinctive sequences. Check official Anime.js documentation and installed version before coding (`animate`, `createTimeline`, `createScope`, optional lightweight `waapi.animate`). Avoid v3 `anime({ targets: ... })` syntax. No WebGL, particle systems, animated background videos, smooth-scroll hijacking or permanent global loops.

**Allowed sequence vocabulary**:

1. **Hero editorial reveal:** on first visit only, headline segments rise 12–18px and opacity settles once; illustrative folded-paper specimen opens after copy is legible. No repeated animation on navigation.
2. **Promise Fold:** user opens a physical-like sheet; transforms and clip effects max 350ms; actual constraints remain present to assistive technology and fully operable without JS motion.
3. **Promise Thread:** progressively illuminate existing event nodes only when they enter the viewport or a real domain event arrives. No continuously moving dots or fake agent activity.
4. **Faultline:** one subtle separation/line color change on confirmed evidence-based breach; do not animate a possible breach as confirmed.
5. **Recovery Workbench:** compare alternatives with a short staggered reveal after backend returns options; prevent motion while the user is reviewing dollar amounts or approvals.
6. **Proof Passport:** paper sheet folds into a print-ready document; actual PayPal amounts and IDs remain ordinary selectable text and never animate numerically from zero to a supposedly captured amount.

**Motion tokens:** `--motion-fast: 140ms`, `--motion-normal: 240ms`, `--motion-story: 420ms`, `--motion-ease: cubic-bezier(.22,1,.36,1)`. Use <= 550ms for non-hero motion. Avoid 500ms page loads waiting for animation. All interactions must work with motion disabled.

**Copy-ready React integration pattern (one component; dynamically load on interaction or visibility):**

```tsx
'use client';
import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

export function QuietReveal({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = root.current;
    if (!node || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let cancelled = false;
    let scope: { revert: () => void } | undefined;
    const observer = new IntersectionObserver((entries) => {
      if (!entries[0]?.isIntersecting) return;
      observer.disconnect();
      void import('animejs').then(({ animate, createScope }) => {
        if (cancelled || !root.current) return;
        scope = createScope({ root }).add(() => {
          animate('.quiet-reveal-inner', {
            opacity: [0, 1], y: [14, 0], duration: 420,
            ease: 'out(3)'
          });
        });
      });
    }, { threshold: 0.15 });
    observer.observe(node);
    return () => { cancelled = true; observer.disconnect(); scope?.revert(); };
  }, []);

  return <div ref={root}><div className="quiet-reveal-inner">{children}</div></div>;
}
```

**Important:** content is **visible by default** before JavaScript loads; no CSS default `opacity: 0`. IntersectionObserver must have a browser fallback. Add type verification against installed Anime.js v4, and abort/cleanup on React Strict Mode unmount. For more advanced narrative sections, use `createTimeline()` only within a scoped mounted region, dispose on unmount, and make every effect pausable. Do not animate layout metrics (`top`, `left`, `height`) on every frame; favor `transform` and `opacity`. When a timeline's size changes, let CSS layout settle before playing motion.

### Animation state boundaries

- Only animate **after** the backend commits or confirms an event; never make a pending PayPal capture look successful.
- Never derive API writes from an animation `onComplete` callback; business behavior is independent of animation playback.
- Event sequence numbers determine ordering; if SSE reconnects with duplicates, do not replay celebration animations.
- A breach or refund state is not a celebration. Keep urgent action readable and quiet.
- Respect `prefers-reduced-motion`, `prefers-reduced-transparency`, `Save-Data` and hidden-tab status. Pause offscreen effects. No CPU work for static receipt pages.

### Performance budgets (initial targets, measure in CI)

| Metric | Performance target | Enforcement |
| --- | --- | --- |
| Core Web Vitals (mobile p75) | LCP <= 2.5s, INP <= 200ms, CLS <= 0.10 | Lighthouse CI + real-user metrics where feasible |
| First-party initial JS | aim <= 180KB gzip on public route, excluding 3rd-party PayPal SDK | route bundle analyzer; document actual numbers |
| Motion cost | no continuous full-screen effects; aim <= 16.7ms/frame on 60Hz devices | Chrome Performance trace on a midrange mobile profile |
| Hero images | AVIF/WebP responsive sizes, layout dimensions fixed, eager only for LCP object | Next/Image and build audit |
| Anime.js code | lazy loaded on specific route/visibility; tree-shake; no duplicate motion library | analyzer + Playwright route coverage |
| PayPal SDK | loaded only on checkout surface after eligibility/config ready | no SDK on landing/Atlas/receipt by default |
| Data-heavy UI | AG Grid dynamically loaded on operations route; rows paginated/virtualized | route-level chunks and synthetic large-list test |
| Timeline playback | page/snapshot fetching; no re-LLM call per cursor movement | network inspector and integration tests |

Use Next.js Server Components for content, Suspense boundaries and streamed server data when appropriate. Avoid render-blocking custom fonts, giant inline SVG and broad `use client` shells. Use `content-visibility: auto` for safe below-the-fold sections and fixed aspect-ratio placeholders to prevent CLS. When a budget fails, favor removing decoration rather than weakening fintech correctness.

---

## 6. API contract frontend must consume

Generate API types from backend OpenAPI. The expected endpoints are defined in `../backend/README.md`; frontend must support:

```text
POST   /v1/intent/compile
POST   /v1/missions
GET    /v1/missions/:id
POST   /v1/missions/:id/plan
GET    /v1/missions/:id/offers
POST   /v1/missions/:id/confirm-plan
POST   /v1/purchases
GET    /v1/purchases/:id
GET    /v1/twins/:id
GET    /v1/twins/:id/evidence
POST   /v1/twins/:id/evaluate
POST   /v1/twins/:id/incidents/:incidentId/propose-recovery
POST   /v1/recoveries/:id/approve-buyer
POST   /v1/recoveries/:id/approve-merchant
POST   /v1/recoveries/:id/execute
POST   /v1/checkout/orders
POST   /v1/checkout/orders/:paypalOrderId/capture
GET    /v1/checkout/orders/:paypalOrderId/status
POST   /v1/fulfillments/:id/evidence
POST   /v1/fulfillments/:id/acknowledge
GET    /v1/missions/:id/receipt
GET    /v1/operations/summary
GET    /v1/stream
GET    /v1/atlas/summary
GET    /v1/twins/:id/threads
GET    /v1/twins/:id/snapshots?cursor=&limit=
GET    /v1/twins/:id/snapshots/:snapshotId
GET    /v1/twins/:id/contrast
GET    /v1/twins/:id/health-breakdown
GET    /v1/recoveries/:id/options
GET    /v1/missions/:id/receipt/manifest
GET    /v1/agent-runs/:id/explain
```

`POST /v1/checkout/orders` must only accept a backend-owned quote/plan reference plus idempotency key and approval context. **No client-controlled charge amount, PayPal secret or merchant refund credential is trusted.** Status polling relies on a backend-verified PayPal record.

Example typed intent model to expect (the backend owns the definitive schema):

```ts
type Intent = {
  id: string;
  rawText: string;
  buyerType: 'ORG' | 'BUSINESS';
  quantity: number;
  productRequirements: {
    productKind: string;
    requiredAttributes: string[];
    prohibitedAttributes: string[];
  };
  maxTotalMinor: number; // integer minor units; 100 USD => 10000
  currency: 'USD';
  deliverBy: string; // ISO-8601 with timezone interpretation stored by backend
  timezone: string;
  hardConstraints: string[];
  softPreferences: string[];
  assumptions: string[];
  confirmedAt: string | null;
};
```

All price formatting must use `Intl.NumberFormat` and proper minor-unit conversion from backend-provided currency rules; do not use float arithmetic for financial decisions. Dates shown in buyer's timezone with unambiguous deadline and source timestamp.

Error shape: `{ error: { code, message, details?, correlationId } }`; show friendly message, a stable reference code, and retry if safe. Do not leak raw internal errors or PayPal access tokens.

---

## 7. Authentication, authorization and privacy

- Backend-managed secure session (HTTP-only `Secure`, `SameSite` cookies or appropriately configured BFF session) and CSRF protection for state-changing browser requests. No sensitive tokens in localStorage.
- Role- and tenant-aware navigation is only UX; backend must enforce all authorization.
- Follow least privilege. Sponsor only sees a beneficiary organization's information needed to authorize purchase; recipient's personal address remains masked where possible.
- Strict content security policy with PayPal SDK domains allowed according to current official integration requirements. Never disable CSP globally to make checkout run.
- Protect untrusted merchant text and AI output with safe rendering; no `dangerouslySetInnerHTML` from supplier copy.
- Mask PayPal payer details, payment IDs where not authorized, shipping PII in screenshots/recordings, exports and public receipts.
- A privacy-safe, non-authenticated fictional demo can be browsed without PayPal credentials. Demo mode must show an unmistakable banner and cannot trigger real charge/refund routes.

---

## 8. Two guaranteed demonstration scenarios

### Scenario A: NeedMesh / community shelter

```yaml
id: DEMO-SHELTER-001
request: "Our shelter needs 30 fragrance-free hygiene kits by Friday, 6 PM, under $175."
currency: USD
maxTotalMinor: 17500
initialPlan:
  - merchant: Sandbox Merchant A
    units: 20
    unitPriceMinor: 500
  - merchant: Demo Merchant B  # illustrative only unless separately PayPal-connected
    units: 10
    unitPriceMinor: 600
initialTotalMinor: 16000
failure: "Merchant A loses stock before fulfillment"
expected: "Re-plan with preserved budget, no repeated charge, approvals before new orders"
```

Only the connected Sandbox Merchant A path must execute an actual PayPal transaction. Clearly mark other merchant offers as fictional until credentials exist. Show accurately which quantity is paid, received or merely proposed.

### Scenario B: PromiseTwin / bakery (headline demo)

```yaml
id: DEMO-BAKERY-001
request: "100 food-safe paper packaging boxes, NOT plastic, under $100, by Friday."
acceptedMerchantTerms:
  material: PAPER
  quantity: 100
  deliveryCommitment: "Friday at 17:00 in America/New_York"
originalAmountMinor: 8500
failure: "Merchant reports Monday delivery after the committed Friday date"
expected:
  - classify obligation breach, with attached merchant acceptance and event timing
  - inspect captured-payment status from PayPal
  - propose remedy; do not assert automatic eligibility for refund
  - require merchant-authorized refund before invoking PayPal Refund API
  - require separate buyer approval before replacement order for $89
```

For a real demo, use a clock-controlled sandbox scenario: show a configured simulated deadline and merchant event progression. Never change the machine's actual wall clock or falsify PayPal timestamps; label synthetic fulfillment events and use distinct simulated event timestamps.

---

## 9. PayPal checkout implementation requirements

1. Frontend obtains a server-computed, immutable quote and payable amount for exactly one connected merchant checkout. For standard SDK v6 checkout use `window.paypal.createInstance({ clientId, components: ["paypal-payments"] })` and the documented payment session API; do not cargo-cult v5 `paypal.Buttons()` snippets. Client tokens are for SDK scenarios that require them (e.g. Fastlane), not an unconditional v6 prerequisite.
2. On buyer action, backend creates a PayPal Sandbox order; SDK v6 `createOrder()` resolves `{ orderId }`.
3. Buyer approves in PayPal UI; backend captures via its authenticated merchant context, enforcing approved amount and one-time capture semantics.
4. Frontend waits for backend-verified outcome (API status/webhook reconciliation). `onApprove` is not itself payment completion.
5. Backend links PayPal order ID, capture ID, payer-visible receipt and PromiseTwin. Frontend renders correct provenance.
6. On uncertainty (timeout), poll and reconcile by original order ID; never simply create a second order for the same checkout attempt.
7. Reject checkout for unconnected merchants, expired quote, incorrect currency, material line changes or missing approval.
8. Do not expose buyer secret, merchant secret, bearer token, or arbitrary `capture_id` refund endpoint from the browser.

Official source: https://developer.paypal.com/sdk/js/set-up and https://developer.paypal.com/checkout/integrate.

---

## 10. Testing and frontend definition of done

### Unit / component tests
- Constraint editor rejects negative quantities, unknown materials, invalid deadlines and over-budget requests.
- Hard-constraint conflict states are unmistakable; soft preferences do not override hard constraints.
- Correct minor currency formatting; realistic timezone conversions.
- PromiseTwin evidence timeline displays source and uncertainty correctly.
- Recovery approval UI prevents unapproved replacement and merchant-unauthorized refund.
- Checkout distinguishes `APPROVED` from `CAPTURED`, handles errors, lost popup, stale callbacks and duplicate clicks.
- Keyboard navigation and aria accessibility checks for mission creation and incident modals.

### End-to-end Playwright tests
1. Create mission → compile → edit → confirm → plan → review → demo checkout/status → mission receipt.
2. Create bakery purchase → connect accepted seller terms → PayPal sandbox checkout (when credentials present) → late fulfillment → evidence inspection → propose recovery → separate buyer/merchant approvals → reconciled result.
3. Role access: sponsor cannot see another organization's private delivery data; buyer cannot issue merchant refund.
4. PayPal unavailable: truthful pending state, safe retry with existing intent, no phantom success.
5. Small/mobile viewport and reduced-motion behavior.
6. Visual smoke screenshots of landing, dashboard, intent review, PayPal checkout, twin detail and recovery center.

### Mandatory checks
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm e2e` (or equivalent documented commands) must pass. Run `pnpm perf:audit` and record the route-by-route performance results; mark measurements unavailable rather than inventing scores.
- Visual regression tests for desktop/phone views and forced `prefers-reduced-motion` must pass. Verify static screenshot rendering before any JS animation starts.
- Screenshot the landing hero, Intent Fold, Promise Threads, Faultline, Recovery Workbench, Timefold, Proof Passport and Mobile mode at 390px.
- Add accessible error and loading states on every API-bound page.
- No `TODO` or inert action buttons in the primary happy path.
- No placeholder “Connected to PayPal” badges without a successful health check.
- Provide screenshots and example test run commands in this README after implementation.

---

## 11. Deployment and local development

The backend exposes `/v1` and an authenticated OpenAPI spec. Frontend environment example:

```dotenv
NEXT_PUBLIC_APP_NAME=NeedMesh
NEXT_PUBLIC_API_BASE_URL=http://localhost:4000
NEXT_PUBLIC_PAYPAL_ENVIRONMENT=sandbox
NEXT_PUBLIC_PAYPAL_CLIENT_ID=YOUR_SANDBOX_MERCHANT_CLIENT_ID
NEXT_PUBLIC_DEMO_MODE=true
NEXT_PUBLIC_SENTRY_DSN=
```

Only `NEXT_PUBLIC_*` safe values may enter the browser. Client ID is public; PayPal client secret is **server-only**. Config must be validated at startup and checkout disabled with a helpful explanation if keys are not set.

Recommended deployment: Render Static/Web Service or other provider with HTTPS and secure secret management; frontend + backend use an explicit trusted origin, cookie policy and CORS allowlist. Supply production origin config, health checks and deployment runbook. Browser demo must work without private accounts, with actual Sandbox mode enabled after credentials are added.

---

## 12. Execute in Cursor — required implementation sequence

> Paste this prompt into Cursor Agent while both READMEs are in the repository. Do not stop after generating only UI mockups.

```text
You are the lead frontend engineer and interaction designer for NeedMesh + PromiseTwin AI. Treat frontend/README.md and backend/README.md as binding specifications. The design is THE OUTCOME ATELIER: editorial whitespace and oversized typography, original folded-paper/parcel visual metaphor, quiet fine rules, ink-on-paper surfaces, distinctive evidence threads and precise typography. Use uploaded Synex screenshot for high-level restraint only, NOT for copied assets/layout. Make it look handcrafted, not like a generic AI fintech template. Implement Anime.js v4 only for purposeful route-lazy signature sequences; no Framer Motion, no infinite decorative motion; honor reduced motion and web-vitals budgets. Implement the complete Next.js frontend, not a design proposal. First inspect the existing workspace and align with backend OpenAPI contracts. Build a polished, mobile-responsive experience for organizations, sponsors, merchants and business buyers. The primary flows are mission planning, merchant offer evaluation, PayPal Sandbox checkout using the CURRENT v6 SDK, PromiseTwin intent/merchant/payment/evidence timeline, incident diagnosis, approval-gated recovery, and a provenance-aware Mission Receipt. Use strict TypeScript, Zod, TanStack Query, accessible components, AG Grid for operations, role-scoped auth, SSE events, and safe demo adapters when credentials are missing. All writes must use the real backend and server-owned payment amounts. Create tests, run lint/typecheck/build/e2e, fix failures, document exact commands, and clearly distinguish real PayPal state from simulated merchant data. Do not auto-charge/refund or create misleading success screens.
```

### Work order
1. Inspect repo, create workspace/config/layout, auth shell and shared types.
2. Implement public landing and complete intent/mission/purchase flows with fixture-backed API adapter.
3. Replace fixture adapter with generated API client; keep explicit demo toggle.
4. Integrate backend-created PayPal Sandbox order with actual JavaScript SDK v6.
5. Build PromiseTwin, evidence, incident and approval flows with Promise Fold, Promise Threads, Faultline, Recovery Workbench, Timefold and Proof Passport using the truthful provenance/contrast APIs.
6. Build merchant center, receipts, AG Grid reporting and event streaming.
7. Implement tests, mobile/accessibility fixes, visual-regression screenshots, performance-budget checks and deployment docs.
8. Demonstrate full bakery and shelter E2E flows; enumerate only genuine blockers requiring credentials or external approvals.

**Frontend acceptance gate:** A judge should be able to create a request, understand the AI's decisions, approve a real Sandbox purchase, witness a simulated failure, inspect PayPal-backed reconciliation, approve a lawful recovery path, and download an accurately labeled Mission Receipt—without viewing source code. It must visually read as a carefully art-directed product with its own recognizable Promise Fold, Threads, Faultline and Proof Passport; not a recycled fintech landing template. The experience remains beautiful and usable with animations disabled.

---

## 13. Authoritative links

- PayPal AI Toolkit for Cursor: https://github.com/paypal/AI-Toolkit
- PayPal Agent Toolkit: https://github.com/paypal/agent-toolkit
- PayPal MCP server: https://developer.paypal.com/ai-tools/mcp-server
- PayPal JavaScript SDK v6: https://developer.paypal.com/sdk/js/set-up
- PayPal Checkout: https://developer.paypal.com/checkout/integrate
- PayPal Refund API: https://developer.paypal.com/api/payments/v2/captures-refund
- AG Grid: https://www.ag-grid.com/
- Anime.js v4 using React and scope cleanup: https://animejs.com/documentation/getting-started/using-with-react
- Anime.js timeline API: https://animejs.com/documentation/timeline
- Anime.js WAAPI animations: https://animejs.com/documentation/animation

**Build-time note (November 2026):** Always consult current official SDK documentation for exact method signatures. The specification is deliberately strict about financial behavior but does not claim unverified developer permissions or privileged PayPal partner capabilities.
