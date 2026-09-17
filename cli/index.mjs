#!/usr/bin/env node
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isAbsolute, relative, resolve, sep } from "node:path";
import semver from "semver";
import { presets, templates, exportLines } from "./templates.mjs";

const PACKAGE_NAME = "webgpu-progressive-blur";
const packageMetadata = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
export const packageVersion = packageMetadata.version;
export const minimumRuntimeVersion = "0.1.1";
export const runtimeSpec = `${PACKAGE_NAME}@${packageVersion}`;

const EXPORTS_START = "// progressive-blur:exports:start";
const EXPORTS_END = "// progressive-blur:exports:end";
const supportedFrameworks = ["react", "astro"];
const supportedPackageManagers = ["npm", "pnpm", "yarn", "bun"];
const lockfiles = [
  ["package-lock.json", "npm"],
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
];
const HELP = [
  "Usage: webgpu-progressive-blur add [navbar sidebar bottom-bar caption edge panel]",
  "Options: --framework react|astro --dir <directory> --no-install --force --dry-run",
  "No names: add all six presets. Existing source files are kept unless --force is provided.",
];

let temporaryFileCounter = 0;

function fail(message) {
  throw new Error(message);
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

export function parseArguments(args) {
  if (!args.length || args.includes("--help") || args.includes("-h"))
    return { help: true };
  if (args[0] !== "add") fail("Unknown command. Use add or --help.");

  const parsed = {
    command: "add",
    names: [],
    framework: undefined,
    directory: undefined,
    noInstall: false,
    force: false,
    dryRun: false,
  };
  const seen = new Set();

  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--framework" || arg === "--dir") {
      if (seen.has(arg)) fail(`Duplicate option: ${arg}.`);
      seen.add(arg);
      const value = args[index + 1];
      if (!value || value.startsWith("-"))
        fail(`Missing value for ${arg}.`);
      index += 1;
      if (arg === "--framework") parsed.framework = value;
      else parsed.directory = value;
      continue;
    }
    if (["--no-install", "--force", "--dry-run"].includes(arg)) {
      if (seen.has(arg)) fail(`Duplicate option: ${arg}.`);
      seen.add(arg);
      if (arg === "--no-install") parsed.noInstall = true;
      if (arg === "--force") parsed.force = true;
      if (arg === "--dry-run") parsed.dryRun = true;
      continue;
    }
    if (arg.startsWith("-")) fail(`Unknown option: ${arg}`);
    parsed.names.push(arg);
  }

  if (parsed.framework && !supportedFrameworks.includes(parsed.framework))
    fail("Only React and Astro are supported.");

  const selected = [...new Set(parsed.names.length ? parsed.names : presets)];
  for (const name of selected) {
    if (!presets.includes(name))
      fail(`Unknown preset: ${name}. Available: ${presets.join(", ")}`);
  }
  return { ...parsed, selected };
}

function readProjectManifest(cwd) {
  const manifestPath = resolve(cwd, "package.json");
  let source;
  try {
    source = readFileSync(manifestPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT")
      fail("Run this command in your project directory containing package.json.");
    fail(`Cannot read package.json: ${error.message}`);
  }
  try {
    const manifest = JSON.parse(source);
    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest))
      fail("package.json must contain a JSON object.");
    return { path: manifestPath, manifest };
  } catch (error) {
    if (error instanceof SyntaxError) fail(`Invalid package.json: ${error.message}`);
    throw error;
  }
}

function detectFramework(manifest, explicit) {
  if (explicit) return explicit;
  const dependencies = {
    ...(manifest.devDependencies ?? {}),
    ...(manifest.dependencies ?? {}),
  };
  if (hasOwn(dependencies, "astro")) return "astro";
  if (hasOwn(dependencies, "react")) return "react";
  fail(
    "Cannot detect framework. Specify --framework react or --framework astro.",
  );
}

function readPathInfo(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    fail(`Cannot inspect path ${path}: ${error.message}`);
  }
}

function isWindowsAbsolute(path) {
  return /^[A-Za-z]:[\\/]/.test(path) || /^\\\\/.test(path);
}

