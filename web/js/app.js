/**
 * Wiring: load the graph, hook the search fields and map together, route with
 * A*, and render the result.
 */

import { CampusGraph } from "./graph.js";
import { astar } from "./search.js";
import { buildDirections, formatDistance, formatDuration } from "./directions.js";
import { CampusMap } from "./map.js";
import { PlaceSearch } from "./ui.js";

const el = (id) => document.getElementById(id);

const state = {
  from: null,
  to: null,
};

let graph;
let campusMap;
let fromSearch;
let toSearch;

/** Icon for a step, picked off the instruction wording. */
function stepIcon(instruction) {
  if (instruction.startsWith("Arrive")) return "●";
  if (instruction.startsWith("Head")) return "↑";
  if (instruction.includes("Sharp left")) return "↰";
  if (instruction.includes("Sharp right")) return "↱";
  if (instruction.includes("Bear left")) return "↖";
  if (instruction.includes("Bear right")) return "↗";
  if (instruction.includes("left")) return "←";
  if (instruction.includes("right")) return "→";
  return "↑";
}

/* ------------------------------------------------------------- rendering */

function renderSteps(steps) {
  const list = el("steps");
  list.innerHTML = "";

  for (const step of steps) {
    const li = document.createElement("li");
    if (step.arrival) li.classList.add("arrival");

    const icon = document.createElement("span");
    icon.className = "step-icon";
    icon.textContent = stepIcon(step.instruction);

    const text = document.createElement("span");
    text.textContent = step.instruction;
    if (step.stairs) {
      const warn = document.createElement("span");
      warn.className = "step-stairs";
      warn.textContent = "includes steps";
      text.appendChild(warn);
    }

    const dist = document.createElement("span");
    dist.className = "step-dist";
    dist.textContent = step.distance ? formatDistance(step.distance) : "";

    li.append(icon, text, dist);
    li.addEventListener("mouseenter", () => campusMap.highlightStep(step.coords));
    li.addEventListener("mouseleave", () => campusMap.clearHighlight());
    list.appendChild(li);
  }
}

/* ---------------------------------------------------------------- routing */

function clearRoute(message) {
  campusMap.clearRoute();
  el("steps").innerHTML = "";
  el("summary").hidden = true;
  if (message) el("hint").textContent = message;
}

function route() {
  if (!state.from || !state.to) return;

  if (state.from.nearest_node === state.to.nearest_node) {
    clearRoute("Those two places share the same access point on the path network — pick somewhere further away.");
    return;
  }

  const result = astar(graph, state.from.nearest_node, state.to.nearest_node);

  if (!result.path) {
    clearRoute("No route found between those two points.");
    return;
  }

  campusMap.drawRoute(graph.pathCoordinates(result.path), {
    from: [state.from.lat, state.from.lon],
    to: [state.to.lat, state.to.lon],
  });
  renderSteps(buildDirections(graph, result.path, state.to.name));

  el("summary").hidden = false;
  el("summaryTime").textContent = formatDuration(result.cost);
  el("summaryDist").textContent = formatDistance(result.cost);

  const far = Math.max(state.from.anchor_dist_m || 0, state.to.anchor_dist_m || 0);
  el("summaryNote").textContent =
    far > 60 ? `Nearest mapped path is ${Math.round(far)} m from one endpoint` : "";

  el("hint").textContent = "Hover a step to highlight it on the map.";
}

function setEndpoint(kind, place) {
  state[kind] = place;
  campusMap.setEndpoint(kind === "from" ? "start" : "end", place.lat, place.lon, place.name);
  (kind === "from" ? fromSearch : toSearch).setPlace(place);

  if (state.from && state.to) route();
  else campusMap.panTo(place.lat, place.lon);
}

/* ------------------------------------------------------------------ setup */

function wireControls() {
  el("swapBtn").addEventListener("click", () => {
    if (!state.from && !state.to) return;
    const { from, to } = state;
    campusMap.clearEndpoint("start");
    campusMap.clearEndpoint("end");
    state.from = state.to = null;
    fromSearch.input.value = "";
    toSearch.input.value = "";
    if (to) setEndpoint("from", to);
    if (from) setEndpoint("to", from);
  });

  const setPanel = (hidden) => {
    el("sidebar").classList.toggle("hidden", hidden);
    document.body.classList.toggle("panel-hidden", hidden);
    el("reopenBtn").hidden = !hidden;
    setTimeout(() => campusMap.map.invalidateSize(), 260);
  };
  el("collapseBtn").addEventListener("click", () => setPanel(true));
  el("reopenBtn").addEventListener("click", () => setPanel(false));
}

async function init() {
  graph = await CampusGraph.load();
  campusMap = new CampusMap("map", graph);

  fromSearch = new PlaceSearch({
    input: el("fromInput"), list: el("fromResults"), pois: graph.pois,
    onSelect: (poi) => setEndpoint("from", poi),
  });
  toSearch = new PlaceSearch({
    input: el("toInput"), list: el("toResults"), pois: graph.pois,
    onSelect: (poi) => setEndpoint("to", poi),
  });

  // Clicking a place on the map fills whichever field is still empty.
  campusMap.showPois((poi) => setEndpoint(state.from ? "to" : "from", poi));

  campusMap.onClick((lat, lon) => {
    const { node, distance } = graph.nearestNode(lat, lon);
    if (!node) return;
    setEndpoint(state.from ? "to" : "from", {
      name: "Dropped pin",
      lat, lon,
      nearest_node: node.id,
      anchor_dist_m: distance,
    });
  });

  wireControls();

  el("hint").textContent =
    `${graph.pois.length} places across campus. Search above, or click the map to drop a point.`;
}

init().catch((err) => {
  console.error(err);
  el("hint").textContent =
    "Could not load campus data. Run this through a local server: python -m http.server 8000";
});