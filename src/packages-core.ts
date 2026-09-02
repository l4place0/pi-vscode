export function parseInstalledPackages(output: string): { source: string; path: string }[] {
  const packages: { source: string; path: string }[] = [];
  const lines = output.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]!.trim();
    if (trimmed.startsWith("npm:") || trimmed.startsWith("github:") || trimmed.startsWith("http")) {
      const pathLine = lines[i + 1]?.trim() || "";
      packages.push({ source: trimmed, path: pathLine });
    }
  }
  return packages;
}

export function readPackageSource(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0 || value.length > 500) return undefined;
  if (/\s/.test(value) || [...value].some((character) => character.charCodeAt(0) < 32))
    return undefined;
  if (/^npm:(?:@[\w.-]+\/)?[\w.-]+(?:@[\w.*^~+-]+)?$/.test(value)) return value;
  if (/^github:[\w.-]+\/[\w.-]+(?:#[\w./-]+)?$/.test(value)) return value;
  try {
    const url = new URL(value);
    if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password) return value;
  } catch {}
  return undefined;
}
