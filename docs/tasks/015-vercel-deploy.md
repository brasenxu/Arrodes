---
id: 015
title: Vercel deploy (Hobby tier)
phase: 4
status: todo
depends_on: [010, 012, 014]
estimate: S
updated: 2026-04-21
---

## Context

First production deploy on Vercel Hobby. Neon is already Marketplace-provisioned (ticket 001), so env vars flow automatically. The scaffold already uses `vercel.ts` config. Goal: visit a public URL and use the app.

## Scope

- `vercel link` the project to a new Vercel project named `arrodes`.
- `vercel env pull .env.local` to verify Neon vars are auto-populated in the Vercel project (from ticket 001's Marketplace provisioning).
- Add `AI_GATEWAY_API_KEY` to Vercel project env — **required**: the chat route resolves `CHAT_MODEL` and the embed model through the AI Gateway (see `.env.example` post-2026-10-02).
- Verify the project's Node runtime on Vercel satisfies the `package.json` engines floor (node ≥ 20.19).
- `vercel --prod` for the first production deploy.
- Smoke test: load the deployed URL, set reading position, ask 3 questions.
- Enable Rolling Releases (GA since June 2025) if beneficial — not strictly needed at this scale.

## Out of scope

- Custom domain.
- Auth / rate limiting (defer until public sharing).
- Monitoring beyond Vercel's built-in.

## Deliverables

- Live URL pasted into `## Findings`.
- A deploy log confirming chat route boots (Fluid Compute cold start + warm path).

## Acceptance criteria

- Production URL returns 200 on `/`.
- Chat query on production completes successfully end-to-end.
- No 500s in Vercel runtime logs during a 5-query test.

## Verification

```bash
pnpm dlx vercel link
pnpm dlx vercel env pull .env.local
pnpm dlx vercel --prod
```

## Findings

<!-- Paste the production URL and smoke-test notes. -->
