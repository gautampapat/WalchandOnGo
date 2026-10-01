/**
 * Turn a node path into readable walking directions.
 *
 * The turn at a junction is measured between the *geometry* on either side of
 * it rather than between the junction nodes themselves. Roads bend between
 * junctions, so node-to-node bearings report turns that nobody actually makes.
 */

import { bearing } from "./graph.js";

const COMPASS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];

function compassName(deg) {
  return COMPASS[Math.round(((deg + 360) % 360) / 45) % 8];
}

/** Signed angle between two bearings, normalised to (-180, 180]. */
function turnAngle(from, to) {
  let delta = to - from;
  while (delta <= -180) delta += 360;
  while (delta > 180) delta -= 360;
  return delta;
}

function describeTurn(angle) {
  const side = angle > 0 ? "right" : "left";
  const size = Math.abs(angle);
  if (size < 20) return { text: "Continue", straight: true };
  if (size < 60) return { text: `Bear ${side}`, straight: false };
  if (size < 150) return { text: `Turn ${side}`, straight: false };
  return { text: `Sharp ${side}`, straight: false };
}

export function formatDistance(metres) {
  if (metres < 1000) return `${Math.round(metres)} m`;
  return `${(metres / 1000).toFixed(2)} km`;
}

export function formatDuration(metres, kmh = 5) {
  const minutes = metres / 1000 / kmh * 60;
  if (minutes < 1) return "under a minute";
  return `${Math.round(minutes)} min`;
}

/**
 * Walk the path edge by edge, merging runs that continue along the same road
 * without a real turn, and emit one instruction per genuine decision point.
 */
export function buildDirections(graph, path, destinationName) {
  if (!path || path.length < 2) return [];

  // One entry per edge traversal, with the geometry oriented along travel.
  const legs = [];
  for (let i = 0; i < path.length - 1; i++) {
    const link = graph.neighbors(path[i]).find((l) => l.to === path[i + 1]);
    if (!link) continue;
    const coords = link.forward ? link.edge.geometry : [...link.edge.geometry].reverse();
    legs.push({
      coords,
      name: link.edge.name,
      length: link.edge.length_m,
      steps: link.edge.highway === "steps",
      entry: bearing(coords[0][0], coords[0][1], coords[1][0], coords[1][1]),
      exit: bearing(
        coords[coords.length - 2][0], coords[coords.length - 2][1],
        coords[coords.length - 1][0], coords[coords.length - 1][1]
      ),
    });
  }
  if (!legs.length) return [];

  const steps = [];
  let current = {
    instruction: `Head ${compassName(legs[0].entry)}${legs[0].name ? ` on ${legs[0].name}` : ""}`,
    distance: legs[0].length,
    road: legs[0].name,
    coords: [...legs[0].coords],
    stairs: legs[0].steps,
  };

  for (let i = 1; i < legs.length; i++) {
    const leg = legs[i];
    const turn = describeTurn(turnAngle(legs[i - 1].exit, leg.entry));
    const sameRoad = leg.name === current.road;

    // Keep accumulating while the road neither turns nor changes name.
    if (turn.straight && sameRoad) {
      current.distance += leg.length;
      current.coords.push(...leg.coords.slice(1));
      current.stairs = current.stairs || leg.steps;
      continue;
    }

    steps.push(current);
    const where = leg.name ? ` onto ${leg.name}` : "";
    const verb = turn.straight && !sameRoad ? "Continue" : turn.text;
    current = {
      // "Continue" alone reads as an unfinished sentence on unnamed paths.
      instruction: verb === "Continue" && !where ? "Continue straight" : `${verb}${where}`,
      distance: leg.length,
      road: leg.name,
      coords: [...leg.coords],
      stairs: leg.steps,
    };
  }
  steps.push(current);

  steps.push({
    instruction: destinationName ? `Arrive at ${destinationName}` : "Arrive at your destination",
    distance: 0,
    road: null,
    coords: [current.coords[current.coords.length - 1]],
    arrival: true,
  });

  return steps;
}