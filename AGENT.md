# TypeScript Migration Plan for Cloudflare Workers

## Goals
- Rebuild the FastAPI backend in TypeScript for Cloudflare Workers, keeping the existing council behavior.
- Deliver reliable edge runtime support (Hono/Workers API), durable storage, and working streaming.
- Keep the React frontend with minimal changes beyond API URL/config adjustments.

## Architecture Decisions
- Runtime: Cloudflare Workers + Hono; deploy via `wrangler`.
- Storage: Durable Objects for per-conversation state plus a list/index DO; optionally add D1 for analytics later.
- HTTP client: Workers `fetch`; keep OpenRouter integration with secret-bound API key.
- Streaming: Implement SSE-compatible streaming using Workers streaming response; provide a polling fallback if needed.
- Types: Shared TypeScript types for conversation, messages, stage results between frontend and backend.

## Work Plan
1) **Scaffold & Types**
   - Initialize a Workers/Hono project; set up lint/build.
   - Define shared types (`Conversation`, `Message`, `Stage1/2/3` payloads, SSE events).
2) **Storage Layer**
   - Implement Durable Object for conversation (messages, title, metadata) and a list/index DO for listings.
   - Add storage interface to enable local dev mock/in-memory.
3) **API Endpoints**
   - Recreate REST endpoints: health, list conversations, create, get, send message, stream message.
   - Wire storage + council orchestration; ensure request validation.
4) **Council Orchestration**
   - Port Stage1/2/3 logic to TypeScript using Workers `fetch` to OpenRouter.
   - Preserve ranking parsing and chairman synthesis; handle timeouts/retries.
5) **Streaming**
   - Implement streaming endpoint with Workers streaming (SSE-friendly) events mirroring current event types.
   - Add non-streaming fallback endpoint.
6) **Frontend Updates**
   - Add env-based API base URL (dev/prod); update fetch layer to shared types.
   - Adjust CORS headers on backend to match Pages domain.
7) **Secrets & Config**
   - Move `OPENROUTER_API_KEY` to Wrangler secrets; document setup.
   - Set wrangler bindings for Durable Objects; add migrations.
8) **Testing & Validation**
   - Unit test ranking parser and DO handlers; integration test council flow with mocked OpenRouter.
   - Manual end-to-end check: CRUD, streaming, concurrent requests, persistence.
9) **Deploy**
   - Configure `wrangler.toml` for prod and preview; deploy backend Worker and frontend Pages build.
   - Smoke test on preview; promote to prod.

## Risks / Mitigations
- OpenRouter rate/latency: add timeouts/retries and good error surfaces.
- Streaming quirks: keep polling fallback; monitor with preview.
- DO consistency: carefully version migrations; avoid breaking schema changes.

