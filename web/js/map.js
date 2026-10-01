/**
 * Everything Leaflet. The rest of the app talks to this and never touches L
 * directly, so the map library stays swappable.
 */

const ROUTE_COLOR = "#1a73e8";
const ROUTE_CASING = "#0b4da2";

export class CampusMap {
  constructor(elementId, graph) {
    this.graph = graph;

    this.map = L.map(elementId, { zoomControl: false }).fitBounds(graph.bounds(), {
      padding: [40, 40],
    });
    L.control.zoom({ position: "bottomright" }).addTo(this.map);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
      maxZoom: 20,
    }).addTo(this.map);

    this.poiLayer = L.layerGroup().addTo(this.map);
    this.routeLayer = L.layerGroup().addTo(this.map);
    this.markerLayer = L.layerGroup().addTo(this.map);

    this.startMarker = null;
    this.endMarker = null;
    this.highlightLine = null;
  }

  showPois(onSelect) {
    this.poiLayer.clearLayers();
    for (const poi of this.graph.pois) {
      L.circleMarker([poi.lat, poi.lon], {
        radius: 4,
        color: "#fff",
        weight: 1.5,
        fillColor: "#5f6368",
        fillOpacity: 0.9,
      })
        .bindTooltip(poi.name, { direction: "top", offset: [0, -4] })
        .on("click", () => onSelect(poi))
        .addTo(this.poiLayer);
    }
  }

  onClick(handler) {
    this.map.on("click", (e) => handler(e.latlng.lat, e.latlng.lng));
  }

  setEndpoint(kind, lat, lon, label) {
    const isStart = kind === "start";
    const marker = L.marker([lat, lon], {
      icon: L.divIcon({
        className: "endpoint-pin",
        html: `<div class="pin ${isStart ? "pin-start" : "pin-end"}">${isStart ? "A" : "B"}</div>`,
        iconSize: [26, 26],
        iconAnchor: [13, 13],
      }),
      zIndexOffset: 1000,
    }).addTo(this.markerLayer);
    if (label) marker.bindTooltip(label, { direction: "top", offset: [0, -12] });

    const existing = isStart ? this.startMarker : this.endMarker;
    if (existing) this.markerLayer.removeLayer(existing);
    if (isStart) this.startMarker = marker;
    else this.endMarker = marker;
  }

  clearEndpoint(kind) {
    const marker = kind === "start" ? this.startMarker : this.endMarker;
    if (marker) this.markerLayer.removeLayer(marker);
    if (kind === "start") this.startMarker = null;
    else this.endMarker = null;
  }

  /**
   * `endpoints` are the real start/destination coordinates. Buildings sit off
   * the path network, so the routed line stops at the nearest road and a
   * dashed leg covers the last few metres to the door.
   */
  drawRoute(coords, endpoints = {}) {
    this.routeLayer.clearLayers();
    if (!coords || coords.length < 2) return;

    // Casing underneath gives the line a readable edge over busy map tiles.
    L.polyline(coords, { color: ROUTE_CASING, weight: 10, opacity: 0.9, lineJoin: "round" }).addTo(this.routeLayer);
    L.polyline(coords, { color: ROUTE_COLOR, weight: 6, opacity: 1, lineJoin: "round" }).addTo(this.routeLayer);

    const legs = [];
    if (endpoints.from) legs.push([endpoints.from, coords[0]]);
    if (endpoints.to) legs.push([coords[coords.length - 1], endpoints.to]);
    for (const leg of legs) {
      L.polyline(leg, {
        color: ROUTE_COLOR,
        weight: 4,
        opacity: 0.75,
        dashArray: "2,7",
        lineCap: "round",
        interactive: false,
      }).addTo(this.routeLayer);
    }

    this.map.fitBounds(L.latLngBounds([...coords, ...legs.flat()]), { padding: [70, 70] });
  }

  clearRoute() {
    this.routeLayer.clearLayers();
    this.clearHighlight();
  }

  highlightStep(coords) {
    this.clearHighlight();
    if (!coords || coords.length < 2) return;
    this.highlightLine = L.polyline(coords, {
      color: "#fbbc04",
      weight: 9,
      opacity: 0.95,
    }).addTo(this.routeLayer);
  }

  clearHighlight() {
    if (this.highlightLine) {
      this.routeLayer.removeLayer(this.highlightLine);
      this.highlightLine = null;
    }
  }

  panTo(lat, lon, zoom = 18) {
    this.map.setView([lat, lon], zoom);
  }
}