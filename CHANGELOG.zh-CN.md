[English](CHANGELOG.md) | [繁體中文](CHANGELOG.zh-TW.md) | **简体中文**

# 更新记录

## 1.1.0 — 2026-10-14

### 修正：token 三格严重少算

用量条的**金额一直是准的**（直接取自 Claude Code 自己的费用账本，与 `/cost` 是同一个数字）。不准的是 token 三格（↑ 输入、↓ 输出、▤ 缓存读取）：

- 旧版只在 `turn.complete` 累加 `e.usage`，但在实测的宿主版本上，那里只带「一轮中最后一次 API 请求」的用量。
- 一轮里若有工具调用，会连发多次请求，最后一次通常只是收尾的短文字，所以输出被少算得最多（约 6 倍），缓存读取约少算 3.7 倍。
- 结果是拿 token 三格去乘官方价，只得到金额格的三分之一左右，看起来像「金额算贵了」，其实是 token 数错了。

实测（同一个长会话，与对话记录去重后的真实总数比对）：

| | 旧版显示 | 真实总数 |
|---|---|---|
| ↓ 输出 | 54.0k | 344k |
| ▤ 缓存读取 | 37.9M | 140.9M |

**修法**

- 新增 `turn.step` 钩子，**每个 API 回应结束时计一次**（主循环与子代理都算）。`turn.complete` 只在该轮完全没有任何请求报过用量时，才用整轮总数补上，不会重复计算。
- 补上漏项：`session.compact`（压缩请求本身）与 `model.complete`（插件自己发出的模型调用）的用量。
- 计数按会话 id 存进 `$.store`（最多保留 30 个会话）：同一会话热重载、重启或恢复后数字不会清零；`/clear` 或新会话从零开始。若无法接上之前的计数，金额格的悬停提示会注明 token 计数的起始时间。
- 缓存写入从「输入」里拆出来单独记录（`tokWrite`）：↑ 格数字仍是「未缓存输入＋缓存写入」，鼠标移上去会拆成两项；终端机版显示为 `⇧ 6.0k (寫 6.0k)`。
- 新增 2 个测试（一轮三次请求只算一次，且不与整轮总数重复；没有请求用量时退回整轮总数）。

**仍然不计入 token（只在金额里）**：`model.classify`（结果里没有用量），以及不经过上述钩子的引擎内部辅助调用，占比很小。

### 修正：终端机版什么都不显示

`ui.resolve` 会给每个界面补齐所有元素名称（该界面没有的元素变成空 fragment），所以 `'Svg' in t` 在终端机上也是 true，用量条画出一个空的 Svg，什么都看不到。改成按 `e.surface` 判断：终端机画文字行，其余画 Svg。

### 修正：盖掉其他插件在输入框上方的内容

`AbovePrompt` 是所有插件共用的区块。旧版不调用 `next()` 就直接返回，会把下层插件画的内容（例如 cc-arcade 的棋盘）盖掉。现在先取下层内容，再把用量条叠在下方。

### 其他

- 版本号 0.1.0 → 1.1.0。
- 新增 `hooks/band.test.tsx`（共 5 个测试）。

### 如何自行核对 token 数

对话记录在 `~/.claude/projects/<项目目录>/<会话id>.jsonl`。同一条回复会拆成多行、每行带同一份 usage，必须按 `message.id` 去重：

```python
import json
seen = {}
for ln in open('<会话id>.jsonl'):
    try: d = json.loads(ln)
    except ValueError: continue
    m = d.get('message') or {}
    if isinstance(m, dict) and m.get('usage'):
        seen[m.get('id') or d.get('requestId')] = m['usage']
t = {k: sum((u.get(k) or 0) for u in seen.values()) for k in
     ('input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens', 'output_tokens')}
print(len(seen), 'responses', t)
```

修正后，新开会话的 token 三格应与这里的总数基本一致（升级前已开着的会话仍跑旧代码，要重开才生效）。

## 0.1.0

初版（原作者 [letswritetw](https://github.com/letswritetw/claude-mod-token-usage)）。
