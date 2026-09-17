import { afterEach, describe, expect, it } from "vitest";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  addComponents,
  packageManagerExecutable,
  packageVersion,
} from "../cli/index.mjs";
import { templates } from "../cli/templates.mjs";

const roots: string[] = [];

function project(options: {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  packageManager?: string;
  source?: boolean;
  manifest?: Record<string, unknown>;
} = {}) {
  const root = mkdtempSync(join(tmpdir(), "blur-cli-"));
  roots.push(root);
  const manifest = options.manifest ?? {
    dependencies: options.dependencies ?? { react: "^19.0.0" },
    ...(options.devDependencies
      ? { devDependencies: options.devDependencies }
      : {}),
    ...(options.packageManager
      ? { packageManager: options.packageManager }
      : {}),
  };
  writeFileSync(join(root, "package.json"), JSON.stringify(manifest, null, 2));
  if (options.source !== false) mkdirSync(join(root, "src"));
  return root;
}

function output(root: string, directory = "src/components/progressive_blur") {
  return join(root, directory);
}

function installRuntime(root: string, version = minimumVersion()) {
  mkdirSync(join(root, "node_modules/webgpu-progressive-blur"), {
    recursive: true,
  });
  writeFileSync(
    join(root, "node_modules/webgpu-progressive-blur/package.json"),
    JSON.stringify({ name: "webgpu-progressive-blur", version }),
  );
}

function minimumVersion() {
  return "0.1.1";
}

afterEach(() => {
  roots.splice(0).forEach((root) =>
    rmSync(root, { recursive: true, force: true }),
  );
});

