#!/usr/bin/env node
// License header checker for Authently.
//
// Verifies every .ts / .tsx file in OSS packages begins with the canonical
// AGPL-3.0 header (kept in sync with `scripts/license-header.txt`). Per the
// sprint spec, only .ts and .tsx are required; other extensions are skipped.
//
// OSS scope: `apps/**` and `packages/**`, EXCEPT:
//   - packages/hosted-features/   (proprietary carve-out)
//   - packages/n8n-node/          (MIT — checked separately when added)
//   - packages/make-module/       (MIT — checked separately when added)
//
// Skipped paths in scope: node_modules, dist, build, .next, .turbo, coverage,
// any directory named `generated`, and `*.d.ts` declaration files.
//
// A leading `#!` shebang line is allowed before the header.
//
// Exit 0 when all files OK; exit 1 with a list of offenders otherwise.

import { readFile, readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const HEADER_PATH = join(REPO_ROOT, "scripts", "license-header.txt");

const OSS_ROOTS = ["apps", "packages"];

const EXCLUDED_PACKAGE_PATHS = [
  join("packages", "hosted-features"),
  join("packages", "n8n-node"),
  join("packages", "make-module"),
];

const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  ".next",
  ".turbo",
  "coverage",
  "generated",
]);

const REQUIRED_EXTENSIONS = new Set([".ts", ".tsx"]);

async function loadHeader() {
  const raw = await readFile(HEADER_PATH, "utf8");
  return raw.trimEnd();
}

async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === "ENOENT") return;
    throw err;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      yield* walk(path);
    } else if (entry.isFile()) {
      yield path;
    }
  }
}

function isInExcludedPackage(absPath) {
  const rel = relative(REPO_ROOT, absPath);
  for (const p of EXCLUDED_PACKAGE_PATHS) {
    if (rel === p || rel.startsWith(p + sep)) return true;
  }
  return false;
}

function isRequiredFile(path) {
  if (path.endsWith(".d.ts")) return false;
  const dot = path.lastIndexOf(".");
  if (dot === -1) return false;
  return REQUIRED_EXTENSIONS.has(path.slice(dot));
}

async function fileHasHeader(absPath, header) {
  const content = await readFile(absPath, "utf8");
  const body = content.startsWith("#!")
    ? content.slice(content.indexOf("\n") + 1)
    : content;
  return body.startsWith(header);
}

async function main() {
  const header = await loadHeader();
  const offenders = [];
  let checked = 0;

  for (const root of OSS_ROOTS) {
    const abs = join(REPO_ROOT, root);
    for await (const file of walk(abs)) {
      if (!isRequiredFile(file)) continue;
      if (isInExcludedPackage(file)) continue;
      checked++;
      if (!(await fileHasHeader(file, header))) {
        offenders.push(relative(REPO_ROOT, file));
      }
    }
  }

  if (offenders.length > 0) {
    console.error(
      `License header check FAILED. ${offenders.length} of ${checked} file(s) missing the AGPL header:`,
    );
    for (const f of offenders) console.error(`  - ${f}`);
    console.error(
      `\nExpected header at top of each file (after optional shebang):\n`,
    );
    console.error(header);
    process.exit(1);
  }

  console.log(`License header check OK (${checked} file(s) checked).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
