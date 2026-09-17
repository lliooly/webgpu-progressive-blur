import { readFileSync } from "node:fs";

export const presets = Object.freeze([
  "navbar",
  "sidebar",
  "bottom-bar",
  "caption",
  "edge",
  "panel",
]);

export const presetDefinitions = Object.freeze({
  navbar: Object.freeze({ placements: ["top"], fixedPlacement: "top" }),
  sidebar: Object.freeze({ placements: ["left", "right"] }),
  "bottom-bar": Object.freeze({ placements: ["bottom"], fixedPlacement: "bottom" }),
  caption: Object.freeze({ placements: ["bottom", "top"] }),
  edge: Object.freeze({ placements: ["top", "right", "bottom", "left"] }),
  panel: Object.freeze({ placements: [], omitTransition: true }),
});

export const componentName = (name) =>
  "ProgressiveBlur" +
  name
    .split("-")
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join("");

function reactWrapper(name, preset) {
  const definition = presetDefinitions[preset];
  const omitted = ["preset", "placement"];
  if (definition.omitTransition) omitted.push("transition");
  const extendsType = `Omit<ProgressiveBlurProps, ${omitted
    .map((key) => `'${key}'`)
    .join(" | ")}>`;
  const placement =
    preset === "panel"
      ? ""
      : `  placement?: ${definition.placements.map((value) => `'${value}'`).join(" | ")};\n`;
  const fixedPlacement = definition.fixedPlacement
    ? ` placement="${definition.fixedPlacement}"`
    : "";
  return `'use client';\n\nimport { forwardRef } from 'react';\nimport { ProgressiveBlur, type ProgressiveBlurProps } from './progressive-blur';\n\nexport interface ${name}Props extends ${extendsType} {\n${placement}}\n\nexport const ${name} = forwardRef<HTMLDivElement, ${name}Props>(function ${name}(props, ref) {\n  return <ProgressiveBlur {...props} preset="${preset}"${fixedPlacement} ref={ref} />;\n});\n`;
}

function astroWrapper(name, preset) {
  const definition = presetDefinitions[preset];
  const omitted = ["preset", "placement"];
  if (definition.omitTransition) omitted.push("transition");
  const extendsType = `Omit<BaseProps, ${omitted
    .map((key) => `'${key}'`)
    .join(" | ")}>`;
  const placement =
    preset === "panel"
      ? ""
      : `  placement?: ${definition.placements.map((value) => `'${value}'`).join(" | ")};\n`;
  const fixedPlacement = definition.fixedPlacement
    ? ` placement="${definition.fixedPlacement}"`
    : "";
  const props = "const props = Astro.props;\n";
  return `---\nimport ProgressiveBlur, { type Props as BaseProps } from './progressive-blur.astro';\nexport interface Props extends ${extendsType} {\n${placement}}\n${props}---\n<ProgressiveBlur {...props} preset="${preset}"${fixedPlacement}><slot /></ProgressiveBlur>\n`;
}

export function templates(framework, selected) {
  const read = (path) =>
    readFileSync(new URL(`../templates/${path}`, import.meta.url), "utf8");
  const extension = framework === "react" ? "tsx" : "astro";
  const files = {
    "lifecycle.ts": read("shared/lifecycle.ts"),
    "layout.ts": read("shared/layout.ts"),
    [`progressive-blur.${extension}`]: read(
      `${framework}/progressive-blur.${extension}`,
    ),
  };
  for (const preset of selected) {
    const name = componentName(preset);
    files[`progressive-blur-${preset}.${extension}`] =
      framework === "react"
        ? reactWrapper(name, preset)
        : astroWrapper(name, preset);
  }
  return files;
}
export function exportLines(framework, selected) {
  return framework === "react"
    ? [
        "export { ProgressiveBlur } from './progressive-blur';",
        "export type { ProgressiveBlurProps } from './progressive-blur';",
        ...selected.map(
          (p) =>
            `export { ${componentName(p)} } from './progressive-blur-${p}';`,
        ),
      ]
    : [
        "export { default as ProgressiveBlur } from './progressive-blur.astro';",
        ...selected.map(
          (p) =>
            `export { default as ${componentName(p)} } from './progressive-blur-${p}.astro';`,
        ),
      ];
}
