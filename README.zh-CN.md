[English](README.md) | [繁體中文](README.zh-TW.md) | **简体中文**

# token-usage

Claude Desktop（Code 标签页）输入框上方的用量条：5h / 7d 额度、token 用量、花费。在终端机版 CLI 里会显示成一行文字。

> 这是 [letswritetw/claude-mod-token-usage](https://github.com/letswritetw/claude-mod-token-usage) 的 fork。
> **v1.1.1** 修正分支（fork）出来的会话把父会话的费用当成自己的：金额格现在只显示这个对话自己的花费。
> **v1.1.0** 修正 token 三格严重少算（改为每个 API 回应计一次）、终端机版不显示、盖掉其他插件内容的问题，详见 [更新记录](CHANGELOG.zh-CN.md)。

## 安装
- macOS：`bash install.sh`
- Windows：在 PowerShell 执行 `powershell -ExecutionPolicy Bypass -File install.ps1`

完成后完全关闭并重新打开 Claude Desktop。脚本会备份并合并 `~/.claude/settings.json`（只在 `env` 里新增两个变量）。

## 需求
- 支持 mod 功能的新版 Claude Code / Claude Desktop
- 5h / 7d 额度需要订阅账号；第一次回应之后才有数据

## 卸载
删除 `~/.claude/mods/token-usage`，并从 `settings.json` 的 `env` 中移除 `CLAUDE_CODE_PLUGIN_DIRS` 与 `CLAUDE_CODE_PLUGIN_DIR_WATCH`。
