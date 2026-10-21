/**
 * Vendors the pure 3D cores into the backend so Koshoy Studio uses the exact
 * rules the 3D view draws:
 *   3d-room-designer src/core/cabinet     → app/koshoy/cabinet-core  (prices, validation)
 *   3d-room-designer src/core/room-layout → app/koshoy/room-layout   (cabinets in the room)
 *
 *   npm run sync:cabinet-core            copy both (tests excluded)
 *   npm run sync:cabinet-core -- --check exit 1 when a copy is out of date
 *
 * Sources: $CABINET_CORE_SRC and $ROOM_LAYOUT_SRC, default
 * ../../3d-room-designer/src/core/<folder> (relative to koshoy/; the 3D repo
 * is a sibling of the sugar-shopify checkout).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CHECK = process.argv.includes("--check");
const CORES = [
  { folder: "cabinet", dest: "app/koshoy/cabinet-core", env: "CABINET_CORE_SRC" },
  { folder: "room-layout", dest: "app/koshoy/room-layout", env: "ROOM_LAYOUT_SRC" },
];

function fail(message) {
  console.error(`sync-cabinet-core: ${message}`);
  process.exit(1);
}

/** Sources only: no tests, no test data (".test.ts", ".test-data.ts"), no declarations. */
function isCoreFile(name) {
  return name.endsWith(".ts") && !name.includes(".test") && !name.endsWith(".d.ts");
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

/** Copies one core; returns false (with --check) when its copy is out of date. */
function syncCore({ folder, dest, env }) {
  const src = resolve(ROOT, process.env[env] || `../../3d-room-designer/src/core/${folder}`);
  const destDir = join(ROOT, dest);
  const header =
    "// generated — do not edit, run npm run sync:cabinet-core\n" +
    `// source: 3d-room-designer/src/core/${folder}/`;
  if (!existsSync(src) || !statSync(src).isDirectory()) {
    fail(`source folder not found: ${src} (set ${env})`);
  }

  const names = readdirSync(src).filter(isCoreFile).sort();
  if (!names.includes("index.ts")) fail(`${src} has no index.ts`);

  const wanted = new Map();
  for (const name of names) {
    const source = readFileSync(join(src, name), "utf8");
    assertPure(name, source);
    wanted.set(name, `${header}${name}\n\n${source}`);
  }

  const existing = existsSync(destDir) ? readdirSync(destDir).filter((name) => name.endsWith(".ts")) : [];
  const stale = existing.filter((name) => !wanted.has(name));
  const changed = [...wanted].filter(([name, text]) => {
    const path = join(destDir, name);
    return !existsSync(path) || readFileSync(path, "utf8") !== text;
  });

  if (CHECK) {
    if (stale.length || changed.length) {
      console.error(
        `sync-cabinet-core: ${dest} is out of date (changed: ${changed.map(([name]) => name).join(", ") || "-"}; ` +
          `extra: ${stale.join(", ") || "-"}). Run npm run sync:cabinet-core`,
      );
      return false;
    }
    console.log(`sync-cabinet-core: ${dest} up to date (${wanted.size} files)`);
    return true;
  }

  mkdirSync(destDir, { recursive: true });
  for (const name of stale) unlinkSync(join(destDir, name));
  for (const [name, text] of changed) writeFileSync(join(destDir, name), text);
  console.log(
    `sync-cabinet-core: ${relative(ROOT, src)} -> ${dest} ` +
      `(${wanted.size} files, ${changed.length} written, ${stale.length} removed)`,
  );
  return true;
}

const results = CORES.map(syncCore);
if (results.includes(false)) process.exit(1);
