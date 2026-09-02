# Second Mayor — pitch, name, demo script

Copy from here into Devpost / the video. Product name is locked.

---

## Name

**Second Mayor**

Subtitle: **Co-op IsoCity via WebMCP**

Devpost title: **Second Mayor — play IsoCity with an AI co-mayor**

Do not submit as “IsoCity WebMCP wrapper.”

---

## One-liner

You play a canvas city. An AI co-mayor shares the same map, ghosts a plan, and waits for you. Nothing builds until you say so.

---

## Devpost text (paste)

### Why this use case fits WebMCP

IsoCity renders the city on HTML5 Canvas. There are no tile buttons, no DOM grid. A scraping or click-driving agent cannot see or play the game. WebMCP is not a nicer API here — it is the only way a person and an agent share that live map.

### How it improves the experience

Without WebMCP the agent is blind. With it, the agent reads live stats, points at neighborhoods, and paints a **ghost plan** on the isometric tiles you are already looking at. You stay on the mouse. Approve, Reject, or Undo. Two operators, one canvas.

### What people and agents can do together that was hard or impossible

Impossible before: play this city with an assistant at all.

Now: you set the goal (“housing, keep budget green”). The agent inspects, highlights, ghosts one plan. You confirm or refuse. In **co-builder**, the agent may `confirm_plan` after you have seen the ghost; you can still undo **only the agent’s** last plan. That is co-op, not autopilot.

### How it is implemented (short)

Client-only. Inside `GameProvider`, tools register with `document.modelContext.registerTool`. Reads use `latestStateRef` (the live sim, not the throttled React UI). Writes never mutate immediately: they create a pending plan, yellow overlay, and a confirm bar. `confirm_plan` is allowed only in co-builder. Mutations apply to the live ref so the 200ms sim tick cannot clobber Approve. Headers: `Origin-Agent-Cluster: ?1`, `Permissions-Policy: tools=(self)`. Polyfill + in-page inspector for browsers without native WebMCP. No Supabase for the agent.

---

## Talk track (15 seconds)

IsoCity is canvas. An agent can’t click it. We registered WebMCP tools on the page so the agent looks at the same city you do, ghosts a park in yellow, and waits. You stay mayor.

---

## 3-minute demo script

Record in **ChatGPT’s in-app browser** if you can (how judges may test). Chrome + flag is backup. Audio on. No music.

| Time | On screen | You say |
|---|---|---|
| 0:00–0:20 | Landing → **Play with Second Mayor** (`/?play=example`). HUD: Advisor. | “This is IsoCity. The map is canvas — nothing to scrape. Second Mayor is a WebMCP co-op partner on this same tab.” |
| 0:20–0:50 | Agent: `get_city_state`, `get_problems`. Yellow problem marks optional. | “Housing demand is maxed. Budget is still green. Don’t autoplay — show me a small plan.” |
| 0:50–1:20 | Ghost **one park** on empty grass (e.g. by City Hall). Yellow tile + **Second Mayor needs you**. | “Yellow is a proposal. Nothing is spent yet.” |
| 1:20–1:50 | You click **Approve**. Park sprite appears. Log: proposed → built. | “I approved. That’s a real park, not a highlight.” |
| 1:50–2:25 | Switch **Co-builder**. Agent ghosts another park/tree, then `confirm_plan`. | “Co-builder: I still see the ghost. The agent may commit. I can still undo.” |
| 2:25–2:50 | You click **Undo**. Tile reverts. | “Undo is agent-only. My buildings stay.” |
| 2:50–3:00 | HUD + map. | “Human stays mayor. Agent is the second hand. WebMCP is the only way this game can be co-op with AI.” |

**Do not** ghost a huge downtown zone. It looks like nothing after Approve.

**Do** `propose_service` with `park` or `tree` on `building === grass`.

---

## Shot list (if you cut later)

1. Canvas close-up (cars, no DOM).
2. HUD Advisor.
3. Yellow ghost + Approve bar.
4. Park appears.
5. Co-builder confirm.
6. Undo.
7. One line of `registerTool` in the repo.

---

## Repo blurb (GitHub description)

`Second Mayor: co-op IsoCity with a WebMCP agent. Ghost plans on the canvas; you approve.`

Topics: `webmcp` `nextjs` `canvas` `game` `hackathon`
