// Downloads the reference data the build reads into cache/ (Natural Earth layers and World Bank population).
import fs from "node:fs";
import path from "node:path";
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const NE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/";
const files = {
  "ne_50m_lakes.geojson": NE + "ne_50m_lakes.geojson",
  "ne_50m_rivers_lake_centerlines.geojson": NE + "ne_50m_rivers_lake_centerlines.geojson",
  "ne_10m_geography_regions_polys.geojson": NE + "ne_10m_geography_regions_polys.geojson",
  "ne_10m_geography_marine_polys.geojson": NE + "ne_10m_geography_marine_polys.geojson",
  "population.csv": "https://raw.githubusercontent.com/datasets/population/main/data/population.csv",
};
fs.mkdirSync(path.join(ROOT, "cache"), { recursive: true });
for (const [name, url] of Object.entries(files)) {
  const dest = path.join(ROOT, "cache", name);
  if (fs.existsSync(dest)) { console.log("have", name); continue; }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  console.log("got", name);
}
