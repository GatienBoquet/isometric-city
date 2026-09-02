# Second Mayor

**Play IsoCity with an AI co-mayor on the same live map.**

🎮 **[Play it now](https://isometric-city-webmcp.vercel.app/?play=example)** — no install, no login.

IsoCity is a canvas city builder. There are no DOM tiles to scrape or click, so a
normal agent cannot play it. This fork adds
[WebMCP](https://webmachinelearning.github.io/webmcp/): the page registers 21
tools, the agent inspects the city you are looking at, **ghosts a plan in
yellow**, and waits. You Approve, Reject, or Undo. It does not autoplay.

> You stay mayor. The agent is the second hand.

Fork of [amilich/isometric-city](https://github.com/amilich/isometric-city) (MIT).
What was added for this project: [`SUBMISSION.md`](./SUBMISSION.md).

## Play it

[#play-it](#play-it)

1. Open **<https://isometric-city-webmcp.vercel.app/?play=example>**, or the
   landing button **Play with Second Mayor**.
2. Pick a mode in the HUD: **Advisor** or **Co-builder**.
3. Point your agent at the page and ask it something.

Your browser needs WebMCP:

- **ChatGPT** in-app browser supports it natively.
- **Chrome**: enable `chrome://flags/#enable-webmcp-testing` and relaunch. This
  build also ships a same-tab polyfill and an **Agent tools** inspector, so you
  can call tools by hand without an agent.

Try asking:

> Housing demand is high. Keep the budget green. Ghost one small plan on empty
> grass and wait for me.

## How co-op works

[#how-co-op-works](#how-co-op-works)

```
see → point → ghost → you confirm → undo agent only
```

| Mode                  | Agent                     | You                                 |
| --------------------- | ------------------------- | ----------------------------------- |
| **Advisor** (default) | Inspect, highlight, ghost | Must click **Approve**              |
| **Co-builder**        | Same + `confirm_plan`     | Still see the ghost; still **Undo** |

The mode is yours alone. `request_role` only raises a request in the HUD. An
agent cannot promote itself to co-builder and then approve its own plans.

Writes (zone, park, tax, budget) always go through a pending plan. The action log
(**Show actions**) lists proposed / built / undone. Undo reverts the **agent's**
last plan, not your builds.

The agent is a local player in **this tab**. It does not join Supabase, so while
a co-op room is open it stays advisory (inspect, highlight, propose) and declines
to commit, rather than building tiles the other player would never receive.

## WebMCP tools

[#webmcp-tools](#webmcp-tools)

21 tools, registered with `document.modelContext.registerTool` in
[`src/hooks/useWebMCPTools.ts`](./src/hooks/useWebMCPTools.ts). Plan lifecycle
lives in [`src/context/AgentContext.tsx`](./src/context/AgentContext.tsx).

|         | Tools                                                                                                                                   |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Read    | `get_city_state` `get_tool_catalog` `inspect_region` `get_problems` `get_pending_plan` `get_agent_status`                               |
| Point   | `highlight_tiles` `clear_highlights` `focus_tile` `add_agent_note`                                                                      |
| Role    | `request_role` — asks; only the human flips the toggle                                                                                  |
| Propose | `propose_zone_region` `propose_road_path` `propose_placements` `propose_service` `propose_bulldoze` `propose_tax_rate` `propose_budget` |
| Commit  | `confirm_plan` `reject_plan` `undo_agent_actions`                                                                                       |

Plans are capped at `maxPlanTiles: 200`. Past that, `propose_placements` answers
with `truncated` and `droppedForCap` so the agent can see what got cut.

Headers: `Origin-Agent-Cluster: ?1`, `Permissions-Policy: tools=(self)`.

Local debug: `window.__agentCity.executeTool('get_city_state', {})`.

## Demo note

[#demo-note](#demo-note)

**Ghost real buildings** (park, tree) on **empty grass**. Zoning a downtown block
looks yellow and often commits nothing visible, because roads stay roads until
the sim grows shops.

## Run it locally

[#run-it-locally](#run-it-locally)

Requires Node.js 18+ and npm.

```
npm install
npm run dev     # dev server on http://localhost:3000
npm run build   # production build (also type-checks)
npm run lint    # ESLint
```

Note: an agent running in ChatGPT's in-app browser cannot reach your
`localhost`. Use the hosted URL above, or a tunnel.

## IsoCity (upstream)

[#isocity-upstream](#isocity-upstream)

The board is IsoCity: Next.js 16, React 19, TypeScript, HTML5 Canvas, Tailwind
and shadcn/ui, with no game engine. Zoning R/C/I, budget, traffic, trains, saves.
The repo also still contains IsoCoaster (`/coaster`), the upstream theme-park
builder; it is unchanged and out of scope for Second Mayor.

Upstream: [iso-city.com](https://iso-city.com) ·
[github.com/amilich/isometric-city](https://github.com/amilich/isometric-city)

## License

[#license](#license)

MIT. IsoCity © amilich. Second Mayor / WebMCP layer © the authors of this fork.
See [`LICENSE`](./LICENSE).
