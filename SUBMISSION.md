# Second Mayor — WebMCP Challenge submission

**Live:** <https://isometric-city-webmcp.vercel.app/?play=example>
**Repo:** <https://github.com/GatienBoquet/isometric-city>

---

## What it is

A city builder you play together with an AI agent.

IsoCity draws everything on an HTML5 canvas. There are no DOM tiles, so an agent
that clicks buttons and reads the page sees one `<canvas>` element and nothing
else. It cannot read the city and it cannot act on it.

Second Mayor gives the page 21 WebMCP tools. The agent can now inspect the map,
read the budget, see what is going wrong, and propose construction. What it
cannot do is build behind your back. Every write goes through a plan you see as
yellow ghost tiles before anything is charged or placed.

## What was added during the submission period

The base game is [amilich/isometric-city](https://github.com/amilich/isometric-city)
(MIT), which existed before this hackathon. Its rendering, simulation and economy
are upstream and unchanged.

Everything agent-facing is new work for this challenge:

| Added | Where |
| --- | --- |
| WebMCP tool registration (21 tools) | `src/hooks/useWebMCPTools.ts` |
| Plan lifecycle: propose, ghost, confirm, reject, undo | `src/context/AgentContext.tsx` |
| Agent types, role model, plan caps | `src/lib/agent/types.ts` |
| Second Mayor HUD, mode toggle, action log | `src/components/` |
| Ghost preview rendering on the canvas | `src/components/` |
| `Origin-Agent-Cluster` and `Permissions-Policy` headers | `next.config.js` |

First agent-layer commit: `[[DATE]]`. All WebMCP work is in the history from
that point forward.

## How WebMCP is used

Tools are registered with `document.modelContext.registerTool`.

| | Tools |
| --- | --- |
| Read | `get_city_state` `get_tool_catalog` `inspect_region` `get_problems` `get_pending_plan` `get_agent_status` |
| Point | `highlight_tiles` `clear_highlights` `focus_tile` `add_agent_note` |
| Role | `request_role` |
| Propose | `propose_zone_region` `propose_road_path` `propose_placements` `propose_service` `propose_bulldoze` `propose_tax_rate` `propose_budget` |
| Commit | `confirm_plan` `reject_plan` `undo_agent_actions` |

Four decisions worth calling out:

**Reads go through a live ref, not React state.** The simulation advances on
every tick. Tools read the city as it is at the moment of the call, not as React
last rendered it.

**Confirmation is idempotent.** WebMCP can deliver the same call twice.
`confirm_plan` keeps applied plans in a cache and returns `alreadyApplied`
instead of building the same thing again.

**The plan cap is published, not hidden.** `get_tool_catalog` and
`get_agent_status` both report `maxPlanTiles: 200`. Past that,
`propose_placements` answers with `truncated` and `droppedForCap`, so the agent
knows exactly what got dropped rather than guessing why its plan came back
smaller.

**Undo compares the grid.** Applying a plan diffs the map before and after, so
undo restores what actually changed. A tile is only reverted if it still looks
the way the agent left it. If you built a school on top of the agent's road,
undo leaves your school alone. Retrying an undo is safe and returns
`alreadyUndone`.

## Roles

| Mode | Agent can | You |
| --- | --- | --- |
| **Advisor** (default) | Inspect, highlight, ghost a plan | You click **Approve** |
| **Co-builder** | Same, plus `confirm_plan` after the ghost | You still see the ghost and can still **Undo** |

The mode is set by the human in the HUD. `request_role` only raises a request;
an agent cannot promote itself and then approve its own plans.

Inside a co-op room the agent stays advisory and declines to commit, because
agent builds do not sync to the other player.

## Testing instructions

No login needed.

**Browser.** Open the URL in ChatGPT's in-app browser, or in Chrome with
`chrome://flags/#enable-webmcp-testing` set to Enabled and the browser
relaunched. WebMCP tools will not appear in a normal Chrome tab. This build also
ships a same-tab polyfill and an **Agent tools** inspector if you want to call
tools by hand.

**Steps.**

1. Open <https://isometric-city-webmcp.vercel.app/?play=example>, or click
   **Play with Second Mayor** on the landing page.
2. Pick a mode in the HUD: Advisor or Co-builder.
3. Point your agent at the page and ask it something.

**Try these.**

- Advisor: *"Look at my city and tell me what is wrong with it."*
- Co-builder: *"Housing demand is high. Keep the budget green. Ghost one small
  plan on empty grass and wait for me."*

The agent ghosts its plan in yellow. Click **Approve** to build it, **Reject**
to drop it, or **Undo** afterwards.

**Demo note.** Ghost real buildings (park, tree) on empty grass. Zoning a
downtown block looks yellow but often commits nothing visible, because roads
stay roads until the simulation grows shops.

## License

MIT. IsoCity © amilich. Second Mayor / WebMCP layer © the authors of this fork.
See [`LICENSE`](./LICENSE).
