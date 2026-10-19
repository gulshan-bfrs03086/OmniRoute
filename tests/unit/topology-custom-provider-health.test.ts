import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Custom/compatible providers (provider_nodes, e.g. openai-compatible-chat-<uuid>) are not
// in AI_PROVIDERS, so the registry-driven providerStats never produced a health entry for
// them and their topology nodes always rendered idle even with healthy connections.

const homePageClientSrc = readFileSync(
  fileURLToPath(new URL("../../src/app/(dashboard)/dashboard/HomePageClient.tsx", import.meta.url)),
  "utf8"
);

test("topology derives health for providers outside AI_PROVIDERS from their connections", () => {
  assert.match(homePageClientSrc, /customHealthCounts/, "must aggregate custom provider health");
  assert.match(
    homePageClientSrc,
    /if \(!canonical \|\| healthByProvider\.has\(canonical\)\) continue;/,
    "built-in providers keep their registry-derived health"
  );
  assert.match(homePageClientSrc, /isProviderConnectionConnected\(conn\)/);
  assert.match(homePageClientSrc, /isProviderConnectionErrored\(conn\)/);
  assert.match(
    homePageClientSrc,
    /counts\.connected > 0 \? "active" : counts\.errors > 0 \? "error" : "idle"/
  );
});
