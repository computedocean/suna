---
recorded: 2026-11-28T12:16:21Z
incident_date: 2026-11-28
---
# Let an Any-error fallback chain take over a routed model whose provider has no key connected

**Rule:** Every resolution failure that the Routing screen calls "a model or
provider error" must have an entry in `CHAIN_TAKES_OVER`
(`packages/llm-gateway/src/pipeline/chat-shared.ts`), with the HTTP status the
same failure has from a provider. `fallbackTakesOver` then decides by the
chain's "Fallback condition". A code missing from the map ends the request at
resolution, before any chain runs, whatever the fallback condition says.

**Trigger surface:** Adding a `NoUpstreamReasonCode`, throwing a new
`GatewayResolutionError` code from `apps/api/src/llm-gateway/resolution/`,
changing `CHAIN_TAKES_OVER` or `startChainWithout`
(`packages/llm-gateway/src/pipeline/routing.ts`), or writing Routing screen or
docs copy for "Fallback condition".

**Incident:** 2026-11-28, production. A workspace removed its only key for one
provider. Its Routing chain named a ChatGPT-plan model with the fallback condition
"Any error". `kortix gateway routing preview` showed the routed model unavailable and
the fallback available. Every session request and every subagent of that
workspace still failed with `400 provider_not_connected` for two days, because
`provider_not_connected` was not in `CHAIN_TAKES_OVER`. Blast radius: every
project with an Any-error chain whose routed model's provider has no key. No
data loss.

**Enforcement:** `packages/llm-gateway/src/pipeline/simple-handler.test.ts`
("an own-key model with no key connected moves to the project chain on any
error", and the "not connected" rows of "a ChatGPT model with every account
%s": Any error serves from the chain, "Service errors" keeps the `400`).
