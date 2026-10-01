"""
Fetch the Walchand campus walking network + named places from OpenStreetMap.

Talks to the Overpass API directly and builds the routing graph itself, so the
only dependency is `requests`. No osmnx / geopandas / GDAL.

Run:
    python tools/fetch_osm.py           # uses cached response if present
    python tools/fetch_osm.py --refresh # force re-download

Outputs into web/data:
    overpass_raw.json   cached API response
    graph.json          nodes + edges, ready for routing
    pois.json           named destinations, each anchored to a graph node
"""

import argparse
import json
import math
import os
import sys
from collections import defaultdict, deque

import requests

# Campus bounding box, ~150 m of margin around the mapped campus features.
# Walchand Globe sits at 16.8443, 74.6017; campus spans roughly 820 x 850 m.
#
# A wider box drags in several km of Sangli city streets, which arrive as a
# separate road network the campus never connects to and which swamp the graph.
BBOX = {"south": 16.8415, "west": 74.5962, "north": 16.8515, "east": 74.6068}

# Ways worth walking on. Excludes motorways and anything car-only.
WALKABLE = [
    "footway", "path", "pedestrian", "steps", "living_street",
    "service", "residential", "unclassified", "track", "tertiary",
    "secondary", "corridor",
]

# Tags that mark something a person might want to navigate to.
POI_TAGS = ["building", "amenity", "room", "office", "leisure", "tourism", "shop"]

# Neighbourhood features that sit inside the bounding box but are not campus.
SKIP_KINDS = {"hospital", "clinic", "doctors", "dentist", "pharmacy",
              "post_box", "post_office", "police", "house"}

# The campus has some clearly wrong OSM tags: several classrooms and staff
# cabins carry amenity=bank, and one building holding eight Civil Engineering
# rooms is tagged amenity=toilets. The name is far more reliable than the tag
# here, so it is consulted first and the tag is only a fallback.
NAME_KINDS = [
    ("class room", "classroom"), ("classroom", "classroom"),
    ("laboratory", "lab"), ("lab", "lab"),
    ("cabin", "staff cabin"), ("faculty", "faculty"), ("staff", "staff"),
    ("h.o.d", "faculty"), ("hostel", "hostel"), ("mess", "mess"),
    ("canteen", "canteen"), ("library", "library"), ("reading room", "reading room"),
    ("hall", "hall"), ("hut", "hut"), ("department", "department"),
    ("gate", "gate"), ("ground", "sports"), ("court", "sports"),
    ("field", "sports"), ("garden", "garden"), ("park", "park"),
]

OVERPASS_URL = "https://overpass-api.de/api/interpreter"

# Overpass rejects the default python-requests agent with a 406, and asks
# clients to identify themselves.
HEADERS = {"User-Agent": "WalchandOnGo/1.0 (campus navigation student project)"}

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, "web", "data")


# ---------------------------------------------------------------- geometry

def haversine(lat1, lon1, lat2, lon2):
    """Great-circle distance in metres."""
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


# ---------------------------------------------------------------- download

def build_query():
    bb = "{south},{west},{north},{east}".format(**BBOX)
    highway_filter = "|".join(WALKABLE)
    poi_clauses = "\n".join(
        f'  nwr["{tag}"]["name"]({bb});' for tag in POI_TAGS
    )
    return f"""
[out:json][timeout:90];
(
  way["highway"~"^({highway_filter})$"]({bb});
);
out body;
>;
out skel qt;

(
{poi_clauses}
);
out center tags;
"""


def download(cache_path, refresh):
    if os.path.exists(cache_path) and not refresh:
        print(f"using cached {os.path.relpath(cache_path, ROOT)}  (--refresh to re-download)")
        with open(cache_path, encoding="utf-8") as f:
            return json.load(f)

    print("querying Overpass API ...")
    resp = requests.post(
        OVERPASS_URL, data={"data": build_query()}, headers=HEADERS, timeout=180
    )
    resp.raise_for_status()
    payload = resp.json()

    os.makedirs(os.path.dirname(cache_path), exist_ok=True)
    with open(cache_path, "w", encoding="utf-8") as f:
        json.dump(payload, f)
    print(f"cached {len(payload.get('elements', []))} elements")
    return payload


