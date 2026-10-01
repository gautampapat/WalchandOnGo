/**
 * The place-search field: type-ahead over the campus destination list, with
 * keyboard navigation.
 */

/** Loose match so "clasrm 21" still finds "Class Room 21". */
function subsequenceMatch(haystack, needle) {
  let i = 0;
  for (const char of haystack) {
    if (char === needle[i]) i++;
    if (i === needle.length) return true;
  }
  return false;
}

function score(name, query) {
  const lower = name.toLowerCase();
  if (lower.startsWith(query)) return 0;
  if (lower.includes(query)) return 1;
  if (subsequenceMatch(lower, query)) return 2;
  return Infinity;
}

export function searchPlaces(pois, query, limit = 8) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return pois
    .map((poi) => ({ poi, rank: score(poi.name, q) }))
    .filter((entry) => entry.rank !== Infinity)
    .sort((a, b) => a.rank - b.rank || a.poi.name.length - b.poi.name.length)
    .slice(0, limit)
    .map((entry) => entry.poi);
}

export class PlaceSearch {
  constructor({ input, list, pois, onSelect }) {
    this.input = input;
    this.list = list;
    this.pois = pois;
    this.onSelect = onSelect;
    this.results = [];
    this.active = -1;
    this.selected = null;

    input.addEventListener("input", () => this.render(searchPlaces(pois, input.value)));
    input.addEventListener("focus", () => {
      if (input.value.trim()) this.render(searchPlaces(pois, input.value));
    });
    input.addEventListener("keydown", (e) => this.onKeyDown(e));
    // Delay so a click on a result lands before the list is torn down.
    input.addEventListener("blur", () => setTimeout(() => this.close(), 150));
  }

  onKeyDown(event) {
    if (!this.results.length) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      this.active = (this.active + delta + this.results.length) % this.results.length;
      this.paintActive();
    } else if (event.key === "Enter") {
      event.preventDefault();
      this.choose(this.results[this.active === -1 ? 0 : this.active]);
    } else if (event.key === "Escape") {
      this.close();
    }
  }

  render(results) {
    this.results = results;
    this.active = -1;
    this.list.innerHTML = "";

    if (!results.length) {
      this.list.classList.remove("open");
      return;
    }

    for (const poi of results) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "result";
      item.innerHTML = `<span class="result-name"></span><span class="result-kind"></span>`;
      item.querySelector(".result-name").textContent = poi.name;
      item.querySelector(".result-kind").textContent = poi.kind || "";
      item.addEventListener("mousedown", (e) => {
        e.preventDefault();
        this.choose(poi);
      });
      this.list.appendChild(item);
    }
    this.list.classList.add("open");
  }

  paintActive() {
    [...this.list.children].forEach((el, i) => {
      el.classList.toggle("active", i === this.active);
    });
  }

  choose(poi) {
    if (!poi) return;
    this.selected = poi;
    this.input.value = poi.name;
    this.close();
    this.onSelect(poi);
  }

  /** Used when a place is picked on the map rather than typed. */
  setPlace(poi) {
    this.selected = poi;
    this.input.value = poi.name;
  }

  close() {
    this.list.classList.remove("open");
    this.list.innerHTML = "";
    this.results = [];
    this.active = -1;
  }
}