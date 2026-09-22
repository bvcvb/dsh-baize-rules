# dsh-baize-rules

**[English](README.md) | 简体中文**

[![Listed on dsh-plugin.org](https://dsh-plugin.org/badges/listed.svg)](https://dsh-plugin.org/plugins/bvcvb/dsh-baize-rules)
![npm version](https://img.shields.io/npm/v/dsh-baize-rules)
![license](https://img.shields.io/npm/l/dsh-baize-rules)

> English: *`dsh-baize-rules` (Baize) is a dsh plugin that injects user-set, durable "must-do / must-not" requirements — plain-text rules — into the model at conversation start as a sourced `user/message`.*

[dsh](https://www.npmjs.com/package/@deepseek-ai/dsh) 的**会话 / 全局「必须做 / 不能做」要求**插件。名字取自**白泽**——传说中「通万物之情、晓万物之名、知万物之理」的神兽，用它来承载「用户给模型立下的行为基线」。

![dsh web UI 里的「规则」面板——「规则 / 模板」双页、作用域标签（对话 / 项目 / 全局）、标签 chip 筛选、每行的启用 / 存为模板操作与已生效规则列表](https://raw.githubusercontent.com/bvcvb/dsh-baize-rules/HEAD/assets/001-rules-panel.png)

- 规则是**纯文本**，没有 `must`/`mustNot` 标记——「必须做 / 不能做」由正文语言表达（例如 `用中文写注释。`=必须，`不要删除测试。`=禁止）。
- 注入发生在**会话起点**：把当前生效规则作为一条**持久** `user/message` 注入模型请求，套用 `<system-reminder>` 框架，来源标记为 `source.kind='plugin'`、`plugin='baize-rules'`。
- **无规则则不注入**；字节预算小到裁光所有规则时返回 `undefined`，绝不注入空壳 reminder。

---

## 功能特性

| 特性 | 说明 |
|---|---|
| **三作用域，均参与注入** | `global`（所有会话）/ `session`（当前会话）/ `project`（按会话工作目录，仅该目录）——三者都会进入模型 |
| **持久化** | 全部落盘到 `$DSH_HOME`（默认 `~/.dsh`），跨会话、跨重启 |
| **具体优先** | 渲染顺序 `project > session > global`；字节预算受压时优先保留更具体的规则 |
| **坏文件不再打断对话** | 规则文件采用容错读取：损坏或被手改坏的文件只会让该作用域降级为空 + 一条 `problems` 告警，不会让对话步骤失败 |
| **去重** | 按渲染文本 SHA-1 digest 抑制重复注入；`injectAtEveryStep` 可选每步强制刷新 |
| **长对话里始终在场** | 以下三种情况会重新发布一份快照：文本变化时、会话生命周期变化（`startup`/`resume`/`clear`/`compact`）后、以及距上次发布满 `refreshAfterSteps` 步（默认 20）时——规则不会只留在长对话的最开头 |
| **防逃逸** | 正文里的字面 `</system-reminder>` 会被转义，防止用户文本关闭插件框架 |
| **命令 + API 同源** | `/baize-rules` 命令与前端面板共用同一套 store/core，改动始终同一真值 |
| **标签分类** | 规则可带文字标签（`流程`、`#前端`…），面板按标签筛选。默认**只用于分类**，不占模型上下文预算（`injectTags` 可开） |
| **模板库** | 常用规则存成模板（内容 + 标签），任意作用域一键套用；可导出/导入 JSON，跨机器、跨会话复用。套用是**内容副本**——之后改模板不会回写已加入的规则 |
| **并发写保护** | 每次写入都带上读取时的文件版本号；若期间被别的窗口改过，**拒绝写入并提示重试**，而不是静默覆盖 |

### 与 `AGENTS.md` 工作区指令的分工

dsh 自带 `@deepseek-ai/dsh-agent-instructions`，负责加载工作区指令链（`AGENTS.md` / `CLAUDE.md`）。两者互补，按「这条规则该落在哪里」来选：

| | `AGENTS.md`（宿主自带） | `dsh-baize-rules`（本插件） |
|---|---|---|
| 存放位置 | 仓库里的文件 | `$DSH_HOME/rules/*.json` + 面板 |
| 生效范围 | 在该仓库里工作的任何人 | 你自己的机器：全部会话 / 单个会话 / 某个目录 |
| 版本控制 | 随仓库提交、评审、团队共享，跟着仓库走 | 不进仓库，跟着 `DSH_HOME` 走 |
| 修改方式 | 编辑文件；下次文件触碰或恢复会话时生效 | 在面板或用 `/baize-rules` 修改；下一步即注入 |
| 适合 | 属于项目本身的工程约定 | 个人偏好、跨项目要求、临时会话级要求 |

两者都以 `<system-reminder>` 框架的 sourced `user/message` 注入，并带有同一句优先级说明，因此是互相加强而不是互相冲突。

---

## 安装

> dsh 插件从 npm 仓库分发，通过 `dsh plugin` 安装到某个 profile。

```bash
# 从 npm 安装到 web profile（版本以发布后的实际版本为准）
dsh plugin --profile web add dsh-baize-rules@0.2.3
pm2 restart dsh          # dsh 由 pm2 托管时重载生效
dsh --profile web
```

安装时依赖的 peer 包（`@deepseek-ai/` 系列、`react` 等）由 dsh profile 提供；若缺少，pnpm 会在 profile 目录里按 `peerDependencies` 解析。

### 卸载

```bash
# 从 profile 移除插件
dsh plugin --profile web remove dsh-baize-rules
pm2 restart dsh          # dsh 由 pm2 托管时重载生效
```

若 `dsh.profile.bundles` 里仍残留该条目，删掉 `$DSH_HOME/profiles/web/package.json` 中对应那一行后再重启一次。`$DSH_HOME/rules/` 下的规则文件不会被删除——想要干净重来请自行删除。

### 不影响正在运行的 dsh 试装

装到**另一个 profile**，正在运行的 dsh 完全不受影响：

```bash
dsh plugin --profile smoke add dsh-baize-rules@0.2.3
dsh --profile smoke --dump-config   # 只读取并组合配置，不会启动 dsh
```

`--dump-config` 只组合并打印配置树、不启动服务，所以可安全地与正在运行的 dsh 并存。要在那个 profile 里真正试用，再执行 `dsh --profile smoke`。

> 关于 `pm2 restart dsh`：它会重载你正在运行的那个 profile。安装/卸载只改磁盘上的 profile，**下一次启动（或那次重启）才生效**。

### 本地开发联调（link）

尚未发布或想改源码即时生效时，用本目录作为 link 依赖：

```jsonc
// /home/abc/.dsh/profiles/web/package.json
"dependencies": {
  "dsh-baize-rules": "link:/home/abc/work/plugin/dsh-baize-rules"
}
```

随后在 profile 目录执行 `pnpm install`，并把 `dsh-baize-rules` 加进 `dsh.profile.bundles`。

---

## 快速开始

```bash
/baize-rules                                   # 等价于 /baize-rules list，查看当前生效规则
/baize-rules add 用中文写注释。                 # 加到默认作用域（通常是 session）
/baize-rules global add 不要删除或改写现有测试。 # 明确加到 global
/baize-rules list                              # 显示 project + session + global（含缩略 id / disabled 标注）
/baize-rules list project                      # 只列某个作用域
/baize-rules edit <id> 只用 pnpm 构建。          # 修改某条规则文本
/baize-rules disable <id>                      # 停用某条（保留不删）
/baize-rules enable <id>                       # 重新启用
/baize-rules scope global                      # 之后命令默认写到 global
/baize-rules clear session                     # 清空当前会话规则
/baize-rules global clear                      # 同一件事：`clear <scope>` 与 `<scope> clear` 等价
/baize-rules export                            # 导出全部规则为 JSON
# —— 标签 ——
/baize-rules tag <id> 流程 发布                  # 给规则打标签（幂等、去重）
/baize-rules untag <id> 发布                    # 去掉某个标签
# —— 模板 ——
/baize-rules save <id>                          # 把这条规则存成模板（面板里是「存为模板 / Save as template」）
/baize-rules tmpl list                          # 查看模板库（可按标签筛选过滤）
/baize-rules from <id|#标签>                     # 从模板添加规则（#标签 = 该标签下全部）
/baize-rules tmpl export ./templates.json       # 导出模板库到 JSON 文件
/baize-rules tmpl import ./templates.json --yes # 导入（默认 dry-run 预览，--yes 才写盘）
```

> **作用域写在动词之前**：写 `/baize-rules global add <正文>`。**末尾**的作用域词已不再被识别为修饰符
> ——`/baize-rules add 部署前先跑测试 global` 里的 `global` 属于规则正文（以前会被当作用域，正文被截断且规则写进 global）。见[作用域写法](#作用域写法)。

---

## 命令

所有子命令挂在 **`/baize-rules`** 下；无参数时等价于 `list`。

```
/baize-rules [<scope>] <command>                     # scope 为 global|session|project，写在动词之前
/baize-rules [list [scope]|add <text>|remove <id>|edit <id> <text>|enable|disable <id>|tag|untag <id> <tag…>|save <id> [#tag…]|from <id|#tag>|tmpl <list|add|edit|rm|export|import>|scope <scope>|clear <scope>|export]
```

![斜杠命令菜单里的 `/baize-rules` 条目：查看/增删改 会话或全局的 必须/禁止 要求，并管理可复用的规则模板](https://raw.githubusercontent.com/bvcvb/dsh-baize-rules/HEAD/assets/002-command.png)

| 子命令 | 语法 | 作用 |
|---|---|---|
| **list** | `/baize-rules list [scope]` | 列出合并后的生效规则（`Project`/`Global`/`Session` 节；空时显示 `No active rules.`）。可传作用域只列该作用域（`/baize-rules list project`；`<scope> list` 等价） |
| **add** | `/baize-rules add <text>` | 追加一条规则到目标作用域（默认 `scope`）；文本即规则 |
| **remove** | `/baize-rules remove <id>` | 删除一条规则（id 或**唯一前缀**） |
| **edit** | `/baize-rules edit <id> <text>` | 修改某条规则的文本 |
| **enable** | `/baize-rules enable <id>` | 启用一条被停用的规则 |
| **disable** | `/baize-rules disable <id>` | 停用一条规则（保留但不生效） |
| **tag** | `/baize-rules tag <id> <tag…>` | 给规则**追加**标签（幂等、去重、大小写不敏感） |
| **untag** | `/baize-rules untag <id> <tag…>` | 移除指定标签 |
| **save** | `/baize-rules save <id> [#tag…]` | 把这条规则存成模板；同内容模板已存在时合并标签 |
| **from** | `/baize-rules from <id\|#tag>` | 从模板添加规则；`#tag` 一次加入该标签下**全部**模板。目标作用域来自**前置**的作用域关键字（或默认值），不再有第二个位置参数 |
| **tmpl** | `/baize-rules tmpl <子命令>` | 模板库管理（见下） |
| **scope** | `/baize-rules scope <global\|session\|project>` | 切换后续命令的默认作用域（持久到当前进程）。这里作用域是参数，所以 `/baize-rules scope global` 与 `/baize-rules global scope` 都可用 |
| **clear** | `/baize-rules clear <global\|session\|project>` | 清空某作用域的全部规则。`/baize-rules clear global` 与 `/baize-rules global clear` 都可用 |
| **export** | `/baize-rules export` | 以 JSON 导出 `{ global, session, project }` |

**`tmpl` 子命令**

| 子命令 | 语法 | 作用 |
|---|---|---|
| **list** | `/baize-rules tmpl list [tag]` | 列出模板（显示缩略 id、标签、使用次数），可按标签过滤 |
| **add** | `/baize-rules tmpl add <text> [#tag…]` | 新建模板 |
| **edit** | `/baize-rules tmpl edit <id> [<text>] [#tag…]` | 改内容与标签；省略 `<text>` 时只改标签 |
| **rm** | `/baize-rules tmpl rm <id>` | 删除模板 |
| **export** | `/baize-rules tmpl export [<file>]` | 导出模板库（省略路径则直接打印 JSON） |
| **import** | `/baize-rules tmpl import <file> [--merge\|--replace] [--dry-run] [--yes]` | 导入模板库（**默认 dry-run**，`--yes` 才写盘） |

**参数细节**

- `<text>`：规则正文，可含空格；是「必须做」还是「不能做」由正文语言表达，无标记。
- `<id>`：规则的稳定 id（`crypto.randomUUID`）。`list` 显示**前 8 位缩略 id** 便于阅读；
  `remove`/`edit`/`enable`/`disable`/`tag`/`untag`/`save` 都接受**完整 id 或唯一前缀**；
  前缀命中多条时报 `ambiguous` 并列出候选，绝不猜。`tmpl rm`/`tmpl edit` 同理。
- `<tag…>`：文字标签，空格分隔，`#` 前缀可选（`#流程` 与 `流程` 等价）。每项最多 **8 个**标签、
  单个最长 **24 字符**；去重与筛选均**大小写不敏感**，但存储保留你首次输入的写法。
- `from` 的重复保护：目标作用域里已有**同内容**规则时跳过（报告 `Skipped N duplicate(s)`），
  所以重复点「从模板添加」不会堆积重复规则；实际套用成功会让模板的**使用次数 +1**。

### 作用域写法

作用域修饰符**写在动词之前**——这是唯一写法：

- `/baize-rules global add 用中文。`
- `/baize-rules project add 部署前先跑测试。`
- `/baize-rules session remove <id>`

> **BREAKING（0.2.1）：尾部作用域写法已移除。** 行尾的作用域词不再是修饰符，而属于参数。
> `/baize-rules add 部署前先跑测试 global` 现在会把正文 `部署前先跑测试 global` 存进**默认**作用域。
> 0.2.1 之前同一行会把正文里的 `global` 吞掉、并把规则写进 `global` 作用域——既截断正文又写错目标，
> 因此这次是直接移除尾部写法，而不是保留为别名。
>
> 受影响的动词是 `add`/`remove`/`edit`/`enable`/`disable`/`from`。除**第一个 token** 之外，
> 任何位置的作用域词都是普通文本：`/baize-rules add 发布前先跑 global 检查。` 会把整句当作正文存下来。
> `from` 也随之失去了位置形式的作用域参数：写 `/baize-rules project from <id>`（或先用
> `/baize-rules scope project` 设默认），而不是 `/baize-rules from <id> project`。
>
> **尾部 `#tag` 语义不变。** `tag`/`untag`/`save`/`tmpl` 仍把末尾一段 `#tag` 当作元数据而非正文。
> 它们**只支持前缀写法**传作用域（`/baize-rules global tag <id> 前端`），
> 这样即使标签名恰好叫 `project`/`global`/`session`，也不会被当成作用域吞掉。

**当作用域本身是参数而不是修饰符时**，两种顺序都可用——`/baize-rules clear global` ≡
`/baize-rules global clear`，`/baize-rules scope project` ≡ `/baize-rules project scope`，
`/baize-rules list project` ≡ `/baize-rules project list`。

未指定作用域时，用 `/baize-rules scope` 设定的默认值（初始来自配置文件 `Config.scope`，通常 `session`）。

---

## 注入行为（模型上下文如何被改变）

- **会话起点基线**：会话开始时，`agent/pre-step`（`prepend:true`）把生效规则作为一条 `user/message` 插入请求，内容为 `<system-reminder>` 框架，`source.kind='plugin'`、`plugin='baize-rules'`、`form='snapshot'`。
- **三个作用域都会注入**：`project > session > global`，具体在前。`project` 规则按会话工作目录读取，因此只要会话声明了 `cwd` 就会进入视图（也进入模型上下文），渲染在 `Project requirements (this directory only):` 标题下。
- **具体优先**：预算受限时优先裁剪较宽泛的 `global` 规则。
- **去重**：对渲染文本算 SHA-1 digest，规则不变则不重复注入；`injectAtEveryStep:true` 时每步强制刷新。
- **会话生命周期变化后补发一份**：`agent/session-start`（`startup` / `resume` / `clear` / `compact`）会清掉该会话的记录，下一步就重新发布完整规则——被压缩或清空的会话不会「丢掉」这些规则，而这正是「只在开头注入一次」唯一可能永久失效的场景。
- **每 `refreshAfterSteps` 步补发一份**：距上次发布的副本满这么多步时，即使渲染文本一字未改也会重新发布（默认 **20**，`0` 关闭周期刷新）。压缩后步号重新计数也算「过期」。因为消息是快照，模型侧仍然只看到一份——这只是把它挪回对话「现在」的位置。
- **转义**：正文里的 `</system-reminder>` 会被 `escapeReminder` 转义。
- **标签不入模型**：标签默认**不**注入（`injectTags:false`），所以给规则打标签/改标签既不改变模型看到的文本，也不会触发重复注入。
- **空 / 全裁**：无规则、或预算裁光所有规则时返回 `undefined`（即不注入该消息）。
- **坏文件不打断步骤**：所有读取都是降级而非抛出——文件损坏只会让该作用域读成空，并追加一条 `problems` 记录。步骤一定走完，那条告警就是提醒你去修文件的信号。

### 模型实际看到的形态

```markdown
<system-reminder>
The following user requirements apply to every step of this conversation. Obey them.
More specific instructions take precedence over broader ones. They do not override system, developer, or direct user instructions.

Project requirements (this directory only):
- 提交前先跑测试。

Session requirements (this conversation only):
- 插件每次都要隔离测试后才能部署。

Global requirements:
- 用中文写注释。
- 不要删除或改写现有的测试。
</system-reminder>
```

（`Project requirements (this directory only):` 段只有在会话有工作目录**且**该目录有生效规则时才出现。）

---

## 配置（`Config`）

插件启动时用 `@deepseek-ai/schemastery` 校验 `Config`；非法值会令插件加载失败。

| 配置 | 默认 | 说明 |
|---|---|---|
| `scope` | —（**schema 必填**） | 默认作用域，`/baize-rules` 未指定时使用。`global`/`session`/`project` 三者皆可——包含 `project`，按会话工作目录解析 |
| `maxBytes` | —（**schema 必填**） | 模型可见字节上限；超出时按「具体优先」裁剪 |
| `globalRulesPath` | `$DSH_HOME/rules/global.json` | 覆盖全局规则文件路径 |
| `injectAtEveryStep` | `false` | 每步强制重渲（调试用）；默认为仅变化时打补丁 |
| `refreshAfterSteps` | `20` | 距上次发布的副本满这么多步就重新发布一份（即使文本未变），避免长对话里规则只留在最开头。`0` 关闭周期刷新 |
| `injectTags` | `false` | 为 `true` 时把标签渲染进模型上下文（`- [流程,发布] 正文`）。默认关闭：标签是给人看的分类器，注入会占预算并添噪声 |
| `apiOriginCheck` | `false` | 为 `true` 时面板 API 只接受**本机 + 同源**请求；默认关闭，反代前置的 Web UI 因此可直接使用 |

> `scope` 与 `maxBytes` 是 **schema 必填项**，不是「可选 + 隐式兜底」。缺任一项会让插件加载失败，并给出
> 明确指出缺失字段的错误——以前静默使用未定义的默认作用域，会把配置错误藏起来。
>
> **`apiOriginCheck`（默认 `false`）。** 开启后，面板 API 只应答**来自本机**的请求，且当浏览器声明了
> `Origin` 时，必须来自**宿主自身的源**（或本地 `file://` 页面，其 Origin 为 `null`）；其它情况一律以
> `403` 拒绝。之所以**默认关闭**：Web UI 通常经**反向代理**访问，这类请求的来源地址是代理而非 loopback，
> 默认开启会让面板直接失效。当端口可能被本机以外的人访问、且没有代理层做鉴权时，才把它**开启**——
> 这个校验存在的理由是全局规则文件会进入**每个**会话的提示词，「只要能连上端口就行」是不够的。
> 关闭校验时，鉴权责任在传输层（dsh 自身的 token）与代理层。

### 挂载元数据（`cordis.patch.yml`）

发布的 npm 包里携带 `dsh.bundle.patch`，安装 `dsh-baize-rules@<version>` 时由 dsh 自动接入：
`cordis.patch.yml` 中 `insert` 一行插件，默认 `scope: session`、`maxBytes: 8192`。如需调整默认作用域 / 预算，改这里即可。

若不用 bundle patch、改为手动挂载，就自己 insert 同一行——挂载项整体是 `insert` 进配置树的，
`config` 与 `Config` schema 一致：

```yaml
# $DSH_HOME/profiles/<profile>/cordis.patch.yml   （例如 ~/.dsh/profiles/web/cordis.patch.yml）
- insert:
    - id: baize-rules
      name: 'dsh-baize-rules'
      config:
        scope: session
        maxBytes: 8192
```

改完 profile 的 `cordis.patch.yml` 后重启 dsh（由 pm2 托管时用 `pm2 restart dsh`）；profile 文件在启动时读取。

---

## 数据落点

| 作用域 | 存储位置 | 何时写 | 持久性 |
|---|---|---|---|
| global | `$DSH_HOME/rules/global.json` | 任一命令 / API 提交时 | ✅ 跨重启 |
| session | `$DSH_HOME/rules/sessions/<sessionId>.json` | 同上 | ✅ 跨重启 |
| project | `$DSH_HOME/rules/projects/<slug>.json`（slug 来自会话 cwd；无 cwd 则不落盘） | 同上 | ✅ 跨重启 |
| 模板库 | `$DSH_HOME/rules/templates.json`（全局共享，不绑作用域） | 模板增删改 / 导入 / 套用计数时 | ✅ 跨重启 |

> `$DSH_HOME` 由 `@deepseek-ai/dsh-home-paths` 解析，默认 `~/.dsh`。
>
> **读取永不抛出。** 读写走 `ctx.fs`（`resolve/stat/readText`；写入时自动建目录）。文件缺失就是空作用域；
> 文件损坏或被手改坏时，该作用域降级为空 **外加一条 `problems` 记录**——失败会被报出来（命令输出追加
> `⚠ …` 行，面板显示告警），但绝不会让步骤失败。**写盘是整文件替换**（磁盘上没有「局部修改」），
> 所以一次写入要么是新完整文件，要么什么都不写。
>
> **并发写有保护。** 每次写入都携带读取时那份文件的 freshness token。若期间文件被改过（另一个面板窗口、
> 另一条命令），写入会被**拒绝**——命令返回冲突提示让你重试，HTTP API 返回 `409`——而不是静默覆盖别人的修改。
>
> **不再产生空文件。** 只有真正变化的作用域才会被重写，空作用域且磁盘上没有文件时**不创建文件**。
>（旧版本会给每个会话在 `$DSH_HOME/rules/sessions/` 下留一个 3 字节的 `[]` 文件；那些历史文件无害，
> 可安全手动删除——新的不会再产生。）
>
> **`project` 规则已进入模型上下文。** 当会话声明了工作目录时，该目录的 project 规则会被读取并注入到
> `Project requirements (this directory only):` 之下，具体优先（`project > session > global`）。
> 项目文件名是**会话 cwd 的 slug**：`\ / : * ? " < > |` 这些字符会被替换为 `_`，首尾 `_` 会被去掉，
> 若 cwd 全部由这些字符组成则退化为字面量 `_`。无会话或无 `cwd` 时没有项目标识，因此不落盘
>（HTTP API 对这类写入返回 `400`）。

---

## 客户端面板（可选）

发布包还暴露一个 dsh web 客户端面板（`lib/client.js`，见 `package.json` 的 `exports` 里的 `./client`），通过宿主 HTTP API `/baize-rules.api` 与命令共用同一套 store/core。

### 面板入口

面板把自己注册进 dsh 客户端插槽 `ctx.slots.inject('conversation.view')`——面板就是该会话视图环里的一个页签，数据与 `/baize-rules` 命令完全一致：

- **会话内「规则」页签**——会话打开时，面板就是该会话视图环里的一个页签，这是**唯一入口**。
- **0.2.4 起不再有侧边栏底部的「规则」按钮**：原先那个按钮位于「设置」上方，并兼任新会话页全屏浮层的入口；按钮、浮层与它专属的侧边栏底部布局样式一并移除。

> **新会话页没有入口**（已知取舍）：尚无会话时没有页签环，0.2.4 之后也就没有面板入口。规则注入与 `/baize-rules` 命令都不受影响。

面板分两页：

- **规则页**：作用域切换（对话 / 项目 / 全局）、标签 chip 筛选、每行 `编辑 / 存为模板 / 删除`。每行会显示该规则是**启用还是停用**，并可一键切换（不必再退回 `/baize-rules disable`）。新建规则走结构化的 `rule.add` op，所以你输入的正文不会被当成命令行重新解析，也不会因尾部作用域关键词被截断；提交失败时输入框**保留原文**，不用重打。响应里的 `problems` 会在面板上显示为告警。键盘与读屏可访问性也已补齐（页签的 `role`/`aria` 状态、模态对话框语义与焦点管理、标签 chip 上的 `aria-pressed`）。
- **模板页**：新建/编辑（内容 + 标签）/删除、`加入规则`（选作用域直接套用）、`导出`（下载 JSON）/`导入`（选文件 → 先看 dry-run 预览 → 确认）。

> **模板是内容副本。** 规则行的「**存为模板**」（`Save as template`；这一功能也常被叫作「**加入模板**」，是同一个按钮）
> 会把该规则的正文 + 标签的快照存进模板库。把模板加入某作用域，是按模板内容**新建一条规则**：
> 之后两者各不相干，改模板**不会**回写已加入的规则，改规则也不会改到它来自的模板。
>
> 面板里串起来的一条操作路径：规则行「**存为模板**」→ 切到「**模板**」页编辑内容与标签 →
> 回到「**规则**」页打开「**从模板**」勾选需要的条目 → 选作用域加入。

> **作用域可用性**：面板只在**绑定了会话**时才提供「对话」「项目」两个作用域——宿主没有给出 `sessionId` 时这两个按钮会置灰并给出提示，只能编辑「全局」规则。这样是为了避免旧版那种"显示添加成功、规则随即消失"的假成功。
>
> 项目目录**不需要**面板传递：宿主会用会话的 cwd 自行解析（`resolveProject`），所以只要在会话里，「项目」作用域就一直可用。

API：

- `GET /baize-rules.api?sessionId=…&project=…` → `{ global, session, project, templates, problems }`
- `POST /baize-rules.api`，body `{ sessionId, project, op, … }` → `{ ok, text, view, templates, problems, … }`
  - `op: 'raw'`（默认，兼容旧面板）`{ raw, scope }` —— 一条命令字符串，走与 `/baize-rules` 相同的 core
  - 规则：`rule.add` `{ scope, text }`、`rule.update`、`rule.setTags`、`rule.setEnabled` `{ scope, ruleId, enabled }`、`rule.saveAsTemplate`、`rule.addFromTemplates`
  - 模板：`template.create`、`template.update`、`template.delete`、`template.export`、`template.import`
  - 每个 op 都返回变更后的 `view`、`templates` **与 `problems`**，面板一次调用即可刷新两个页面并显示任何读不出来的存储
- **失败语义**（拒绝时响应体都带 `text`，只有 `500` 返回 `{ error }`）：

  | 状态码 | 含义 |
  |---|---|
  | `400` | 请求被拒：JSON body 格式错误、`raw` 为空、缺 `ruleId`/`text`，或编辑了本次请求没有存储键的作用域（无会话、无 cwd） |
  | `403` | 来源被拒——**仅在 `apiOriginCheck: true` 时出现**：请求**并非来自本机**（来源地址不是 loopback），或浏览器声明的 `Origin` 既不是宿主自身的源、也不是本地页面（跨站）。默认关闭，因此反代前置的 Web UI 不会遇到它 |
  | `405` | 非 `GET`/`POST` 方法 |
  | `409` | 并发冲突——文件在读取之后被改过，什么都没写入，需刷新重试 |
  | `413` | 请求 body 超过 1 MiB |
  | `500` | 服务端意外失败，返回 `{ error }` |

---

## 模块结构

```
src/rules.ts      纯逻辑：Rule/RuleTemplate 模型 + 标签归一化 + 渲染/<system-reminder>/字节预算(具体优先)/digest/escapeReminder
src/core.ts       纯逻辑：parseCommand/runCommand/作用域解析/CRUD/模板库操作/模板导入导出（零依赖，可脱离 dsh 单测）
src/store.ts      纯逻辑：global/session/project 规则文件 + templates.json 持久化；容错读取（空作用域 + `problems`）与带版本号的写入保护（ctx.fs + dshHomePath）
src/command.ts    薄 dsh 适配：喂 view/templates/defaultScope → core，持久化 nextView/nextTemplates；tmpl export|import 的文件 IO；追加 `⚠ …` 告警行
src/index.ts      apply：agent/pre-step 注入 + /baize-rules 命令注册 + API 挂载（inject: agents/commands/fs/webServer/sessions）
src/api.ts        Host HTTP API：GET + POST(op 分派) /baize-rules.api（来源校验、1 MiB body 上限、写冲突返回 409），供前端面板
src/invariant.ts  dsh-invariants 契约 companion（name/inject/apply）
scripts/dev-render.ts  Loop 0 演示
test/*.spec.ts    rules/core/composition/regression 测试
cordis.patch.yml  挂载元数据（insert baize-rules 插件行 + 默认配置）
```

**公共入口**（见 `package.json` 的 `exports`）：`.`（index）、`./invariant`、`./client`、`./src/*`。

---

## 开发与即时反馈

```bash
pnpm dev:render            # 打印模型实际会看到的 <system-reminder> 文案（支持预算参数）
pnpm test                  # 跑单元 + REAL-composition 测试，再跑客户端冒烟测试
pnpm test:watch            # 保存即重跑
pnpm test:client           # 只跑客户端面板冒烟测试（node test/client.smoke.mjs）
pnpm build                 # tsc -p tsconfig.build.json → lib/
pnpm typecheck             # tsc --noEmit
pnpm check:exports         # 校验 package.json `exports` 承诺的每个路径真实存在
```

改 `src/rules.ts`（渲染）或 `src/core.ts`（命令决策）里的纯函数，重跑 `pnpm dev:render` 即可看到变化——**最快的反馈回路**（亚秒级，不碰 dsh）。

---

## 发布

发布由 `v*` tag 驱动，但**真正把版本发出去的是本地命令**。`.github/workflows/ci.yml` 的 `publish` job 需要 `NPM_TOKEN` secret，而本仓库并未配置，因此每次 tag 运行都会以 `npm error code ENEEDAUTH` 失败（已在 v0.1.3、v0.1.4、v0.1.5 上验证）。在这个 secret 配置好之前，`npm publish --access public` 才是实际发布动作。

```bash
# 1. 升版本：更新 package.json 的 version + 两份 README 里的安装示例
# 2. 本地验证
pnpm build && pnpm typecheck && pnpm test
# 3. 提交、打 tag 并推送（tag 运行仍提供 CI 的 build+test 把关）
git add -A && git commit -m "release: vX.Y.Z"
git tag -a vX.Y.Z -m "vX.Y.Z" && git push origin main && git push origin vX.Y.Z
# 4. 发布——这一步才真正发出去
npm publish --access public
```

`publish` job 在 `v*` tag 时运行、需 `test` 通过；在 `NPM_TOKEN` 加进仓库 secrets 之前，它会一直显示失败。

> **凭据。** `npm publish` 用的是你自己的 npm 凭据——`~/.npmrc` 里已有的，或通过环境变量提供的。
> 仓库根目录的 `.npmrc` 已在 `.gitignore` 里，请让它保持被忽略：不要提交 token，也不要把 token
> 贴进 issue、README 或 CI 日志。

---

## 变更日志

见 [CHANGELOG.md](./CHANGELOG.md)。

## 许可证

[MIT](./LICENSE)
