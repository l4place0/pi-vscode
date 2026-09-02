import { describe, expect, it } from "vitest";
import manifest from "../package.json";
import { CONTRIBUTION_IDS } from "../src/constants.ts";

describe("fork identity", () => {
  it("uses a distinct extension name and contribution prefix", () => {
    expect(manifest.name).toBe("pi-vscode-fork");
    expect(manifest.displayName).toBe("Pi VSCode Fork");
    for (const id of Object.values(CONTRIBUTION_IDS)) {
      expect(id).toMatch(/^pi-vscode-fork\./);
    }
  });

  it("keeps manifest registrations aligned with runtime IDs", () => {
    expect(manifest.contributes.chatParticipants[0].id).toBe(CONTRIBUTION_IDS.chat);
    expect(
      manifest.contributes.commands.map((entry: { command: string }) => entry.command),
    ).toEqual(
      expect.arrayContaining([
        CONTRIBUTION_IDS.open,
        CONTRIBUTION_IDS.openWithFile,
        CONTRIBUTION_IDS.sendSelection,
        CONTRIBUTION_IDS.openInNewWindow,
        CONTRIBUTION_IDS.updatePackages,
      ]),
    );
    expect(manifest.contributes.terminal.profiles[0].id).toBe(CONTRIBUTION_IDS.terminalProfile);
    expect(manifest.contributes.views["pi-vscode-fork"][0].id).toBe(CONTRIBUTION_IDS.packagesView);
    expect(manifest.contributes.configuration.properties).toHaveProperty("pi-vscode-fork.path");
  });
});