# ---------------------------------------------------------------- graph

def build_graph(elements):
    """
    Turn raw OSM ways into a routing graph.

    OSM ways carry a node every time the road bends, but a bend is not a
    decision point. Only junctions and way endpoints become graph nodes; the
    bends are kept as edge geometry so the drawn route follows the real path.
    """
    coords = {}
    ways = []

    for el in elements:
        if el["type"] == "node":
            coords[el["id"]] = (el["lat"], el["lon"])
        elif el["type"] == "way" and "nodes" in el and el.get("tags", {}).get("highway"):
            ways.append(el)

    # A node shared by two or more ways is a junction.
    use_count = defaultdict(int)
    for way in ways:
        for nid in way["nodes"]:
            use_count[nid] += 1

    junctions = set()
    for way in ways:
        nds = way["nodes"]
        junctions.add(nds[0])
        junctions.add(nds[-1])
        for nid in nds[1:-1]:
            if use_count[nid] >= 2:
                junctions.add(nid)

    edges = []
    for way in ways:
        tags = way.get("tags", {})
        nds = [n for n in way["nodes"] if n in coords]
        if len(nds) < 2:
            continue

        run = [nds[0]]
        for nid in nds[1:]:
            run.append(nid)
            if nid not in junctions:
                continue

            geometry = [coords[n] for n in run]
            length = sum(
                haversine(*geometry[i], *geometry[i + 1])
                for i in range(len(geometry) - 1)
            )
            if length > 0 and run[0] != run[-1]:
                edges.append({
                    "from": run[0],
                    "to": run[-1],
                    "length_m": round(length, 2),
                    "name": tags.get("name"),
                    "highway": tags.get("highway"),
                    "step_free": tags.get("highway") != "steps",
                    "geometry": [[round(a, 7), round(b, 7)] for a, b in geometry],
                })
            run = [nid]

    used = {nid for e in edges for nid in (e["from"], e["to"])}
    nodes = [
        {"id": nid, "lat": round(coords[nid][0], 7), "lon": round(coords[nid][1], 7)}
        for nid in sorted(used)
    ]
    return nodes, edges


def components(nodes, edges):
    """Connected components, largest first. Reveals an unroutable graph fast."""
    adj = defaultdict(list)
    for e in edges:
        adj[e["from"]].append(e["to"])
        adj[e["to"]].append(e["from"])

    seen = set()
    groups = []
    for node in nodes:
        start = node["id"]
        if start in seen:
            continue
        group = set()
        queue = deque([start])
        seen.add(start)
        while queue:
            cur = queue.popleft()
            group.add(cur)
            for nb in adj[cur]:
                if nb not in seen:
                    seen.add(nb)
                    queue.append(nb)
        groups.append(group)

    groups.sort(key=len, reverse=True)
    return groups


def keep_largest(nodes, edges, groups):
    """
    Drop everything outside the main network.

    Small detached fragments are usually a stub road clipped by the bounding
    box. Routing to a node no path reaches only ever produces "no route found",
    so they are removed rather than shipped.
    """
    if not groups:
        return nodes, edges, 0
    main = groups[0]
    kept_nodes = [n for n in nodes if n["id"] in main]
    kept_edges = [e for e in edges if e["from"] in main and e["to"] in main]
    return kept_nodes, kept_edges, len(nodes) - len(kept_nodes)


# ---------------------------------------------------------------- pois

