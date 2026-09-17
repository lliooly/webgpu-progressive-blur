import { readFileSync } from "node:fs";

export const presets = [
  "navbar",
  "sidebar",
  "bottom-bar",
  "caption",
  "edge",
  "panel",
];
export const componentName = (name) =>
  "ProgressiveBlur" +
  name
    .split("-")
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join("");
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
        ? `'use client';\n\nimport { ProgressiveBlur, type ProgressiveBlurProps } from './progressive-blur';\n\nexport function ${name}(props: Omit<ProgressiveBlurProps, 'preset'>) {\n  return <ProgressiveBlur {...props} preset="${preset}" />;\n}\n`
        : `---\nimport ProgressiveBlur, { type Props as BaseProps } from './progressive-blur.astro';\nexport interface Props extends Omit<BaseProps, 'preset'> {}\n---\n<ProgressiveBlur {...Astro.props} preset="${preset}"><slot /></ProgressiveBlur>\n`;
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
