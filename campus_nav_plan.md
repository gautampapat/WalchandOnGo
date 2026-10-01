# Campus Navigation — Project Plan

**Team:** G2, G6, G19
**Guide:** Ms. A. B. Patil
**Date:** 12 Aug 2026
**Status:** Proposed — for team discussion
**Supersedes the open decisions in:** `campus_nav_brainstorm.md`

---

## 1. The Decision

**Build outdoor campus navigation at Walchand, using classical AI search, and make the evaluation rigorous.**

**Title:** *Campus Navigation Using Graph Algorithms and Heuristic AI Search*

The brainstorm doc ended with six open questions. This closes them:

| Question | Decision |
|---|---|
| Campus or city scale? | **Campus.** Keep Walchand. |
| Add an ML component? | **No.** Reasoning below. |
| Indoor navigation? | **Out of scope.** Building entrances are terminal nodes. |
| Deliverable? | **Website**, client-side, no backend. |
| Traffic data source? | N/A — city scale rejected. |
| Timeline? | ~14 weeks, phased so a working system exists by week 4. |

---

## 2. Why No ML

The brainstorm doc evaluated ~22 ML ideas and found that almost every one either solves a problem that doesn't exist or can be replaced by simple rules. That conclusion was correct. The response to it is **not** to bolt on a model anyway.

**Informed heuristic search is core AI.** A\*, admissible heuristics, and consistency are standard AI curriculum material — and they are exactly what the project slide names as the AI concept. We are doing what the slide asks, not working around it.

**Two alternatives were considered and rejected:**

**City-scale ML routing** — the plan was to train a travel-time model on Google Maps Distance Matrix data. Problem: that API already returns traffic-aware times produced by Google's own ML, so we'd be training a model to predict another model's output, and evaluating it against the same API — circular by construction. It also can't be demonstrated in a viva (nobody can verify a city route by inspection), it needs weeks of data collection before training can begin, and it discards our one unique asset: an actual mapped campus. *Note: the Uber Movement dataset referenced in the brainstorm doc appears to have been discontinued — verify before relying on it.*

**Indoor positioning via ML** — genuinely the strongest ML option, and genuinely interesting, but it roughly doubles project scope. Deferred, not dismissed; §8 explains how it could be added later without disturbing anything built here.

**If the guide asks about ML content, the argument is:**
1. Informed search with admissible heuristics is core AI, and is what the project slide specifies.
2. We *empirically verify* the theoretical properties — admissibility, consistency, optimality — rather than assuming them.
3. Adding a learned model here would be dishonest engineering. `campus_nav_brainstorm.md` contains the full analysis of why. **Bring that document to the review** — the reasoning is a deliverable in its own right.

---

## 3. What We're Building

A website with an interactive campus map. Pick origin and destination, choose a route preference (shortest / step-free / covered), see the route drawn with turn-by-turn distances and a walking ETA. An algorithm selector visualises **which nodes each algorithm expanded** — the clearest way to show the difference between BFS, DFS, Dijkstra and A\* to someone watching a demo.

A separate benchmark harness runs all four algorithms across every node pair and produces the data for the report.

### Stack

| Choice | Reason |
|---|---|
| Leaflet + OpenStreetMap tiles | Map rendering, no API key, no billing |
| Vanilla JS, ES modules | The algorithms are the deliverable; a framework adds noise |
| Algorithms written once in JS | Imported by both website and benchmark — no duplicate implementations to drift apart |
| Python for offline tooling only | GPX parsing, chart generation |
| No backend | Static graph JSON, runs entirely in browser, deploys free to GitHub Pages |

### Repo structure

```
/data
  campus.gpx            # from teammate — BLOCKING, see Phase 0
  graph.json            # generated, committed
/tools
  gpx_to_graph.py       # GPX -> graph.json
  make_charts.py        # bench CSV -> report figures
/src
  graph.js              # graph loading, adjacency list, cost functions
  search.js             # bfs, dfs, dijkstra, astar — all instrumented
  heuristics.js         # haversine, admissibility/consistency checks
  map.js                # Leaflet rendering, route drawing
  app.js                # UI wiring
/bench
  run.js                # all-pairs benchmark -> results.csv
  validate.js           # graph integrity + heuristic property checks
index.html
```

---

## 4. Graph Data Model

Worth getting right early — the edge attributes are what make multi-criteria routing possible without changing any algorithm code.

```js
node: { id, name, type: 'building'|'junction'|'entrance'|'landmark',
        lat, lon, aliases: [] }

edge: { from, to, distance_m,
        surface: 'paved'|'unpaved',
        covered: bool,      // sheltered from rain
        step_free: bool,    // ramp rather than stairs
        lit: bool }
```

Route preferences are **cost functions** over these attributes, not separate algorithms:
`cost(edge) = distance_m × penalty(preference)`

