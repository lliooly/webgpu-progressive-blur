export declare const presets: readonly string[];
export declare function componentName(name: string): string;
export declare function templates(
  framework: 'react' | 'astro',
  selected: readonly string[],
  packageName?: string,
): Record<string, string>;
export declare function exportLines(
  framework: 'react' | 'astro',
  selected: readonly string[],
): string[];
