export const PI_PACKAGE_NAME = "@earendil-works/pi-coding-agent";

export type PiPackageManager = "bun" | "npm" | "pnpm" | "yarn";

export interface PackageManagerInvocation {
  command: PiPackageManager;
  args: string[];
}

export const PI_PACKAGE_MANAGERS: readonly PiPackageManager[] = ["npm", "bun", "pnpm", "yarn"];

export function guessPiPackageManager(piPath: string): PiPackageManager | undefined {
  const normalized = piPath.replaceAll("\\", "/").toLowerCase();
  const segments = normalized.split("/").filter(Boolean);
  const hasSegment = (segment: string) => segments.includes(segment);
  const includesPath = (path: string) => normalized.includes(path);

  if (includesPath("/.bun/") || hasSegment("bun")) return "bun";

  if (
    includesPath("/.local/share/pnpm/") ||
    includesPath("/appdata/local/pnpm/") ||
    hasSegment("pnpm") ||
    hasSegment("pnpm-global")
  ) {
    return "pnpm";
  }

  if (includesPath("/.yarn/") || hasSegment("yarn")) return "yarn";

  if (
    includesPath("/.npm-global/") ||
    includesPath("/appdata/roaming/npm/") ||
    hasSegment("npm") ||
    hasSegment("npm-global") ||
    hasSegment("node") ||
    hasSegment("nodejs") ||
    hasSegment(".nvm") ||
    hasSegment(".nodenv") ||
    hasSegment(".asdf") ||
    hasSegment("nvs")
  ) {
    return "npm";
  }

  return undefined;
}

export function createPiGlobalInstallCommand(manager: PiPackageManager): string {
  const invocation = createPiGlobalInstallInvocation(manager);
  return [invocation.command, ...invocation.args].join(" ");
}

export function createPiGlobalInstallInvocation(
  manager: PiPackageManager,
): PackageManagerInvocation {
  const pkg = `${PI_PACKAGE_NAME}@latest`;
  switch (manager) {
    case "bun":
      return { command: manager, args: ["install", "--global", pkg] };
    case "npm":
      return { command: manager, args: ["install", "--global", "--ignore-scripts", pkg] };
    case "pnpm":
      return { command: manager, args: ["add", "--global", pkg] };
    case "yarn":
      return { command: manager, args: ["global", "add", pkg] };
  }
}