**Worth stating in the report:** haversine remains admissible under every one of these cost functions, because each penalty only ever *increases* edge cost above true ground distance — so the heuristic can never overestimate. That's a real piece of reasoning about our own design, not textbook recital.

---

## 5. Build Phases

**Phase 0 — Unblock.** Get `campus.gpx` from the teammate who made it. **Open it in a text editor and read it** before writing any code — it's plain XML, just lists of coordinates, and ten minutes reading it makes everything else concrete. Meanwhile, hand-author a 10-node sample GPX so Phase 1 isn't blocked waiting.

**Phase 1 — Graph.** `gpx_to_graph.py` parses waypoints and tracks into nodes and edges, computes haversine distances. Then run `validate.js`: exactly one connected component, no orphan nodes, no duplicate or zero-length edges, computed distances within tolerance of GPX track lengths. Fix the graph until it passes.

**Phase 2 — Algorithms.** BFS, DFS, Dijkstra, A\* in `search.js`. Every one returns `{path, cost, nodesExpanded, maxFrontier, timeMs}`. **The instrumentation is not optional** — it is the entire basis of the evaluation.

**Phase 3 — Property checks.** Using Dijkstra all-pairs results as ground truth, verify empirically that haversine never overestimates true path cost, and that `h(n) ≤ cost(n,n') + h(n')` holds on every edge. These checks *can fail* if the graph has bad coordinates — that is exactly why we run them.

**Phase 4 — Website.** Leaflet map, origin/destination pickers with alias search, route polyline, distance and walking ETA (`distance ÷ 5 km/h`), algorithm selector with expanded-node visualisation.

**Phase 5 — Multi-criteria routing.** Step-free and covered routing via the cost functions. Step-free deserves real emphasis: it's a genuine accessibility use case, and it makes the project about something rather than being a generic shortest-path demo.

**Phase 6 — Evaluation and report.** Benchmark harness, charts, ground-truth walk validation, write-up.

**A complete working system exists by roughly week 4.** Everything after that is improvement, not rescue.

---

## 6. KPIs

The targets in the original slide could not fail, which is why they proved nothing. `A* ≥ 40% fewer nodes than BFS` compares against a baseline that ignores edge weights and isn't solving the same problem. `p95 < 50 ms for 1,000 nodes` allows roughly 100× more time than Dijkstra actually needs at that size.

Every target below is falsifiable.

| Metric | Target | Why it's honest |
|---|---|---|
| A\* vs **Dijkstra** node expansions | Report full distribution across all pairs | Same problem, fair comparison |
| Path optimality | A\* cost == Dijkstra cost for **100%** of pairs | Genuine correctness check; fails outright if the heuristic is wrong |
| Admissibility | Zero violations across all node pairs | Empirically checked, not asserted |
| Consistency | Zero violations across all edges | Empirically checked, not asserted |
| Graph integrity | 1 connected component, 0 orphans, 0 duplicate edges | Fails loudly on bad GPX data |
| Query latency | Measure and report p95 honestly | No pre-set target that can't be missed |
| **Ground-truth error** | Walk 10 routes, predicted vs measured distance | Real-world validation |

**That last row is worth the afternoon it costs.** Physically walking routes with a phone and comparing predicted against measured distance turns "we computed a path" into "we validated against reality." Very few mini-projects do this.

---

## 7. Group Split

Clean interfaces, so the three tracks can run in parallel after week 2.

| Group | Track |
|---|---|
| **One** | GPX parsing, graph construction, integrity validation, walking campus to tag edge attributes (step-free / covered / lit) |
| **Two** | Search algorithms, instrumentation, property checks, benchmark harness, charts |
| **Three** | Website, Leaflet map, routing UI, expansion visualisation, demo |

Groups One and Two agree on the `graph.json` schema in week 1; after that they work independently.

---

## 8. Open Items

- **`campus.gpx` is not in the repo yet** — Phase 0 blocker, please chase this first
- Confirm with the guide that classical AI search satisfies the AIML requirement (see §2 for the argument)
- Decide how much of campus to map — full campus or a defined subset
- **Extension path:** if a trained model is later required, camera-based indoor zone recognition can be added as a self-contained module. The user photographs a corridor, a CNN classifies which zone of the building they're in, and that becomes the start node for A\*. Nothing in the graph or router would need to change — the model just supplies a start node that GPS can't. Roughly doubles scope; noted here so the option stays open rather than being designed out.

---

## 9. Discussion Points for the Team

1. Is everyone comfortable defending "no ML" to the guide? (§2)
2. Who owns getting the GPX file, and by when?
3. Is step-free / accessibility routing worth the extra survey work? *(Recommendation: yes — it's cheap and it gives the project a purpose beyond the algorithms.)*
4. Full campus or a subset for the first version?
5. Does the group split match how people actually want to work?
