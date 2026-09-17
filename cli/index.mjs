#!/usr/bin/env node
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  lstatSync,
  realpathSync,
} from "node:fs";
import { resolve, relative, dirname, isAbsolute, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { presets, templates, exportLines } from "./templates.mjs";

const runtime = "webgpu-progressive-blur@^0.1.1";
export function addComponents(args, cwd = process.cwd(), install = spawnSync) {
  if (!args.length || args.includes("--help") || args.includes("-h")) {
    return [
      "Usage: webgpu-progressive-blur add [navbar sidebar bottom-bar caption edge panel]",
      "Options: --framework react|astro --dir <directory> --no-install --force",
      "No names: add all six presets. Existing source files are kept unless --force is provided.",
    ];
  }
  if (args[0] !== "add") throw new Error("Unknown command. Use add or --help.");
  let framework, directory;
  let shouldInstall = true,
    force = false;
  const names = [];
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--framework" || arg === "--dir") {
      const value = args[++i];
      if (!value || value.startsWith("--"))
        throw new Error(`Missing value for ${arg}.`);
      if (arg === "--framework") framework = value;
      else directory = value;
    } else if (arg === "--no-install") shouldInstall = false;
    else if (arg === "--force") force = true;
    else if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}`);
    else names.push(arg);
  }
  if (framework && !["react", "astro"].includes(framework))
    throw new Error("Only React and Astro are supported.");
  const selected = [...new Set(names.length ? names : presets)];
  for (const name of selected)
    if (!presets.includes(name))
      throw new Error(
        `Unknown preset: ${name}. Available: ${presets.join(", ")}`,
      );
  const manifestPath = resolve(cwd, "package.json");
  if (!existsSync(manifestPath))
    throw new Error(
      "Run this command in your project directory containing package.json.",
    );
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const dependencies = {
    ...manifest.devDependencies,
    ...manifest.dependencies,
  };
  framework ??= dependencies.astro
    ? "astro"
    : dependencies.react
      ? "react"
      : undefined;
  if (!framework)
    throw new Error(
      "Cannot detect framework. Specify --framework react or --framework astro.",
    );
  const output = resolve(
    cwd,
    directory ??
      `${existsSync(resolve(cwd, "src")) ? "src/" : ""}components/progressive_blur`,
  );
  const rel = relative(resolve(cwd), output);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))
    throw new Error("--dir must be a subdirectory of the current project.");
  // Do not follow output symlinks, even with --force.
  let path = resolve(cwd);
  for (const part of rel.split(sep)) {
    path = resolve(path, part);
    if (
      existsSync(path) &&
      (lstatSync(path).isSymbolicLink() || !lstatSync(path).isDirectory())
    )
      throw new Error(`Output path is not a regular directory: ${path}`);
  }
  const opposite = framework === "react" ? "astro" : "tsx";
  if (existsSync(resolve(output, `progressive-blur.${opposite}`)))
    throw new Error(
      "This directory already contains another framework. Choose a separate --dir.",
    );
  const files = templates(framework, selected);
  // Preflight every path before writing any file.
  for (const name of [...Object.keys(files), "index.ts"]) {
    const target = resolve(output, name);
    if (
      existsSync(target) &&
      (lstatSync(target).isSymbolicLink() || !lstatSync(target).isFile())
    )
      throw new Error(`Refusing non-regular output file: ${target}`);
  }
  const indexPath = resolve(output, "index.ts");
  let index = existsSync(indexPath) ? readFileSync(indexPath, "utf8") : "";
  for (const line of exportLines(framework, selected)) {
    const name = (line.match(/\bas (\w+)/) ?? line.match(/\{ (\w+)/))?.[1];
    if (!name || !new RegExp(`\\b${name}\\b`).test(index))
      index += `${index && !index.endsWith("\n") ? "\n" : ""}${line}\n`;
  }
  const messages = [`Framework: ${framework}`, `Directory: ${rel}`];
  mkdirSync(output, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    const target = resolve(output, name);
    if (existsSync(target) && !force) messages.push(`Kept: ${name}`);
    else {
      writeFileSync(target, content);
      messages.push(`Added: ${name}`);
    }
  }
  writeFileSync(indexPath, index);
  if (shouldInstall && !manifest.dependencies?.["webgpu-progressive-blur"]) {
    const declared = manifest.packageManager?.split("@")[0];
    const manager =
      declared ??
      (existsSync(resolve(cwd, "pnpm-lock.yaml"))
        ? "pnpm"
        : existsSync(resolve(cwd, "yarn.lock"))
          ? "yarn"
          : existsSync(resolve(cwd, "bun.lock")) ||
              existsSync(resolve(cwd, "bun.lockb"))
            ? "bun"
            : "npm");
    if (!["npm", "pnpm", "yarn", "bun"].includes(manager))
      throw new Error(
        `Unsupported package manager ${manager}. Files were added; install ${runtime} manually.`,
      );
    const result = install(
      manager,
      [
        manager === "npm" ? "install" : "add",
        manifest.devDependencies?.["webgpu-progressive-blur"]
          ? `webgpu-progressive-blur@${manifest.devDependencies["webgpu-progressive-blur"]}`
          : runtime,
      ],
      { cwd, stdio: "inherit", shell: false },
    );
    if (result.error || result.status !== 0)
      throw new Error(
        `Components were added, but dependency installation failed. Run ${manager} ${manager === "npm" ? "install" : "add"} ${runtime}.`,
      );
  } else if (!shouldInstall)
    messages.push(
      `Dependency not installed. Ensure your project has ${runtime}.`,
    );
  messages.push(
    "Import components from the generated directory. Keep the background behind the component; do not clip its fade extension.",
  );
  return messages;
}

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    console.log(addComponents(process.argv.slice(2)).join("\n"));
  } catch (error) {
    console.error(`[progressive-blur] ${error.message}`);
    process.exitCode = 1;
  }
}