def build_pois(elements, nodes):
    """
    Named places, each anchored to its nearest walkable node.

    OSM buildings and rooms are polygons sitting beside the path network, not
    part of it. Routing needs a node on the graph, so every destination gets an
    anchor it can be routed to.
    """
    seen_names = {}
    for el in elements:
        tags = el.get("tags") or {}
        raw_name = tags.get("name")
        if not raw_name:
            continue

        if el["type"] == "node":
            lat, lon = el.get("lat"), el.get("lon")
        else:
            center = el.get("center") or {}
            lat, lon = center.get("lat"), center.get("lon")
        if lat is None or lon is None:
            continue

        tag_kind = next((tags[t] for t in POI_TAGS if tags.get(t) and tags[t] != "yes"), None)
        tag_kind = tag_kind or next((t for t in POI_TAGS if tags.get(t)), "place")
        if tag_kind in SKIP_KINDS:
            continue

        # OSM allows several names in one tag, separated by semicolons. One
        # building here lists eight Civil Engineering rooms that way; split
        # them out or none of them can be searched for.
        for name in (part.strip() for part in raw_name.split(";")):
            if not name:
                continue
            lower = name.lower()
            kind = next((label for token, label in NAME_KINDS if token in lower), tag_kind)
            key = (lower, round(lat, 5), round(lon, 5))
            seen_names[key] = {
                "name": name,
                "lat": round(lat, 7),
                "lon": round(lon, 7),
                "kind": kind,
            }

    pois = []
    for poi in seen_names.values():
        best, best_d = None, float("inf")
        for n in nodes:
            d = haversine(poi["lat"], poi["lon"], n["lat"], n["lon"])
            if d < best_d:
                best, best_d = n["id"], d
        poi["nearest_node"] = best
        poi["anchor_dist_m"] = round(best_d, 1)
        pois.append(poi)

    pois.sort(key=lambda p: p["name"])
    return pois


# ---------------------------------------------------------------- report

def report(nodes, edges, pois, groups):
    print()
    print("=" * 58)
    print("  GRAPH HEALTH")
    print("=" * 58)
    print(f"  nodes            {len(nodes)}")
    print(f"  edges            {len(edges)}")
    print(f"  destinations     {len(pois)}")
    print(f"  components       {len(groups)}")

    if groups:
        biggest = len(groups[0])
        share = biggest / len(nodes) * 100
        print(f"  largest network  {biggest} nodes ({share:.1f}% of graph)")
        if len(groups) > 1:
            others = ", ".join(str(len(g)) for g in groups[1:6])
            print(f"  stranded pieces  {others}{' ...' if len(groups) > 6 else ''}")

        if share > 95:
            print("\n  -> healthy. Routing will work across the campus.")
        elif share > 70:
            print("\n  -> usable, but some areas are cut off from the main network.")
        else:
            print("\n  -> fragmented. Missing footpaths in OSM; needs manual links.")

    total_km = sum(e["length_m"] for e in edges) / 1000
    named = len({e["name"] for e in edges if e["name"]})
    print(f"\n  {total_km:.2f} km of walkable paths across {named} named roads")

    far = [p for p in pois if p["anchor_dist_m"] > 60]
    if far:
        print(f"  {len(far)} destinations are >60 m from any path (check these)")
    print("=" * 58)


# ---------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true", help="re-download from Overpass")
    args = ap.parse_args()

    os.makedirs(DATA_DIR, exist_ok=True)
    payload = download(os.path.join(DATA_DIR, "overpass_raw.json"), args.refresh)
    elements = payload.get("elements", [])

    nodes, edges = build_graph(elements)
    if not nodes:
        sys.exit("No walkable ways found. Check the bounding box.")

    groups = components(nodes, edges)
    nodes, edges, dropped = keep_largest(nodes, edges, groups)
    if dropped:
        print(f"dropped {dropped} nodes in {len(groups) - 1} detached fragment(s)")

    # Anchor POIs after pruning, so nothing points at a node that was removed.
    pois = build_pois(elements, nodes)

    with open(os.path.join(DATA_DIR, "graph.json"), "w", encoding="utf-8") as f:
        json.dump({"nodes": nodes, "edges": edges}, f)
    with open(os.path.join(DATA_DIR, "pois.json"), "w", encoding="utf-8") as f:
        json.dump(pois, f, ensure_ascii=False, indent=1)

    report(nodes, edges, pois, components(nodes, edges))
    print(f"\nwrote graph.json and pois.json to {os.path.relpath(DATA_DIR, ROOT)}")


if __name__ == "__main__":
    main()