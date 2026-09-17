import { afterEach, describe, expect, it } from "vitest";
import {
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
// @ts-expect-error The executable CLI is intentionally plain Node.js ESM.
import { addComponents } from "../cli/index.mjs";
const roots: string[] = [];
function project(dependencies: Record<string, string> = { react: "^19.0.0" }) {
  const root = mkdtempSync(join(tmpdir(), "blur-cli-"));
  roots.push(root);
  writeFileSync(join(root, "package.json"), JSON.stringify({ dependencies }));
  mkdirSync(join(root, "src"));
  return root;
}
afterEach(() => {
  roots
    .splice(0)
    .forEach((root) => rmSync(root, { recursive: true, force: true }));
});
const directory = (root: string) =>
  join(root, "src/components/progressive_blur");
describe("source component CLI", () => {
  it("adds all React presets by default", () => {
    const root = project();
    addComponents(["add", "--no-install"], root);
    expect(
      readdirSync(directory(root)).filter((name) => name.endsWith(".tsx")),
    ).toHaveLength(7);
    expect(readFileSync(join(directory(root), "index.ts"), "utf8")).toContain(
      "ProgressiveBlurNavbar",
    );
  });
  it("adds only requested Astro components and detects Astro before React", () => {
    const root = project({ astro: "^5.0.0", react: "^19.0.0" });
    addComponents(["add", "navbar", "--no-install"], root);
    expect(
      readdirSync(directory(root)).filter((name) => name.endsWith(".astro")),
    ).toEqual(["progressive-blur-navbar.astro", "progressive-blur.astro"]);
    expect(readFileSync(join(directory(root), "index.ts"), "utf8")).toContain(
      "default as ProgressiveBlurNavbar",
    );
  });
  it("preserves edits and merges exports when adding another preset", () => {
    const root = project();
    addComponents(["add", "navbar", "--no-install"], root);
    const file = join(directory(root), "progressive-blur-navbar.tsx");
    writeFileSync(file, "// user code");
    addComponents(["add", "navbar", "sidebar", "--no-install"], root);
    expect(readFileSync(file, "utf8")).toBe("// user code");
    const index = readFileSync(join(directory(root), "index.ts"), "utf8");
    expect(index.match(/ProgressiveBlurNavbar/g)).toHaveLength(1);
    expect(index).toContain("ProgressiveBlurSidebar");
    addComponents(["add", "navbar", "--no-install", "--force"], root);
    expect(readFileSync(file, "utf8")).toContain(
      "export function ProgressiveBlurNavbar",
    );
  });
  it("supports a custom directory and refuses framework mixing", () => {
    const root = project();
    addComponents(
      [
        "add",
        "panel",
        "--framework",
        "astro",
        "--dir",
        "components/blur",
        "--no-install",
      ],
      root,
    );
    expect(() =>
      addComponents(
        [
          "add",
          "navbar",
          "--framework",
          "react",
          "--dir",
          "components/blur",
          "--no-install",
        ],
        root,
      ),
    ).toThrow(/another framework/);
  });
  it.each([
    ["add", "unknown"],
    ["add", "--framework", "vue"],
    ["add", "--dir"],
    ["add", "--dir", "../outside"],
  ])("rejects invalid arguments before creating files: %j", (...args) => {
    const root = project();
    expect(() => addComponents(args, root)).toThrow();
    expect(readdirSync(join(root, "src"))).toEqual([]);
  });
  it("does not follow output symlinks", () => {
    const root = project();
    symlinkSync(tmpdir(), join(root, "src/components"));
    expect(() => addComponents(["add", "--no-install"], root)).toThrow(
      /regular directory/,
    );
  });
  it("installs the runtime using the project package manager", () => {
    const root = project();
    writeFileSync(join(root, "pnpm-lock.yaml"), "");
    const calls: unknown[][] = [];
    addComponents(["add", "navbar"], root, (...args: unknown[]) => {
      calls.push(args);
      return { status: 0 };
    });
    expect(calls[0].slice(0, 2)).toEqual([
      "pnpm",
      ["add", "webgpu-progressive-blur@^0.1.1"],
    ]);
  });
  it("works through a package-manager executable symlink", () => {
    const root = project();
    const bin = join(root, "blur-cli");
    symlinkSync(resolve("cli/index.mjs"), bin);
    const result = spawnSync(
      process.execPath,
      [bin, "add", "navbar", "--no-install"],
      { cwd: root, encoding: "utf8" },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Added: progressive-blur-navbar.tsx");
  });
});
