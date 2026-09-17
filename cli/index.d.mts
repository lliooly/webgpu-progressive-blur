export declare const packageVersion: string;
export declare const minimumRuntimeVersion: string;
export declare const runtimeSpec: string;
export declare function addComponents(
  args: string[],
  cwd?: string,
  install?: (...args: unknown[]) => { status?: number; error?: unknown },
): string[];
export declare function parseArguments(args: string[]): Record<string, unknown>;
export declare function packageManagerExecutable(
  name: string,
  platform?: string,
): string;
