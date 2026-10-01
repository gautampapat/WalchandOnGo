/**
 * The four search algorithms. The app routes with A* only; the other three are
 * baselines that tools/verify.mjs benchmarks it against.
 *
 * Every one returns:
 *   { path, cost, expanded, timeMs, optimal }
 *
 * `expanded` is the order in which nodes were settled — the number the
 * benchmark compares.
 */

/** Binary min-heap. A sorted array would make Dijkstra O(n^2) on every push. */
class MinHeap {
  constructor() {
    this.items = [];
  }

  get size() {
    return this.items.length;
  }

  push(value, priority) {
    this.items.push({ value, priority });
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.items[parent].priority <= this.items[i].priority) break;
      [this.items[parent], this.items[i]] = [this.items[i], this.items[parent]];
      i = parent;
    }
  }

  pop() {
    const top = this.items[0];
    const last = this.items.pop();
    if (this.items.length) {
      this.items[0] = last;
      let i = 0;
      for (;;) {
        const left = 2 * i + 1;
        const right = left + 1;
        let smallest = i;
        if (left < this.items.length && this.items[left].priority < this.items[smallest].priority) smallest = left;
        if (right < this.items.length && this.items[right].priority < this.items[smallest].priority) smallest = right;
        if (smallest === i) break;
        [this.items[smallest], this.items[i]] = [this.items[i], this.items[smallest]];
        i = smallest;
      }
    }
    return top.value;
  }
}

function reconstruct(cameFrom, goal) {
  const path = [goal];
  let current = goal;
  while (cameFrom.has(current)) {
    current = cameFrom.get(current);
    path.unshift(current);
  }
  return path;
}

function result(graph, path, expanded, started, optimal) {
  return {
    path,
    cost: path ? graph.pathCost(path) : Infinity,
    expanded,
    timeMs: performance.now() - started,
    optimal,
  };
}

/**
 * Breadth-first search. Explores by number of edges, not by distance, so it
 * returns the route with the fewest turns rather than the shortest one.
 * Included as a baseline to show exactly that difference.
 */
export function bfs(graph, start, goal) {
  const started = performance.now();
  const expanded = [];
  const cameFrom = new Map();
  const seen = new Set([start]);
  const queue = [start];

  while (queue.length) {
    const current = queue.shift();
    expanded.push(current);
    if (current === goal) return result(graph, reconstruct(cameFrom, goal), expanded, started, false);

    for (const { to } of graph.neighbors(current)) {
      if (seen.has(to)) continue;
      seen.add(to);
      cameFrom.set(to, current);
      queue.push(to);
    }
  }
  return result(graph, null, expanded, started, false);
}

/**
 * Depth-first search. Follows one branch as far as it goes before backtracking,
 * so it finds *a* route with no guarantee about its length. Usually the worst
 * route of the four, which is the point of showing it.
 */
export function dfs(graph, start, goal) {
  const started = performance.now();
  const expanded = [];
  const cameFrom = new Map();
  const seen = new Set();
  const stack = [start];

  while (stack.length) {
    const current = stack.pop();
    if (seen.has(current)) continue;
    seen.add(current);
    expanded.push(current);
    if (current === goal) return result(graph, reconstruct(cameFrom, goal), expanded, started, false);

    for (const { to } of graph.neighbors(current)) {
      if (seen.has(to)) continue;
      if (!cameFrom.has(to)) cameFrom.set(to, current);
      stack.push(to);
    }
  }
  return result(graph, null, expanded, started, false);
}

/**
 * Dijkstra. Settles nodes in order of distance from the start, so the first
 * time the goal is settled its cost is provably minimal. Guaranteed shortest,
 * but it expands outward in every direction with no sense of where the goal is.
 */
export function dijkstra(graph, start, goal) {
  const started = performance.now();
  const expanded = [];
  const dist = new Map([[start, 0]]);
  const cameFrom = new Map();
  const settled = new Set();
  const frontier = new MinHeap();
  frontier.push(start, 0);

  while (frontier.size) {
    const current = frontier.pop();
    if (settled.has(current)) continue;
    settled.add(current);
    expanded.push(current);
    if (current === goal) return result(graph, reconstruct(cameFrom, goal), expanded, started, true);

    for (const { to, edge } of graph.neighbors(current)) {
      if (settled.has(to)) continue;
      const alt = dist.get(current) + edge.length_m;
      if (alt < (dist.get(to) ?? Infinity)) {
        dist.set(to, alt);
        cameFrom.set(to, current);
        frontier.push(to, alt);
      }
    }
  }
  return result(graph, null, expanded, started, true);
}

/**
 * A*. Dijkstra plus straight-line distance to the goal as a tie-breaker, which
 * pulls the search toward the destination instead of spreading evenly.
 *
 * Straight-line distance can never exceed the real walking distance along
 * paths, so the heuristic never overestimates — it is admissible, and A* keeps
 * Dijkstra's guarantee of finding the shortest route while expanding fewer
 * nodes to get there.
 */
export function astar(graph, start, goal) {
  const started = performance.now();
  const expanded = [];
  const gScore = new Map([[start, 0]]);
  const cameFrom = new Map();
  const settled = new Set();
  const frontier = new MinHeap();
  frontier.push(start, graph.distance(start, goal));

  while (frontier.size) {
    const current = frontier.pop();
    if (settled.has(current)) continue;
    settled.add(current);
    expanded.push(current);
    if (current === goal) return result(graph, reconstruct(cameFrom, goal), expanded, started, true);

    for (const { to, edge } of graph.neighbors(current)) {
      if (settled.has(to)) continue;
      const alt = gScore.get(current) + edge.length_m;
      if (alt < (gScore.get(to) ?? Infinity)) {
        gScore.set(to, alt);
        cameFrom.set(to, current);
        frontier.push(to, alt + graph.distance(to, goal));
      }
    }
  }
  return result(graph, null, expanded, started, true);
}