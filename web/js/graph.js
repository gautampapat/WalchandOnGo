/**
 * Campus graph: nodes, weighted edges, and the named places that hang off them.
 *
 * Edges are undirected (you can walk a path either way) but each one stores
 * geometry in a fixed direction, so the adjacency list records whether a
 * traversal is following that geometry forwards or backwards.
 */

const EARTH_RADIUS_M = 6371000;

export function haversine(lat1, lon1, lat2, lon2) {
  const toRad = Math.PI / 180;
  const p1 = lat1 * toRad;
  const p2 = lat2 * toRad;
  const dp = (lat2 - lat1) * toRad;
  const dl = (lon2 - lon1) * toRad;
  const a =
    Math.sin(dp / 2) ** 2 +
    Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

/** Compass bearing from one point to another, in degrees (0 = north). */
export function bearing(lat1, lon1, lat2, lon2) {
  const toRad = Math.PI / 180;
  const p1 = lat1 * toRad;
  const p2 = lat2 * toRad;
  const dl = (lon2 - lon1) * toRad;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

export class CampusGraph {
  constructor(nodes, edges, pois) {
    this.nodes = new Map(nodes.map((n) => [n.id, n]));
    this.edges = edges;
    this.pois = pois;

    this.adjacency = new Map();
    for (const id of this.nodes.keys()) this.adjacency.set(id, []);

    for (const edge of edges) {
      if (!this.nodes.has(edge.from) || !this.nodes.has(edge.to)) continue;
      this.adjacency.get(edge.from).push({ to: edge.to, edge, forward: true });
      this.adjacency.get(edge.to).push({ to: edge.from, edge, forward: false });
    }
  }

  static async load(base = "data") {
    const [graph, pois] = await Promise.all([
      fetch(`${base}/graph.json`).then((r) => r.json()),
      fetch(`${base}/pois.json`).then((r) => r.json()),
    ]);
    return new CampusGraph(graph.nodes, graph.edges, pois);
  }

  node(id) {
    return this.nodes.get(id);
  }

  neighbors(id) {
    return this.adjacency.get(id) || [];
  }

  /** Straight-line metres between two node ids. This is the A* heuristic. */
  distance(a, b) {
    const na = this.nodes.get(a);
    const nb = this.nodes.get(b);
    if (!na || !nb) return Infinity;
    return haversine(na.lat, na.lon, nb.lat, nb.lon);
  }

  /** Closest graph node to an arbitrary coordinate — used for map clicks. */
  nearestNode(lat, lon) {
    let best = null;
    let bestDist = Infinity;
    for (const node of this.nodes.values()) {
      const d = haversine(lat, lon, node.lat, node.lon);
      if (d < bestDist) {
        bestDist = d;
        best = node;
      }
    }
    return { node: best, distance: bestDist };
  }

  /** Geographic centre of the graph, for the initial map view. */
  center() {
    let lat = 0;
    let lon = 0;
    for (const n of this.nodes.values()) {
      lat += n.lat;
      lon += n.lon;
    }
    return [lat / this.nodes.size, lon / this.nodes.size];
  }

  bounds() {
    const lats = [...this.nodes.values()].map((n) => n.lat);
    const lons = [...this.nodes.values()].map((n) => n.lon);
    return [
      [Math.min(...lats), Math.min(...lons)],
      [Math.max(...lats), Math.max(...lons)],
    ];
  }

  /**
   * Expand a node path into drawable coordinates, following each edge's real
   * recorded shape rather than cutting straight between junctions.
   */
  pathCoordinates(nodeIds) {
    const coords = [];
    for (let i = 0; i < nodeIds.length - 1; i++) {
      const link = this.neighbors(nodeIds[i]).find((l) => l.to === nodeIds[i + 1]);
      if (!link) continue;

      let segment = link.edge.geometry;
      if (!link.forward) segment = [...segment].reverse();
      // Drop the shared junction point so it isn't emitted twice.
      coords.push(...(coords.length ? segment.slice(1) : segment));
    }
    return coords;
  }

  /** Total walked distance for a node path, in metres. */
  pathCost(nodeIds) {
    let total = 0;
    for (let i = 0; i < nodeIds.length - 1; i++) {
      const link = this.neighbors(nodeIds[i]).find((l) => l.to === nodeIds[i + 1]);
      if (link) total += link.edge.length_m;
    }
    return total;
  }
}