# WalchandOnGo

Campus navigation for Walchand College of Engineering, Sangli. Search for any
building, lab, classroom or cabin and get a walking route drawn on the map with
turn-by-turn directions — plus a panel that lets you swap the search algorithm
and watch the difference.

**Team:** G2, G6, G19 · **Guide:** Ms. A. B. Patil

---

## Quick start

```bash
python tools/fetch_osm.py     # download campus data, build the graph
node tools/verify.mjs         # prove the routing engine is correct
python -m http.server 8000 --directory web
```

Then open <http://localhost:8000>.

The server is required — browsers block `fetch()` on `file://` URLs, so opening
`index.html` directly will not load the map data.

Only dependency is `requests` for the fetch step. No osmnx, no geopandas, no
build tooling.

---

## How it works

**The map data is OpenStreetMap.** Walchand's campus is unusually well mapped —
individual classrooms, every department, labs, hostels, canteens and named
internal roads. `tools/fetch_osm.py` pulls it from the Overpass API and builds
the routing graph itself.

The interesting part is the conversion. OSM stores roads as *ways* — ordered
lists of points, with a point wherever the road bends. A bend is not a decision,
so the script keeps only genuine junctions as graph nodes and stores the bends
as edge geometry. That way the drawn route follows the real curve of the road
while the graph stays small enough to search instantly.

**Places are anchored to the network.** Classrooms and buildings are polygons
sitting *beside* the paths, not on them — a routing algorithm cannot start at a
polygon. Every named place is therefore matched to its nearest walkable node,
which is what "route me to Class Room 21" actually resolves to. Where a building
is far from any mapped path, the site draws a dashed leg for the last few metres
and says so in the summary.

**Everything runs in the browser.** No backend. `web/data/graph.json` is a static
file, the four algorithms are plain JavaScript, and a route computes in well
under a millisecond.

```
tools/fetch_osm.py     Overpass -> graph.json + pois.json
tools/verify.mjs       all-pairs correctness checks
web/js/graph.js        adjacency list, haversine, nearest-node lookup
web/js/search.js       BFS, DFS, Dijkstra, A* — all instrumented
web/js/directions.js   node path -> turn-by-turn text
web/js/map.js          Leaflet rendering
web/js/ui.js           type-ahead place search
web/js/app.js          wiring
```

---

## The graph

| | |
|---|---|
| Nodes (junctions) | 82 |
| Edges (path segments) | 99 |
| Walkable paths | 10.24 km across 21 named roads |
| Destinations | 132 |
| Connected components | **1** — everything is reachable from everywhere |

---

## Results

`node tools/verify.mjs` runs every algorithm across all **6,642** node pairs and
checks the properties the project claims, rather than asserting them:

```
PASS  connectivity: 0 unreachable pairs
PASS  optimality: A* matches Dijkstra on 100.00% of pairs (0 mismatches)
PASS  admissibility: 0 violations
PASS  efficiency: A* expanded more than Dijkstra on 0 pairs

A* explored 169,977 nodes total vs Dijkstra's 278,964
-> 39.1% fewer, and strictly fewer on 97.91% of pairs
```

**A\* finds exactly the same shortest route as Dijkstra while exploring 39.1%
fewer nodes.** That is the headline result, and it is measured rather than
quoted.

The admissibility check is the one worth explaining in the report. Straight-line
distance between two points can never exceed the real walking distance along
paths, so the A\* heuristic never overestimates — which is precisely why A\*
keeps Dijkstra's guarantee of optimality. The script verifies that across every
pair instead of taking it on trust.

A sample route also shows why the uninformed algorithms are included:

| Algorithm | Nodes explored | Route length |
|---|---|---|
| A\* | 3 | 159 m |
| Dijkstra | 7 | 159 m |
| BFS | 9 | 159 m |
| DFS | 18 | **728 m** |

DFS returns a route 4.5× longer than necessary. That is not a bug — it is what
depth-first search does, and being able to show it is the point.

Tick **Show explored nodes** and pick Dijkstra on a long route to see it spread
outward in every direction, then switch to A\* and watch it drive straight at
the destination.

---

## Notes on the source data

Working with real OSM data surfaced genuine problems worth recording:

- **Mis-tagged features.** Main CCF, N2 classroom and several staff cabins are
  tagged `amenity=bank`. A building holding eight Civil Engineering rooms is
  tagged `amenity=toilets`. The fetch script derives categories from names first
  because the tags cannot be trusted here.
- **Multi-value names.** OSM allows several names in one `name` tag separated by
  semicolons. One building listed eight Civil Engineering rooms that way, making
  all of them unsearchable until the script split them apart.
- **Bounding box matters.** A 700 m radius pulled in several kilometres of Sangli
  city streets as a separate road network, giving 6 disconnected components. A
  tight campus box plus dropping detached fragments gives a single connected
  graph.
- **The recorded GPX is off-campus.** `track_room_to_mess_20260809130432.gpx`
  sits around Chanakyapuri Garden and Vishrambag Ganpati Temple, roughly 500 m
  west of the campus. It is not usable as campus validation.
- **No floor data.** OSM has no `level` tags here, so Class Room 8 and Class Room
  21 may be on different floors and the data cannot say. Indoor routing is out of
  scope; destinations resolve to the nearest path outside the building.

Several of these are worth fixing upstream in the OSM iD editor — contributing
corrections back is a legitimate and easily defended part of the project.

---

## Ideas from here

- Cross-check 10 routes against OsmAnd's distances as external validation
- Walk a few routes with a phone and compare predicted vs. measured distance
- Trace the missing internal footpaths into OSM and re-fetch
- Step-free routing — the graph already carries a `step_free` flag per edge
