# dsh-daily-todo · 每日待办

[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)

DeepSeek Harness（DSH）的每日待办插件：左侧图标栏点进去就是整页清单，**一天一份，分「工作 / 生活」两段，打钩即划掉，零点自动归档，没做完的带进新的一天。**

<!-- 想加截图：把图片放到 docs/screenshot.png，然后把下面这行取消注释 -->
<!-- ![每日待办界面](docs/screenshot.png) -->

## 为什么需要它

对话里的 todo 是给 agent 看的工作分解，不是给人用的日程。这个插件补的是「我自己今天要做什么」：随手记、打钩、跨天自动收尾，不用开第二个软件。

## 功能

- **一天一份清单**：以本机时区凌晨零点为界，跨天自动换成新的一天。
- **工作 / 生活两段**：新增时选分类（会记住上次选择），各段独立计数，鼠标悬停 `↔` 可挪到另一段。
- **打钩即完成**：删除线 + 变灰，留在原位不乱跳；再点一次撤销。
- **就地编辑**：点任务文字直接改，Enter 保存 / Esc 取消；行尾 `×` 删除。
- **零点自动归档**：上一天整份清单冻结成归档快照（含已完成与未完成），「归档」标签页按时间倒序只读查看，展开可看当天明细。
- **未完成自动承接**：新的一天只带入未完成项，并标上 `承接 MM-DD`，已完成项留在归档里。
- **只用主题 token 配色**：跟随 DSH 的明暗主题与字号，不写死颜色。

## 安装

插件商店（推荐）：

1. 侧栏「插件」→「插件商店」→ 搜索 `dsh-daily-todo` → 安装。
2. 侧栏出现清单图标，点开即用。

命令行：

```bash
dsh plugin add dsh-daily-todo
```

刷新页面后生效。装好后不需要任何配置。

## 数据与隐私

- 数据只写本机：`$DSH_HOME/daily-todo/todos.json`（默认 `~/.dsh/daily-todo/todos.json`），所有 profile 共用一份。
- 写入是原子的（临时文件 + rename）；文件损坏时自动改名为 `todos.json.corrupt-<时间>.bak` 并重建空清单。
- 插件不联网、不上传、不读取待办以外的任何文件。
- 清空数据：关闭 Harness 后删掉该文件即可。

## 分类与旧数据

- 每项任务带 `cat`：`work` 或 `life`；分组靠过滤得出，清单本身是一条扁平数组。
- 新增缺省归「工作」，未知分类值一律落回「工作」。
- 「挪类」= 从原位置摘出、追加到目标段末尾；完成状态与承接来源不变。
- 早期版本没有 `cat` 字段的数据，读入时全部补为「工作」。

## 兼容性

- 需要 DSH `>=0.2.0-rc.1`（含客户端插槽 `sidebar.panellist` 与 `main`），Node `>=20`。
- 已在 DSH 0.2.2-rc.1 + Windows Desktop 实测；macOS / Linux 桌面与 Web 版理论上一致，未逐一实测。
- 界面文案随 DSH 语言切换（内置中文、英文两份）；侧栏与页头名称固定为「每日待办」。

## 开发

```bash
# 语法检查
node --check index.js && node --check client.js

# 宿主半回归测试（在临时目录跑，不碰真实数据）
node ../.tests/host.test.mjs
```

结构：

| 文件 | 作用 |
| --- | --- |
| `index.js` | 宿主半：日期边界、跨日归档与承接、磁盘存储、`/dsh-daily-todo/*` 路由 |
| `client.js` | 浏览器半：`sidebar.panellist` 图标 + `main` 整页（纯主题 token 配色） |
| `cordis.patch.yml` | 插入插件行 |
| `locale/*.json` | 插件管理器里的显示名与描述 |

接口：`GET /dsh-daily-todo/state`、`POST /dsh-daily-todo/mutate`（`add` / `toggle` / `edit` / `move` / `delete`）、`GET /dsh-daily-todo/archive?id=`。

## 更新日志

见 [CHANGELOG.md](./CHANGELOG.md)。

## 许可证

[MIT](./LICENSE) © 2026 lunasi27
