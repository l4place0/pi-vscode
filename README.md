# Pi VSCode Fork

Minimal local-first VS Code extension for [pi coding agent](https://pi.dev/). This fork uses
isolated contribution IDs so it can be installed alongside the official extension for A/B testing.

## Features

- **Terminal-based** — Opens pi as an integrated terminal with full TUI/PTY support (opens beside the editor)
- **VS Code bridge** — Bundles a pi extension and local bridge so pi can query live editor state
- **Editor awareness** — pi can inspect the active editor, current/latest selection, open editors, workspace folders, and VS Code diagnostics (LSP / lint / type errors)
- **Live VS Code footer status** — pi's terminal UI shows the active VS Code file, cursor/selection, language, dirty marker, and diagnostic counts in its bottom status area
- **Status bar button** — PI button in the status bar for quick access
- **Open with file context** — Send current file path and line range (or cursor position) to pi, available from the editor title bar
- **Send selection** — Send selected text directly to the pi terminal
- **`@pi-fork` chat participant** — Use `@pi-fork` in VS Code Chat for streamed RPC-backed replies while keeping the terminal workflow for normal Pi sessions
- **Package manager** — Browse, search, install, and uninstall pi packages from the sidebar with live output streaming and cancel support; automatically detects package capabilities (extensions, skills, prompts, themes)
- **Auto-detection** — Finds the pi binary automatically from common paths (`~/.bun/bin`, `~/.local/bin`, `~/.npm-global/bin`)

<img width="945" height="725" alt="image" src="https://github.com/user-attachments/assets/91dbaca4-6d27-490a-8395-94a9c4d07625" />

## Requirements

- `pi` CLI installed (`npm install --global --ignore-scripts @earendil-works/pi-coding-agent` or `bun install --global @earendil-works/pi-coding-agent`)
- An API key configured for at least one provider

## Install

This version is distributed as a local VSIX or CI artifact; Marketplace and Open VSX publishing are
out of scope. Build and install it locally with:

```bash
pnpm install --frozen-lockfile
pnpm package
code --install-extension pi-vscode-fork-0.1.0.vsix --force
```

## Commands

| Command                            | Keybinding       | Description                                                                              |
| ---------------------------------- | ---------------- | ---------------------------------------------------------------------------------------- |
| `Pi Fork: Open`                    | `Ctrl+Alt+3`     | Open or focus the pi terminal                                                            |
| `Pi Fork: Open with File`          | Editor title bar | Open pi with current file context                                                        |
| `Pi Fork: Send Selection`          | —                | Send selected text to pi terminal                                                        |
| `Pi Fork: Upgrade Pi and Packages` | —                | Find the pi binary, infer its package manager, upgrade pi globally, then run `pi update` |

## Sidebar

The **Pi** activity bar icon opens a sidebar with:

- **Packages view** — Search the npm registry for `pi-package` packages, see capability labels (extensions, skills, prompts, themes), install/uninstall with live streamed output, cancel in-progress operations, and use **Upgrade Pi and Packages** to upgrade the pi CLI plus installed pi packages from the sidebar

## Bridge tools exposed to pi

Each pi terminal launched by the extension loads a bundled pi extension that can call back into live VS Code APIs. The same extension also updates pi's footer status every few seconds with the active VS Code file, cursor/selection, language id, unsaved-change marker, and diagnostic summary.

### Inspection tools

| Tool                           | What it returns                                                                                                                                                        |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vscode_get_editor_state`      | Aggregate snapshot of workspace folders, active editor metadata, current selection, latest cached selection, and open editors                                          |
| `vscode_get_selection`         | Current editor selection including selected text, file path, and coordinates; falls back to the latest cached selection when pi terminal focus hides the active editor |
| `vscode_get_latest_selection`  | Most recent cached selection seen by the extension, even if focus already moved                                                                                        |
| `vscode_get_diagnostics`       | VS Code diagnostics for a specific file or the whole workspace                                                                                                         |
| `vscode_get_open_editors`      | Visible/open file editors with language, dirty state, and active flag                                                                                                  |
| `vscode_get_workspace_folders` | Workspace folders for the current VS Code window                                                                                                                       |
| `vscode_get_document_symbols`  | Outline symbols for a file from the active language server                                                                                                             |
| `vscode_get_definitions`       | Symbol definition locations at a given file position                                                                                                                   |
| `vscode_get_type_definitions`  | Symbol type-definition locations at a given file position                                                                                                              |
| `vscode_get_implementations`   | Concrete implementation locations for an interface or abstract member                                                                                                  |
| `vscode_get_declarations`      | Symbol declaration locations at a given file position                                                                                                                  |
| `vscode_get_hover`             | Hover docs, inferred types, signatures, and markdown/code snippets from the language server                                                                            |
| `vscode_get_workspace_symbols` | Global workspace symbol search through VS Code language providers                                                                                                      |
| `vscode_get_references`        | Symbol references at a given file position                                                                                                                             |
| `vscode_get_code_actions`      | Available code actions / quick fixes for a selection or explicit range, plus intersecting diagnostics                                                                  |
| `vscode_get_notifications`     | Buffered bridge events such as selection, editor, diagnostics, save, and dirty-state changes                                                                           |

### Action tools

| Tool                          | What it does                                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------------ |
| `vscode_open_file`            | Opens a file in VS Code and can reveal/select a range                                            |
| `vscode_check_document_dirty` | Checks whether a file is open and whether it has unsaved changes                                 |
| `vscode_save_document`        | Saves a document through VS Code                                                                 |
| `vscode_execute_code_action`  | Executes a previously returned code action by `actionId`                                         |
| `vscode_apply_workspace_edit` | Applies explicit range-based text replacements through VS Code so open buffers stay synchronized |
| `vscode_format_document`      | Runs the active document formatter for a file and applies the resulting edits through VS Code    |
| `vscode_format_range`         | Runs the active range formatter for a selection/range and applies the resulting edits            |
| `vscode_clear_notifications`  | Clears the buffered bridge notification queue                                                    |
| `vscode_show_notification`    | Shows an info, warning, or error notification inside VS Code                                     |

### Notes

- Paths accepted by file-based bridge tools can be absolute or workspace-relative.
- `vscode_get_code_actions` accepts either `selection` or explicit `start` / `end` positions.
- `vscode_execute_code_action` only works with an `actionId` returned by the most recent `vscode_get_code_actions` calls while that cached entry still exists.
- `vscode_apply_workspace_edit` applies one or more `{ filePath, range, newText }` replacements via VS Code rather than editing files behind the editor's back.
- `vscode_format_range` accepts either `selection` or explicit `start` / `end` positions.
- `vscode_format_document` / `vscode_format_range` use VS Code formatting providers and apply formatter-generated `TextEdit[]` results with `workspace.applyEdit`, which is safer for open or dirty buffers than shelling out.
- `vscode_get_selection` falls back to the latest cached VS Code selection when focus is in the pi terminal and VS Code reports no active text editor.
- `vscode_get_notifications` supports `since` and `limit` parameters for incremental polling.
- Oversized bridge tool results are capped; when a response exceeds the limit, the tool returns a valid JSON wrapper with `truncated: true`, original size metadata, and a `resultJsonPrefix` preview.

These bridge tools let pi inspect selections, diagnostics, symbols, definitions, declarations, implementations, hover/type info, workspace-wide symbol search, references, quick-fix availability, dirty state, and recent IDE events, while also safely opening files, saving buffers, applying workspace edits, formatting open buffers through VS Code providers, running VS Code code actions, and surfacing notifications back to the user.

## Configuration

| Setting               | Default | Description                                             |
| --------------------- | ------- | ------------------------------------------------------- |
| `pi-vscode-fork.path` | `""`    | Absolute path to the pi binary (auto-detected if empty) |

On Windows, an extensionless `pi-vscode-fork.path` is auto-probed for `.cmd`/`.exe`/`.ps1` variants so extensionless npm shims work out of the box.

## Development

The supported baseline is Node.js 22, pnpm 10.32.1, VS Code 1.110 or newer, and Pi 0.84.4 or
newer.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm test
pnpm build
```

Press F5 in VS Code to run the cross-platform `build` task and open an Extension Development Host.
Run `pnpm dev` in a separate terminal when continuous rebuilding is useful.

Additional acceptance commands:

```bash
pnpm test:pi -- 0.84.4
pnpm test:integration
pnpm package
node scripts/verify-vsix.mjs pi-vscode-fork-0.1.0.vsix
```

`test:pi` installs Pi into a disposable temporary directory with an isolated npm cache, verifies the
CLI flags, starts offline RPC, loads the bundled bridge, and checks a loopback bridge call. The
Extension Host test downloads VS Code 1.110 on first use.

For clean-profile VSIX validation, use dedicated directories rather than the daily VS Code profile:

```powershell
$profileRoot = Join-Path $PWD ".tmp/vsix-acceptance"
code --user-data-dir "$profileRoot/user-data" --extensions-dir "$profileRoot/extensions" --install-extension ./pi-vscode-fork-0.1.0.vsix --force
code --user-data-dir "$profileRoot/user-data" --extensions-dir "$profileRoot/extensions" --list-extensions --show-versions
code --user-data-dir "$profileRoot/user-data" --extensions-dir "$profileRoot/extensions" --uninstall-extension pi0.pi-vscode-fork
```
