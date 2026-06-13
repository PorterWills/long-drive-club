#!/usr/bin/env node
/*
 * build-car-data.js
 * ------------------
 * Generates car-makes-models.json for the entry-sheet car picker.
 *
 * Pulls model lists from the free NHTSA vPIC API, restricted to a curated
 * set of UK-relevant makes (not vPIC's full ~12,000-make list). For each
 * make it fetches the models, dedupes, sorts alphabetically, and writes a
 *   { "Make": ["Model", ...] }
 * object to car-makes-models.json.
 *
 * Usage:  node build-car-data.js
 * Needs Node 18+ (uses the built-in global fetch).
 *
 * NOTE: vPIC is a US (NHTSA) database. European-market makes (Vauxhall,
 * Citroën, Peugeot, Cupra, MG, Polestar, etc.) may come back sparse, empty,
 * or with US-rooted naming. Review the output and hand-correct as needed —
 * see the README notes that shipped with this file.
 */

const fs = require("fs");

// ~49 UK-relevant makes. Names are what we want as JSON keys; the API call
// is URL-encoded from these.
const MAKES = [
  "Abarth", "Alfa Romeo", "Alpine", "Aston Martin", "Audi",
  "Bentley", "BMW", "BYD", "Citroen", "Cupra",
  "Dacia", "DS", "Ferrari", "Fiat", "Ford",
  "Genesis", "Honda", "Hyundai", "Jaguar", "Jeep",
  "Kia", "Lamborghini", "Land Rover", "Lexus", "Lotus",
  "Maserati", "Mazda", "McLaren", "Mercedes-Benz", "MG",
  "MINI", "Mitsubishi", "Nissan", "Peugeot", "Polestar",
  "Porsche", "Renault", "Rolls-Royce", "SEAT", "Skoda",
  "Smart", "SsangYong", "Subaru", "Suzuki", "Tesla",
  "Toyota", "Vauxhall", "Volkswagen", "Volvo"
];

const OUT_FILE = "car-makes-models.json";
const DELAY_MS = 300;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function modelsForMake(make) {
  const url =
    "https://vpic.nhtsa.dot.gov/api/vehicles/GetModelsForMake/" +
    encodeURIComponent(make) +
    "?format=json";
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const json = await res.json();
  const names = (json.Results || [])
    .map((r) => (r.Model_Name || "").trim())
    .filter(Boolean);
  // dedupe (case-insensitive) + sort alphabetically
  const seen = new Map();
  for (const n of names) {
    const key = n.toLowerCase();
    if (!seen.has(key)) seen.set(key, n);
  }
  return Array.from(seen.values()).sort((a, b) =>
    a.localeCompare(b, "en", { sensitivity: "base" })
  );
}

async function main() {
  const out = {};
  for (const make of MAKES) {
    process.stdout.write("Fetching " + make + " … ");
    try {
      const models = await modelsForMake(make);
      out[make] = models;
      console.log(models.length + " models");
      if (models.length === 0) console.log("  ⚠️  no models returned — review " + make);
    } catch (err) {
      out[make] = [];
      console.log("FAILED (" + err.message + ") — left empty, review " + make);
    }
    await sleep(DELAY_MS);
  }
  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2) + "\n");
  console.log("\nWrote " + OUT_FILE + " (" + Object.keys(out).length + " makes).");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
