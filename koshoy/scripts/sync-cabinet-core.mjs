/**
 * Vendors the pure cabinet core (3d-room-designer src/core/cabinet) into
 * app/koshoy/cabinet-core so Koshoy Studio prices and validates with the
 * exact rules the 3D view draws.
 *
 *   npm run sync:cabinet-core            copy (tests excluded)
 *   npm run sync:cabinet-core -- --check exit 1 when the copy is out of date
 *
 * Source: $CABINET_CORE_SRC, default ../../3d-room-designer/src/core/cabinet
 * (relative to koshoy/; the 3D repo is a sibling of the sugar-shopify checkout).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = resolve(ROOT, process.env.CABINET_CORE_SRC || "../../3d-room-designer/src/core/cabinet");
const DEST = join(ROOT, "app/koshoy/cabinet-core");
const HEADER =
  "// generated — do not edit, run npm run sync:cabinet-core\n" +
  "// source: 3d-room-designer/src/core/cabinet/";
const CHECK = process.argv.includes("--check");

function fail(message) {
  console.error(`sync-cabinet-core: ${message}`);
  process.exit(1);
}

function isCoreFile(name) {
  return name.endsWith(".ts") && !name.endsWith(".test.ts") && !name.endsWith(".d.ts");
}

/** The backend only takes the pure core: every import must stay inside the folder. */
function assertPure(name, source) {
  const specifiers = [...source.matchAll(/\b(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']/g)].map(
    (match) => match[1],
  );
  for (const dynamic of source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']/g)) specifiers.push(dynamic[1]);
  for (const specifier of specifiers) {
    if (!/^\.\/[\w.-]+$/.test(specifier)) {
      fail(`${name} imports "${specifier}"; the vendored core must only import sibling files`);
    }
  }
}

if (!existsSync(SRC) || !statSync(SRC).isDirectory()) {
  fail(`source folder not found: ${SRC} (set CABINET_CORE_SRC)`);
}

const names = readdirSync(SRC).filter(isCoreFile).sort();
if (!names.includes("index.ts")) fail(`${SRC} has no index.ts`);

const wanted = new Map();
for (const name of names) {
  const source = readFileSync(join(SRC, name), "utf8");
  assertPure(name, source);
  wanted.set(name, `${HEADER}${name}\n\n${source}`);
}

const existing = existsSync(DEST) ? readdirSync(DEST).filter((name) => name.endsWith(".ts")) : [];
const stale = existing.filter((name) => !wanted.has(name));
const changed = [...wanted].filter(([name, text]) => {
  const path = join(DEST, name);
  return !existsSync(path) || readFileSync(path, "utf8") !== text;
});

if (CHECK) {
  if (stale.length || changed.length) {
    fail(
      `app/koshoy/cabinet-core is out of date (changed: ${changed.map(([name]) => name).join(", ") || "-"}; ` +
        `extra: ${stale.join(", ") || "-"}). Run npm run sync:cabinet-core`,
    );
  }
  console.log(`sync-cabinet-core: up to date (${wanted.size} files)`);
  process.exit(0);
}

mkdirSync(DEST, { recursive: true });
for (const name of stale) unlinkSync(join(DEST, name));
for (const [name, text] of changed) writeFileSync(join(DEST, name), text);
console.log(
  `sync-cabinet-core: ${relative(ROOT, SRC)} -> ${relative(ROOT, DEST)} ` +
    `(${wanted.size} files, ${changed.length} written, ${stale.length} removed)`,
);
