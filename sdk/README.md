# ANTIDOTE TypeScript SDK

This package wraps the server-side ANTIDOTE REST API. Live deployments require a tenant-scoped bearer key.

```ts
import { AntidoteClient } from "@antidote-ai/sdk";

const antidote = new AntidoteClient({
  baseUrl: process.env.ANTIDOTE_URL,
  apiKey: process.env.ANTIDOTE_API_KEY,
});

const recalled = await antidote.retrieve({
  agentId: "finance-agent",
  query: "approved supplier payment evidence",
});
```

Call `recordDecision` with the exact returned memory IDs. This link gives ANTIDOTE the information needed to compute a later blast radius.

Build the local package with `npm run sdk:build` from the repository root.
