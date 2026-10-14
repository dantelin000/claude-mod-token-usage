**English** | [繁體中文](README.zh-TW.md)

# token-usage

A usage strip above the prompt box in Claude Desktop (Code tab): 5h / 7d rate-limit quota, token usage and cost. It also draws a compact text line in the terminal CLI.

> This is a fork of [letswritetw/claude-mod-token-usage](https://github.com/letswritetw/claude-mod-token-usage).
> **v1.1.0** fixes the token counts being badly undercounted (now counted once per API response), the band not showing in the terminal, and the band hiding other plugins' content. See the [CHANGELOG](CHANGELOG.md).

## Install
- macOS: `bash install.sh`
- Windows: run `powershell -ExecutionPolicy Bypass -File install.ps1` in PowerShell

When it finishes, fully quit and reopen Claude Desktop. The script backs up and merges `~/.claude/settings.json` (it only adds two variables under `env`).

## Requirements
- A recent Claude Code / Claude Desktop that supports mods
- The 5h / 7d quota needs a subscription account; data appears after the first response

## Uninstall
Delete `~/.claude/mods/token-usage` and remove `CLAUDE_CODE_PLUGIN_DIRS` and `CLAUDE_CODE_PLUGIN_DIR_WATCH` from `env` in `settings.json`.
