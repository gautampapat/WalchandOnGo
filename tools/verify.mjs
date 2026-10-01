/**
 * All-pairs verification of the routing engine against the real campus graph.
 *
 * Run:  node tools/verify.mjs
 *
 * Checks the properties the project claims, rather than asserting them:
 *   - every pair of places is actually reachable
 *   - A* and Dijkstra agree on cost for every pair (A* stays optimal)
 *   - the haversine heuristic never overestimates true walking distance
 *   - A* expands no more nodes than Dijkstra
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { CampusGraph } from "../web/js/graph.js";
import { astar, dijkstra, bfs, dfs } from "../web/js/search.js";

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, "..", "web", "data");
const read = (name) => JSON.parse(readFileSync(join(dataDir, name), "utf-8"));

const raw = read("graph.json");
const pois = read("pois.json");
const graph = new CampusGraph(raw.nodes, raw.edges, pois);

const ids = [...graph.nodes.keys()];
console.log(`graph: ${ids.length} nodes, ${graph.edges.length} edges, ${pois.length} places\n`);

let pairs = 0;
let unreachable = 0;
let costMismatch = 0;
let expandedWorse = 0;
let admissibilityViolations = 0;
let worstOvershoot = 0;

let astarExpanded = 0;
let dijkstraExpanded = 0;
let astarWins = 0;

const EPS = 0.5; // metres — float tolerance, well under any real path difference

for (const start of ids) {
  // True shortest cost from `start` to everywhere, for the admissibility check.
  const truth = new Map();
  for (const goal of ids) {
    if (goal === start) continue;
    pairs++;

    const a = astar(graph, start, goal);
    const d = dijkstra(graph, start, goal);

    if (!a.path || !d.path) {
      unreachable++;
      continue;
    }
    truth.set(goal, d.cost);

    if (Math.abs(a.cost - d.cost) > EPS) costMismatch++;
    if (a.expanded.length > d.expanded.length) expandedWorse++;
    if (a.expanded.length < d.expanded.length) astarWins++;

    astarExpanded += a.expanded.length;
    dijkstraExpanded += d.expanded.length;

    // Admissible means h never exceeds the real cost of getting there.
    const h = graph.distance(start, goal);
    if (h > d.cost + EPS) {
      admissibilityViolations++;
      worstOvershoot = Math.max(worstOvershoot, h - d.cost);
    }
  }
}

const pct = (n) => ((n / pairs) * 100).toFixed(2);
const line = (ok, text) => console.log(`  ${ok ? "PASS" : "FAIL"}  ${text}`);

console.log(`tested ${pairs.toLocaleString()} node pairs\n`);
line(unreachable === 0, `connectivity: ${unreachable} unreachable pairs`);
line(costMismatch === 0, `optimality: A* matches Dijkstra on ${pct(pairs - costMismatch)}% of pairs (${costMismatch} mismatches)`);
line(admissibilityViolations === 0,
  `admissibility: ${admissibilityViolations} violations` +
  (worstOvershoot ? ` (worst overshoot ${worstOvershoot.toFixed(1)} m)` : ""));
line(expandedWorse === 0, `efficiency: A* expanded more than Dijkstra on ${expandedWorse} pairs`);

const saving = ((1 - astarExpanded / dijkstraExpanded) * 100).toFixed(1);
console.log(`\n  A* explored ${astarExpanded.toLocaleString()} nodes total vs Dijkstra's ${dijkstraExpanded.toLocaleString()}`);
console.log(`  -> ${saving}% fewer, and strictly fewer on ${pct(astarWins)}% of pairs`);

// Spot-check the uninformed algorithms on one long route.
const from = pois.find((p) => /main gate/i.test(p.name)) || pois[0];
const to = pois.find((p) => /class room 21/i.test(p.name)) || pois[pois.length - 1];
console.log(`\nsample route: ${from.name} -> ${to.name}`);
for (const [label, fn] of [["A*", astar], ["Dijkstra", dijkstra], ["BFS", bfs], ["DFS", dfs]]) {
  const r = fn(graph, from.nearest_node, to.nearest_node);
  const cost = r.path ? `${r.cost.toFixed(0)} m` : "no route";
  console.log(`  ${label.padEnd(9)} ${String(r.expanded.length).padStart(3)} explored   ${cost.padStart(8)}   ${r.path ? r.path.length : 0} nodes`);
}

const failed = unreachable || costMismatch || admissibilityViolations || expandedWorse;
process.exit(failed ? 1 : 0);