function resolveOutputDirectory(cwd, requested) {
  const srcPath = resolve(cwd, "src");
  const srcInfo = readPathInfo(srcPath);
  if (requested !== undefined) {
    if (!requested || isAbsolute(requested) || isWindowsAbsolute(requested))
      fail("--dir must be a non-empty relative subdirectory of the current project.");
    if (requested.split(/[\\/]/).some((part) => part === ".."))
      fail("--dir must not contain directory traversal.");
  }
  if (
    requested === undefined &&
    srcInfo &&
    (srcInfo.isSymbolicLink() || !srcInfo.isDirectory())
  )
    fail("The project's src path exists but is not a regular directory.");
  const output = resolve(
    cwd,
    requested ??
      `${srcInfo?.isDirectory() ? "src/" : ""}components/progressive_blur`,
  );
  const rel = relative(resolve(cwd), output);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))
    fail("--dir must be a subdirectory of the current project.");
  return { output, relative: rel };
}

function assertDirectoryChain(cwd, relativeOutput) {
  let current = resolve(cwd);
  for (const part of relativeOutput.split(sep).filter(Boolean)) {
    current = resolve(current, part);
    const info = readPathInfo(current);
    if (info && (info.isSymbolicLink() || !info.isDirectory()))
      fail(`Output path is not a regular directory: ${current}`);
  }
}

function assertOutputFile(target) {
  const info = readPathInfo(target);
  if (info && (info.isSymbolicLink() || !info.isFile()))
    fail(`Refusing non-regular output file: ${target}`);
}

function assertNoOppositeFramework(output, framework) {
  const info = readPathInfo(output);
  if (!info) return;
  if (!info.isDirectory()) fail(`Output path is not a regular directory: ${output}`);
  const oppositeExtension = framework === "react" ? "astro" : "tsx";
  for (const name of readdirSync(output)) {
    if (
      name === `progressive-blur.${oppositeExtension}` ||
      (name.startsWith("progressive-blur-") &&
        name.endsWith(`.${oppositeExtension}`))
    ) {
      fail(
        "This directory already contains another framework. Choose a separate --dir.",
      );
    }
  }
}

function expectedExportFile(line, framework) {
  const source = line.match(/\bfrom\s+['"]\.\/([^'"]+)['"]/)?.[1];
  if (!source) return undefined;
  return source.endsWith(`.${framework === "react" ? "tsx" : "astro"}`)
    ? source
    : `${source}.${framework === "react" ? "tsx" : "astro"}`;
}

