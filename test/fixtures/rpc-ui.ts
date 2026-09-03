import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.registerCommand("vscode-select", {
    description: "Exercise the VS Code RPC select adapter",
    handler: async (_args, ctx) => {
      await ctx.ui.select("VS Code select test", ["Alpha", "Beta"]);
    },
  });

  pi.registerCommand("vscode-confirm", {
    description: "Exercise the VS Code RPC confirm adapter",
    handler: async (_args, ctx) => {
      await ctx.ui.confirm("VS Code confirm test", "Confirm or cancel this request.");
    },
  });

  pi.registerCommand("vscode-input", {
    description: "Exercise the VS Code RPC input adapter",
    handler: async (_args, ctx) => {
      await ctx.ui.input("VS Code input test", "Enter any short value");
    },
  });
}