describe("source component CLI", () => {
  it("adds all React presets by default and creates a managed index", () => {
    const root = project();
    addComponents(["add", "--no-install"], root);
    expect(
      readdirSync(output(root)).filter((name) => name.endsWith(".tsx")),
    ).toHaveLength(7);
    const index = readFileSync(join(output(root), "index.ts"), "utf8");
    expect(index).toContain("// progressive-blur:exports:start");
    expect(index).toContain("ProgressiveBlurNavbar");
    expect(index).toContain("// progressive-blur:exports:end");
  });

  it("adds only requested Astro components and detects Astro before React", () => {
    const root = project({ dependencies: { astro: "^5.0.0", react: "^19.0.0" } });
    addComponents(["add", "navbar", "navbar", "--no-install"], root);
    expect(
      readdirSync(output(root))
        .filter((name) => name.endsWith(".astro"))
        .sort(),
    ).toEqual(["progressive-blur-navbar.astro", "progressive-blur.astro"]);
    expect(readFileSync(join(output(root), "index.ts"), "utf8")).toContain(
      "default as ProgressiveBlurNavbar",
    );
    expect(
      readFileSync(join(output(root), "progressive-blur-navbar.astro"), "utf8"),
    ).toContain("placement=\"top\"");
  });

  it("preserves edits, merges exports, and force only replaces this batch", () => {
    const root = project();
    addComponents(["add", "navbar", "--no-install"], root);
    const file = join(output(root), "progressive-blur-navbar.tsx");
    writeFileSync(file, "// user code");
    addComponents(["add", "navbar", "sidebar", "--no-install"], root);
    expect(readFileSync(file, "utf8")).toBe("// user code");
    const index = readFileSync(join(output(root), "index.ts"), "utf8");
    expect(index.match(/ProgressiveBlurNavbar/g)).toHaveLength(1);
    expect(index).toContain("ProgressiveBlurSidebar");
    const messages = addComponents(
      ["add", "navbar", "--no-install", "--force"],
      root,
    );
    expect(readFileSync(file, "utf8")).toContain("forwardRef");
    expect(messages.join("\n")).toContain("shared lifecycle.ts/layout.ts");
  });

  it("supports a custom space and Unicode directory and refuses framework mixing", () => {
    const root = project();
    const custom = "组件 exports/blur";
    addComponents(
      [
        "add",
        "panel",
        "--framework",
        "astro",
        "--dir",
        custom,
        "--no-install",
      ],
      root,
    );
    expect(lstatSync(output(root, custom)).isDirectory()).toBe(true);
    expect(() =>
      addComponents(
        [
          "add",
          "navbar",
          "--framework",
          "react",
          "--dir",
          custom,
          "--no-install",
        ],
        root,
      ),
    ).toThrow(/another framework/);
  });

  it("uses components when src is absent", () => {
    const root = project({ source: false });
    addComponents(["add", "panel", "--no-install"], root);
    expect(lstatSync(output(root, "components/progressive_blur")).isDirectory()).toBe(
      true,
    );
  });

  it.each([
    ["add", "unknown"],
    ["add", "--framework", "vue"],
    ["add", "--dir"],
    ["add", "--dir", "../outside"],
    ["add", "--dir", "."],
    ["add", "--dir", "a/../b"],
    ["add", "--dry-run", "--dry-run"],
    ["add", "--framework", "react", "--framework", "astro"],
  ])("rejects invalid arguments before creating files: %j", (...args) => {
    const root = project();
    expect(() => addComponents(args, root)).toThrow();
    expect(readdirSync(join(root, "src"))).toEqual([]);
  });

  it("rejects a missing or malformed manifest without writing", () => {
    const root = mkdtempSync(join(tmpdir(), "blur-cli-"));
    roots.push(root);
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "package.json"), "{\n");
    expect(() => addComponents(["add", "--no-install"], root)).toThrow(
      /Invalid package.json/,
    );
    expect(readdirSync(join(root, "src"))).toEqual([]);
  });

  it("does not follow regular, dangling, or file output paths", () => {
    const root = project();
    mkdirSync(join(root, "src/components"), { recursive: true });
    symlinkSync(tmpdir(), join(root, "src/components/progressive_blur"));
    expect(() => addComponents(["add", "--no-install"], root)).toThrow(
      /regular directory/,
    );

    const dangling = project();
    mkdirSync(join(dangling, "src/components"), { recursive: true });
    symlinkSync(
      join(dangling, "missing-target"),
      join(dangling, "src/components/progressive_blur"),
    );
    expect(() => addComponents(["add", "--no-install"], dangling)).toThrow(
      /regular directory/,
    );

    const file = project();
    mkdirSync(join(file, "src/components"), { recursive: true });
    writeFileSync(join(file, "src/components/progressive_blur"), "not a dir");
    expect(() => addComponents(["add", "--no-install"], file)).toThrow(
      /regular directory/,
    );

    const srcLink = project();
    rmSync(join(srcLink, "src"), { recursive: true, force: true });
    symlinkSync(tmpdir(), join(srcLink, "src"));
    expect(() => addComponents(["add", "--no-install"], srcLink)).toThrow(
      /src path/,
    );
  });

  it("dry-runs with zero writes and zero package-manager calls", () => {
    const root = project();
    const calls: unknown[][] = [];
    const messages = addComponents(["add", "navbar", "--dry-run"], root, (...args) => {
      calls.push(args);
      return { status: 0 };
    });
    expect(messages.join("\n")).toContain("Would add");
    expect(messages.join("\n")).toContain(`webgpu-progressive-blur@${packageVersion}`);
    expect(calls).toHaveLength(0);
    expect(readdirSync(join(root, "src"))).toEqual([]);
  });

  it("selects the declared package manager and uses an exact runtime version", () => {
    const root = project();
    writeFileSync(join(root, "pnpm-lock.yaml"), "lockfileVersion: 9");
    const calls: unknown[][] = [];
    addComponents(["add", "navbar"], root, (...args) => {
      calls.push(args);
      return { status: 0 };
    });
    expect(calls[0].slice(0, 2)).toEqual([
      "pnpm",
      ["add", `webgpu-progressive-blur@${packageVersion}`],
    ]);
  });

  it("allows unknown package managers only for dry-run/no-install and rejects them before writing otherwise", () => {
    const root = project({ packageManager: "custompm@1" });
    const dryRun = addComponents(["add", "panel", "--dry-run"], root);
    expect(dryRun.join("\n")).toContain("custompm");
    expect(() => addComponents(["add", "panel"], root)).toThrow(
      /Unsupported package manager/,
    );
    expect(readdirSync(join(root, "src"))).toEqual([]);
  });

  it("rejects multiple lockfiles before creating the output", () => {
    const root = project();
    writeFileSync(join(root, "package-lock.json"), "{}");
    writeFileSync(join(root, "yarn.lock"), "");
    expect(() => addComponents(["add", "panel"], root)).toThrow(/Multiple lockfiles/);
    expect(readdirSync(join(root, "src"))).toEqual([]);
  });

  it("keeps a compatible production runtime without silently upgrading it", () => {
    const root = project({ dependencies: { react: "^19.0.0", ["webgpu-progressive-blur"]: ">=0.1.0" } });
    installRuntime(root);
    const calls: unknown[][] = [];
    addComponents(["add", "navbar"], root, (...args) => {
      calls.push(args);
      return { status: 0 };
    });
    expect(calls).toHaveLength(0);
  });

  it.each([
    ["0.2.0", "0.2.0"],
    ["^0.2.0", "0.2.0"],
    ["^0.1.2", "0.1.2"],
  ])("accepts compatible installed runtime %s", (declared, installed) => {
    const root = project({
      dependencies: {
        react: "^19.0.0",
        ["webgpu-progressive-blur"]: declared,
      },
    });
    installRuntime(root, installed);
    expect(() => addComponents(["add", "panel", "--no-install"], root)).not.toThrow();
  });

  it.each(["0.2.0", "^0.2.0", "^0.1.2"])(
    "accepts a compatible declared runtime %s before installation",
    (declared) => {
      const root = project({
        dependencies: {
          react: "^19.0.0",
          ["webgpu-progressive-blur"]: declared,
        },
      });
      expect(() => addComponents(["add", "panel", "--no-install"], root)).not.toThrow();
    },
  );

  it("allows adding another preset after the first install", () => {
    const root = project();
    const calls: unknown[][] = [];
    const installer = (...args: unknown[]) => {
      calls.push(args);
      const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
      manifest.dependencies["webgpu-progressive-blur"] = `^${packageVersion}`;
      writeFileSync(join(root, "package.json"), JSON.stringify(manifest, null, 2));
      installRuntime(root, packageVersion);
      return { status: 0 };
    };

    addComponents(["add", "navbar"], root, installer);
    expect(() => addComponents(["add", "sidebar"], root, installer)).not.toThrow();
    expect(calls).toHaveLength(1);
    expect(lstatSync(join(output(root), "progressive-blur-sidebar.tsx")).isFile()).toBe(
      true,
    );
  });

  it("moves a compatible dev runtime to production dependencies and verifies the move", () => {
    const root = project({
      dependencies: { react: "^19.0.0" },
      devDependencies: { ["webgpu-progressive-blur"]: "^0.1.1" },
    });
    installRuntime(root);
    const calls: unknown[][] = [];
    const installer = (...args: unknown[]) => {
      calls.push(args);
      const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
      manifest.dependencies["webgpu-progressive-blur"] = "^0.1.1";
      delete manifest.devDependencies["webgpu-progressive-blur"];
      writeFileSync(join(root, "package.json"), JSON.stringify(manifest, null, 2));
      return { status: 0 };
    };
    const messages = addComponents(["add", "navbar"], root, installer);
    expect(calls[0].slice(0, 2)).toEqual([
      "npm",
      ["install", "--save", "webgpu-progressive-blur@^0.1.1"],
    ]);
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    expect(manifest.dependencies["webgpu-progressive-blur"]).toBe("^0.1.1");
    expect(manifest.devDependencies?.["webgpu-progressive-blur"]).toBeUndefined();
    expect(messages.join("\n")).toContain(
      "Installed: webgpu-progressive-blur@^0.1.1",
    );
  });

  it("stops on a runtime below the minimum before writing", () => {
    const root = project({ dependencies: { react: "^19.0.0", ["webgpu-progressive-blur"]: "^0.1.0" } });
    installRuntime(root, "0.1.0");
    expect(() => addComponents(["add", "panel", "--no-install"], root)).toThrow(
      /below the minimum|below the minimum compatible/,
    );
    expect(readdirSync(join(root, "src"))).toEqual([]);
  });

  it("reports installation failure without deleting generated files", () => {
    const root = project();
    expect(() =>
      addComponents(["add", "navbar"], root, () => ({ status: 1 })),
    ).toThrow(/Files written: .*progressive-blur-navbar\.tsx.*Retry with/);
    expect(lstatSync(join(output(root), "progressive-blur-navbar.tsx")).isFile()).toBe(
      true,
    );
  });

  it("migrates exact legacy exports and rejects ambiguous or damaged indexes", () => {
    const root = project();
    const dir = output(root);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "progressive-blur.tsx"),
      "export const legacyBase = true;",
    );
    writeFileSync(
      join(dir, "progressive-blur-navbar.tsx"),
      "export const legacyNavbar = true;",
    );
    writeFileSync(
      join(dir, "index.ts"),
      "// keep this code\nexport { ProgressiveBlur } from './progressive-blur';\nexport { ProgressiveBlurNavbar } from './progressive-blur-navbar';\n",
    );
    addComponents(["add", "navbar", "--no-install"], root);
    const migrated = readFileSync(join(dir, "index.ts"), "utf8");
    expect(migrated).toContain("// keep this code");
    expect(migrated).toContain("// progressive-blur:exports:start");
    expect(migrated.match(/ProgressiveBlurNavbar/g)).toHaveLength(1);

    const conflict = project();
    mkdirSync(output(conflict), { recursive: true });
    writeFileSync(join(output(conflict), "index.ts"), "export const ProgressiveBlurNavbar = userCode;\n");
    expect(() => addComponents(["add", "navbar", "--no-install"], conflict)).toThrow(
      /conflicting export/,
    );
    expect(readdirSync(join(conflict, "src"))).toEqual(["components"]);
    expect(readdirSync(output(conflict))).toEqual(["index.ts"]);

    const damaged = project();
    mkdirSync(output(damaged), { recursive: true });
    writeFileSync(join(output(damaged), "index.ts"), `${"// progressive-blur:exports:start\n".repeat(2)}// progressive-blur:exports:end\n`);
    expect(() => addComponents(["add", "navbar", "--no-install"], damaged)).toThrow(
      /duplicated or damaged/,
    );
    expect(readdirSync(output(damaged))).toEqual(["index.ts"]);
  });

  it("does not treat comments as existing exports and exposes Windows shims", () => {
    const root = project();
    const dir = output(root);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "index.ts"), "// ProgressiveBlurNavbar is documented here\n");
    addComponents(["add", "navbar", "--no-install"], root);
    expect(readFileSync(join(dir, "index.ts"), "utf8")).toMatch(
      /export \{ ProgressiveBlurNavbar \}/,
    );
    expect(packageManagerExecutable("npm", "win32")).toBe("npm.cmd");
    expect(packageManagerExecutable("pnpm", "win32")).toBe("pnpm.cmd");
  });

  it("works through a symlink to the CLI entry point", () => {
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

  it("uses the scoped package identity in generated runtime imports", () => {
    for (const framework of ["react", "astro"] as const) {
      const files = templates(framework, ["navbar"], "@lliooly/webgpu-progressive-blur");
      const source = Object.values(files).join("\n");
      expect(source).toContain("@lliooly/webgpu-progressive-blur/dom");
      expect(source).not.toContain("__PROGRESSIVE_BLUR_PACKAGE__");
    }
  });
});
