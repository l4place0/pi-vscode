import { describe, expect, it } from "vitest";
import { parseInstalledPackages, readPackageSource } from "../src/packages-core.ts";

describe("readPackageSource", () => {
  it("accepts supported Pi package sources", () => {
    expect(readPackageSource("npm:@scope/package@1.2.3")).toBe("npm:@scope/package@1.2.3");
    expect(readPackageSource("github:owner/repo#main")).toBe("github:owner/repo#main");
    expect(readPackageSource("https://example.com/package.tgz")).toBe(
      "https://example.com/package.tgz",
    );
  });

  it("rejects shell-like, credentialed, and unknown sources", () => {
    expect(readPackageSource("npm:package & whoami")).toBeUndefined();
    expect(readPackageSource("https://user:pass@example.com/package.tgz")).toBeUndefined();
    expect(readPackageSource("file:../../outside")).toBeUndefined();
    expect(readPackageSource({ package: "npm:valid" })).toBeUndefined();
  });
});

describe("parseInstalledPackages", () => {
  it("parses the package source and following path", () => {
    expect(
      parseInstalledPackages("npm:one\n  /packages/one\ngithub:owner/two\n  /packages/two\n"),
    ).toEqual([
      { source: "npm:one", path: "/packages/one" },
      { source: "github:owner/two", path: "/packages/two" },
    ]);
  });
});