function exportName(line) {
  return line.match(/\{\s*(?:default\s+as\s+)?(\w+)/)?.[1];
}

function exportCatalog(framework) {
  return exportLines(framework, presets).map((line) => ({
    line,
    name: exportName(line),
    file: expectedExportFile(line, framework),
  }));
}

function stableExportLines(framework, lines) {
  const selected = new Set(lines);
  return exportLines(framework, presets).filter((line) => selected.has(line));
}

function assertReferencedFiles(output, entries, plannedFiles) {
  for (const entry of entries) {
    if (!entry.file) fail("Cannot identify a managed export source file.");
    if (plannedFiles.has(entry.file)) continue;
    const target = resolve(output, entry.file);
    const info = readPathInfo(target);
    if (!info || info.isSymbolicLink() || !info.isFile())
      fail(`Managed export points to a missing or non-regular file: ${entry.file}`);
  }
}

function lineEnding(source) {
  return source.includes("\r\n") ? "\r\n" : "\n";
}

function buildManagedBlock(framework, lines, source, includeTrailingNewline) {
  const eol = lineEnding(source);
  const block = [
    EXPORTS_START,
    ...stableExportLines(framework, lines),
    EXPORTS_END,
  ].join(eol);
  return includeTrailingNewline ? `${block}${eol}` : block;
}

function markerMatches(source, marker) {
  return [
    ...source.matchAll(
      new RegExp(`^[ \\t]*${marker}[ \\t]*(?:\\r?\\n|$)`, "gm"),
    ),
  ];
}

function managedIndex(source, framework, selected, output, plannedFiles) {
  const currentCatalog = exportCatalog(framework);
  const opposite = framework === "react" ? "astro" : "react";
  const oppositeCatalog = exportCatalog(opposite);
  const currentByLine = new Map(currentCatalog.map((entry) => [entry.line, entry]));
  const oppositeByLine = new Map(oppositeCatalog.map((entry) => [entry.line, entry]));
  const allNames = new Set([
    ...currentCatalog.map((entry) => entry.name),
    ...oppositeCatalog.map((entry) => entry.name),
  ]);
  const start = markerMatches(source, EXPORTS_START);
  const end = markerMatches(source, EXPORTS_END);

  if (start.length || end.length) {
    if (start.length !== 1 || end.length !== 1 || start[0].index >= end[0].index)
      fail(
        "The managed progressive-blur export block is duplicated or damaged; edit index.ts manually.",
      );
    const startEnd = start[0].index + start[0][0].length;
    const body = source.slice(startEnd, end[0].index);
    const managedEntries = [];
    for (const rawLine of body.split(/\r?\n/)) {
      const trimmed = rawLine.trim();
      if (!trimmed) continue;
      if (oppositeByLine.has(trimmed))
        fail(
          "This directory already contains another framework. Choose a separate --dir.",
        );
      const entry = currentByLine.get(trimmed);
      if (!entry)
        fail(
          "The managed progressive-blur export block contains unrecognized code; edit index.ts manually.",
        );
      managedEntries.push(entry);
    }
    assertReferencedFiles(output, managedEntries, plannedFiles);
    const merged = [
      ...managedEntries.map((entry) => entry.line),
      ...exportLines(framework, selected),
    ];
    const endHasNewline = end[0][0].endsWith("\n");
    const replacement = buildManagedBlock(framework, merged, source, endHasNewline);
    const endPosition = end[0].index + end[0][0].length;
    return `${source.slice(0, start[0].index)}${replacement}${source.slice(endPosition)}`;
  }

  const allByLine = new Map([
    ...currentCatalog.map((entry) => [entry.line, entry]),
    ...oppositeCatalog.map((entry) => [entry.line, entry]),
  ]);
  const migrated = [];
  let preserved = "";
  const linePattern = /([^\r\n]*)(\r\n|\n|$)/g;
  for (const match of source.matchAll(linePattern)) {
    if (!match[0]) break;
    const rawLine = match[1];
    const trimmed = rawLine.trim();
    if (oppositeByLine.has(trimmed))
      fail(
        "This directory already contains another framework. Choose a separate --dir.",
      );
    const entry = allByLine.get(trimmed);
    if (entry) {
      if (oppositeCatalog.some((candidate) => candidate.line === entry.line))
        fail(
          "This directory already contains another framework. Choose a separate --dir.",
        );
      migrated.push(entry);
      continue;
    }
    if (/^\s*export\b/.test(rawLine)) {
      const conflictingName = [...allNames].find((name) =>
        new RegExp(
          `\\b${name.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\b`,
        ).test(rawLine),
      );
      if (conflictingName)
        fail(
          `index.ts contains a conflicting export named ${conflictingName}; edit it manually.`,
        );
    }
    preserved += match[0];
  }
  const currentMigrated = migrated.filter((entry) => currentByLine.has(entry.line));
  assertReferencedFiles(output, currentMigrated, plannedFiles);
  const merged = [
    ...currentMigrated.map((entry) => entry.line),
    ...exportLines(framework, selected),
  ];
  const eol = lineEnding(source);
  const prefix = preserved && !preserved.endsWith("\n") ? `${preserved}${eol}` : preserved;
  return `${prefix}${buildManagedBlock(framework, merged, source, true)}`;
}

function parsePackageManager(manifest, cwd, allowUnknown) {
  let name;
  if (manifest.packageManager !== undefined) {
    if (typeof manifest.packageManager !== "string")
      fail("packageManager must be a string such as npm@10 or pnpm@9.");
    const match = manifest.packageManager.match(
      /^([A-Za-z][A-Za-z0-9_-]*)(?:@.+)?$/,
    );
    if (!match) fail(`Invalid packageManager: ${manifest.packageManager}`);
    name = match[1];
  } else {
    const found = lockfiles.filter(([file]) => readPathInfo(resolve(cwd, file)));
    const managers = [...new Set(found.map(([, manager]) => manager))];
    if (managers.length > 1)
      fail(
        "Multiple lockfiles found. Set packageManager in package.json to choose the package manager.",
      );
    name = managers[0] ?? "npm";
  }
  const supported = supportedPackageManagers.includes(name);
  if (!supported && !allowUnknown)
    fail(
      `Unsupported package manager ${name}. Set packageManager to npm, pnpm, yarn, or bun.`,
    );
  return {
    name,
    supported,
    executable: packageManagerExecutable(name),
  };
}

export function packageManagerExecutable(name, platform = process.platform) {
  return platform === "win32" ? `${name}.cmd` : name;
}

function readInstalledRuntime(cwd) {
  const path = resolve(cwd, "node_modules", PACKAGE_NAME, "package.json");
  try {
    const manifest = JSON.parse(readFileSync(path, "utf8"));
    return {
      version: typeof manifest.version === "string" ? manifest.version : undefined,
    };
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    return { error: `Cannot read installed ${PACKAGE_NAME}: ${error.message}` };
  }
}

function rangeMeetsMinimum(spec) {
  const range = semver.validRange(spec);
  return Boolean(range && semver.satisfies(minimumRuntimeVersion, range));
}

function installedMeetsMinimum(installed) {
  if (!installed) return false;
  if (installed.error) fail(installed.error);
  if (!installed.version || !semver.valid(installed.version))
    fail(`Installed ${PACKAGE_NAME} has an invalid version.`);
  if (semver.lt(installed.version, minimumRuntimeVersion))
    fail(
      `Installed ${PACKAGE_NAME}@${installed.version} is below the minimum compatible version ${minimumRuntimeVersion}. Upgrade it before generating components.`,
    );
  return true;
}

function formatInstallArgs(manager, spec, moveToDependencies = false) {
  return manager === "npm"
    ? ["install", ...(moveToDependencies ? ["--save"] : []), spec]
    : ["add", spec];
}

function planDependency({ manifest, cwd, manager, noInstall, dryRun }) {
  const dependencies = manifest.dependencies ?? {};
  const devDependencies = manifest.devDependencies ?? {};
  const declared = hasOwn(dependencies, PACKAGE_NAME)
    ? { section: "dependencies", spec: dependencies[PACKAGE_NAME] }
    : hasOwn(devDependencies, PACKAGE_NAME)
      ? { section: "devDependencies", spec: devDependencies[PACKAGE_NAME] }
      : undefined;
  const installed = readInstalledRuntime(cwd);
  const warnings = [];

  if (declared) {
    const special =
      typeof declared.spec !== "string" || !semver.validRange(declared.spec);
    if (special) {
      if (installed) installedMeetsMinimum(installed);
      warnings.push(
        `${PACKAGE_NAME} uses a non-registry dependency (${String(declared.spec)}); it was preserved. Confirm that it provides API ${minimumRuntimeVersion} or newer.`,
      );
      return { action: undefined, warnings };
    }
    if (!rangeMeetsMinimum(declared.spec))
      fail(
        `Declared ${PACKAGE_NAME}@${declared.spec} is below the minimum compatible version ${minimumRuntimeVersion}. Update the project dependency before generating components.`,
      );
    const installedOkay = installed ? installedMeetsMinimum(installed) : false;
    const needsInstall = !installedOkay || declared.section === "devDependencies";
    if (!needsInstall) return { action: undefined, warnings };
    const action = {
      spec: `${PACKAGE_NAME}@${declared.spec}`,
      moveToDependencies: declared.section === "devDependencies",
    };
    if (noInstall || dryRun) {
      warnings.push(
        action.moveToDependencies
          ? `Runtime is declared in devDependencies; move it to dependencies with ${manager.name} ${formatInstallArgs(manager.name, action.spec, true).join(" ")}.`
          : `Runtime is declared but not installed; run ${manager.name} ${formatInstallArgs(manager.name, action.spec).join(" ")}.`,
      );
      return { action, warnings };
    }
    return { action, warnings };
  }

  const action = { spec: runtimeSpec, moveToDependencies: false };
  if (noInstall || dryRun) {
    warnings.push(`Dependency not installed. Ensure your project has ${action.spec}.`);
    return { action, warnings };
  }
  return { action, warnings };
}

function validatePlanManager(manager, action, noInstall, dryRun) {
  if (action && !manager.supported && !noInstall && !dryRun)
    fail(
      `Unsupported package manager ${manager.name}. No files were written; install ${action.spec} manually.`,
    );
}

function createPlan(parsed, cwd) {
  const { manifest } = readProjectManifest(cwd);
  const framework = detectFramework(manifest, parsed.framework);
  const { output, relative: relativeOutput } = resolveOutputDirectory(
    cwd,
    parsed.directory,
  );
  assertDirectoryChain(cwd, relativeOutput);
  assertNoOppositeFramework(output, framework);

  const fileContents = templates(framework, parsed.selected);
  const plannedFiles = new Set([...Object.keys(fileContents), "index.ts"]);
  for (const name of plannedFiles) assertOutputFile(resolve(output, name));

  const indexPath = resolve(output, "index.ts");
  const indexInfo = readPathInfo(indexPath);
  const indexSource = indexInfo ? readFileSync(indexPath, "utf8") : "";
  const mergedIndex = managedIndex(
    indexSource,
    framework,
    parsed.selected,
    output,
    plannedFiles,
  );

  const manager = parsePackageManager(
    manifest,
    cwd,
    parsed.noInstall || parsed.dryRun,
  );
  const dependency = planDependency({
    manifest,
    cwd,
    manager,
    noInstall: parsed.noInstall,
    dryRun: parsed.dryRun,
  });
  validatePlanManager(
    manager,
    dependency.action,
    parsed.noInstall,
    parsed.dryRun,
  );
  return {
    ...parsed,
    cwd,
    framework,
    output,
    relativeOutput,
    fileContents,
    plannedFiles,
    indexPath,
    indexSource,
    mergedIndex,
    manager,
    dependency,
  };
}

function writeAtomic(target, content) {
  let temporary;
  while (!temporary) {
    const candidate = `${target}.tmp-${process.pid}-${temporaryFileCounter++}`;
    try {
      writeFileSync(candidate, content, { encoding: "utf8", flag: "wx" });
      temporary = candidate;
    } catch (error) {
      if (error?.code === "EEXIST") continue;
      throw error;
    }
  }
  try {
    const current = readPathInfo(target);
    if (current && (current.isSymbolicLink() || !current.isFile()))
      fail(`Refusing non-regular output file: ${target}`);
    try {
      renameSync(temporary, target);
    } catch (error) {
      if (error?.code !== "EEXIST" && error?.code !== "EPERM") throw error;
      unlinkSync(target);
      renameSync(temporary, target);
    }
  } catch (error) {
    try {
      unlinkSync(temporary);
    } catch {
      // Keep the original write error.
    }
    throw error;
  }
}

function writePlan(plan) {
  if (plan.dryRun) {
    const messages = [
      `Framework: ${plan.framework}`,
      `Directory: ${plan.relativeOutput}`,
    ];
    for (const name of Object.keys(plan.fileContents)) {
      messages.push(
        readPathInfo(resolve(plan.output, name))
          ? `Would keep: ${name}`
          : `Would add: ${name}`,
      );
    }
    messages.push(
      plan.indexSource === plan.mergedIndex
        ? "Would keep: index.ts"
        : "Would update: index.ts",
    );
    if (plan.dependency.action)
      messages.push(
        `Would run: ${plan.manager.name} ${formatInstallArgs(plan.manager.name, plan.dependency.action.spec, plan.dependency.action.moveToDependencies).join(" ")}`,
      );
    messages.push(...plan.dependency.warnings);
    messages.push("Dry run: no files written and no package manager invoked.");
    return messages;
  }

  const written = [];
  const writeKinds = new Map();
  try {
    mkdirSync(plan.output, { recursive: true });
    assertDirectoryChain(plan.cwd, plan.relativeOutput);
    for (const [name, content] of Object.entries(plan.fileContents)) {
      const target = resolve(plan.output, name);
      const exists = Boolean(readPathInfo(target));
      if (exists && !plan.force) continue;
      writeAtomic(target, content);
      written.push(name);
      writeKinds.set(name, exists ? "Overwrote" : "Added");
    }
    if (plan.indexSource !== plan.mergedIndex) {
      const existed = Boolean(readPathInfo(plan.indexPath));
      writeAtomic(plan.indexPath, plan.mergedIndex);
      written.push("index.ts");
      writeKinds.set("index.ts", existed ? "Updated" : "Added");
    }
  } catch (error) {
    fail(
      `${error.message} Files written before failure: ${written.length ? written.join(", ") : "none"}.`,
    );
  }

  const messages = [
    `Framework: ${plan.framework}`,
    `Directory: ${plan.relativeOutput}`,
  ];
  for (const name of Object.keys(plan.fileContents)) {
    messages.push(
      written.includes(name)
        ? `${writeKinds.get(name)}: ${name}`
        : `Kept: ${name}`,
    );
  }
  messages.push(
    written.includes("index.ts")
      ? `${writeKinds.get("index.ts")}: index.ts`
      : "Kept: index.ts",
  );
  if (plan.force)
    messages.push(
      "Warning: --force may overwrite shared lifecycle.ts/layout.ts used by other generated components in this directory.",
    );

  if (plan.dependency.action && !plan.noInstall) {
    const args = formatInstallArgs(
      plan.manager.name,
      plan.dependency.action.spec,
      plan.dependency.action.moveToDependencies,
    );
    if (!plan.manager.supported) {
      messages.push(...plan.dependency.warnings);
    } else {
      const result = plan.install(plan.manager.executable, args, {
        cwd: plan.cwd,
        stdio: "inherit",
        shell: false,
      });
      if (result?.error || result?.status !== 0)
        fail(
          `Components were added, but dependency installation failed using ${plan.manager.name}. Files written: ${written.join(", ") || "none"}. Retry with ${plan.manager.name} ${args.join(" ")}.`,
        );
      if (plan.dependency.action.moveToDependencies) {
        const updated = readProjectManifest(plan.cwd).manifest;
        if (
          !hasOwn(updated.dependencies ?? {}, PACKAGE_NAME) ||
          hasOwn(updated.devDependencies ?? {}, PACKAGE_NAME)
        )
          fail(
            `Package manager ${plan.manager.name} did not move ${PACKAGE_NAME} to dependencies. Files written: ${written.join(", ") || "none"}.`,
          );
      }
      messages.push(`Installed: ${plan.dependency.action.spec}`);
    }
  } else {
    messages.push(...plan.dependency.warnings);
  }
  messages.push(
    "Import components from the generated directory. Keep the background behind the component; do not clip its fade extension.",
  );
  return messages;
}

export function addComponents(args, cwd = process.cwd(), install = spawnSync) {
  const parsed = parseArguments(args);
  if (parsed.help) return HELP;
  const plan = createPlan(parsed, cwd);
  plan.install = install;
  return writePlan(plan);
}

function isInvokedDirectly() {
  if (!process.argv[1]) return false;
  try {
    return (
      realpathSync(process.argv[1]) ===
      realpathSync(fileURLToPath(import.meta.url))
    );
  } catch {
    return false;
  }
}

if (isInvokedDirectly()) {
  try {
    console.log(addComponents(process.argv.slice(2)).join("\n"));
  } catch (error) {
    console.error(
      `[progressive-blur] ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
