# dsh-baize-rules

**[English](README.md) | 简体中文**

[![Listed on dsh-plugin.org](https://dsh-plugin.org/badges/listed.svg)](https://dsh-plugin.org/plugins/bvcvb/dsh-baize-rules)
![npm version](https://img.shields.io/npm/v/dsh-baize-rules)
![license](https://img.shields.io/npm/l/dsh-baize-rules)

> English: *`dsh-baize-rules` (Baize) is a dsh plugin that injects user-set, durable "must-do / must-not" requirements — plain-text rules — into the model at conversation start as a sourced `user/message`.*

[dsh](https://www.npmjs.com/package/@deepseek-ai/dsh) 的**会话 / 全局「必须做 / 不能做」要求**插件。名字取自**白泽**——传说中「通万物之情、晓万物之名、知万物之理」的神兽，用它来承载「用户给模型立下的行为基线」。

![dsh web UI 里的「规则」面板——作用域标签（对话 / 项目 / 全局）、添加规则输入框与已生效规则列表](https://raw.githubusercontent.com/bvcvb/dsh-baize-rules/HEAD/assets/001-rules-panel.png)

- 规则是**纯文本**，没有 `must`/`mustNot` 标记——「必须做 / 不能做」由正文语言表达（例如 `用中文写注释。`=必须，`不要删除测试。`=禁止）。
- 注入发生在**会话起点**：把当前生效规则作为一条**持久** `user/message` 注入模型请求，套用 `<system-reminder>` 框架，来源标记为 `source.kind='plugin'`、`plugin='baize-rules'`。
- **无规则则不注入**；字节预算小到裁光所有规则时返回 `undefined`，绝不注入空壳 reminder。

---

## 功能特性

| 特性 | 说明 |
|---|---|
| **三作用域** | `global`（所有会话）/ `session`（当前会话）/ `project`（按会话工作目录，**实验性**） |
| **持久化** | 全部落盘到 `$DSH_HOME`（默认 `~/.dsh`），跨会话、跨重启 |
| **具体优先** | 渲染顺序 `project > session > global`；字节预算受压时优先保留更具体的规则 |
| **去重** | 按渲染文本 SHA-1 digest 抑制重复注入；`injectAtEveryStep` 可选每步强制刷新 |
| **防逃逸** | 正文里的字面 `</system-reminder>` 会被转义，防止用户文本关闭插件框架 |
| **命令 + API 同源** | `/baize-rules` 命令与前端面板共用同一套 store/core，改动始终同一真值 |
| **标签分类** | 规则可带文字标签（`流程`、`#前端`…），面板按标签筛选。默认**只用于分类**，不占模型上下文预算（`injectTags` 可开） |
| **模板库** | 常用规则存成模板（内容 + 标签），任意作用域一键套用；可导出/导入 JSON，跨机器、跨会话复用 |

---

## 安装

> dsh 插件从 npm 仓库分发，通过 `dsh plugin` 安装到某个 profile。

```bash
# 从 npm 安装到 web profile（版本以发布后的实际版本为准）
dsh plugin --profile web add dsh-baize-rules@0.2.0
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
dsh plugin --profile smoke add dsh-baize-rules@0.2.0
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
/baize-rules list                              # 显示 global + session（含缩略 id / disabled 标注）
/baize-rules edit <id> 只用 pnpm 构建。          # 修改某条规则文本
/baize-rules disable <id>                      # 停用某条（保留不删）
/baize-rules enable <id>                       # 重新启用
/baize-rules scope global                      # 之后命令默认写到 global
/baize-rules clear session                     # 清空当前会话规则
/baize-rules export                            # 导出全部规则为 JSON
# —— 标签 ——
/baize-rules tag <id> 流程 发布                  # 给规则打标签（幂等、去重）
/baize-rules untag <id> 发布                    # 去掉某个标签
# —— 模板 ——
/baize-rules save <id>                          # 把这条规则存成模板
/baize-rules tmpl list                          # 查看模板库（可按标签筛选过滤）
/baize-rules from <id|#标签>                     # 从模板添加规则（#标签 = 该标签下全部）
/baize-rules tmpl export ./templates.json       # 导出模板库到 JSON 文件
/baize-rules tmpl import ./templates.json --yes # 导入（默认 dry-run 预览，--yes 才写盘）
```

---

## 命令

所有子命令挂在 **`/baize-rules`** 下；无参数时等价于 `list`。

```
/baize-rules [list|add <text>|remove <id>|edit <id> <text>|enable|disable <id>|tag|untag <id> <tag…>|save <id> [#tag…]|from <id|#tag> [scope]|tmpl <list|add|edit|rm|export|import>|scope <global|session|project>|clear <scope>|export]
```

![斜杠命令菜单里的 `/baize-rules` 条目：查看/增删改 会话或全局的 必须/禁止 要求](https://raw.githubusercontent.com/bvcvb/dsh-baize-rules/HEAD/assets/002-command.png)

| 子命令 | 语法 | 作用 |
|---|---|---|
| **list** | `/baize-rules list` | 列出合并后的生效规则（`Project`/`Global`/`Session` 节；空时显示 `No active rules.`） |
| **add** | `/baize-rules add <text>` | 追加一条规则到目标作用域（默认 `scope`）；文本即规则 |
| **remove** | `/baize-rules remove <id>` | 删除一条规则（id 或**唯一前缀**） |
| **edit** | `/baize-rules edit <id> <text>` | 修改某条规则的文本 |
| **enable** | `/baize-rules enable <id>` | 启用一条被停用的规则 |
| **disable** | `/baize-rules disable <id>` | 停用一条规则（保留但不生效） |
| **tag** | `/baize-rules tag <id> <tag…>` | 给规则**追加**标签（幂等、去重、大小写不敏感） |
| **untag** | `/baize-rules untag <id> <tag…>` | 移除指定标签 |
| **save** | `/baize-rules save <id> [#tag…]` | 把这条规则存成模板；同内容模板已存在时合并标签 |
| **from** | `/baize-rules from <id\|#tag> [scope]` | 从模板添加规则；`#tag` 一次加入该标签下**全部**模板 |
| **tmpl** | `/baize-rules tmpl <子命令>` | 模板库管理（见下） |
| **scope** | `/baize-rules scope <global\|session\|project>` | 切换后续命令的默认作用域（持久到当前进程） |
| **clear** | `/baize-rules clear <global\|session\|project>` | 清空某作用域的全部规则 |
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

`add/remove/edit/enable/disable` 支持**显式作用域**，两种等价写法：

- **前缀**：`/baize-rules global add 用中文。`
- **后缀**：`/baize-rules add 用中文。 global`（仅当作用域是**最后一个 token** 时）

> 只有 `add/remove/edit/enable/disable/from` 会把**末尾**的作用域关键字识别为作用域修饰；
> `scope`/`clear` 的参数本身就是作用域，不会被吞。因此正文里含 `global`/`session` 不会被误判
>（例如 `/baize-rules add 用global写`）。
>
> 带自由标签文本的动词（`tag`/`untag`/`save`）**只支持前缀写法**：`/baize-rules global tag <id> 前端`。
> 这样即使标签名恰好叫 `project`/`global`/`session`，也不会被当成作用域吞掉。

未指定作用域时，用 `/baize-rules scope` 设定的默认值（初始来自配置文件 `Config.scope`，通常 `session`）。

---

## 注入行为（模型上下文如何被改变）

- **会话起点基线**：会话开始时，`agent/pre-step`（`prepend:true`）把生效规则作为一条 `user/message` 插入请求，内容为 `<system-reminder>` 框架，`source.kind='plugin'`、`plugin='baize-rules'`、`form='snapshot'`。
- **具体优先**：`project > session > global`；预算受限时优先裁剪较宽泛的 `global` 规则。
- **去重**：对渲染文本算 SHA-1 digest，规则不变则不重复注入；`injectAtEveryStep:true` 时每步强制刷新。
- **转义**：正文里的 `</system-reminder>` 会被 `escapeReminder` 转义。
- **标签不入模型**：标签默认**不**注入（`injectTags:false`），所以给规则打标签/改标签既不改变模型看到的文本，也不会触发重复注入。
- **空 / 全裁**：无规则、或预算裁光所有规则时返回 `undefined`（即不注入该消息）。

### 模型实际看到的形态

```markdown
<system-reminder>
The following user requirements apply to every step of this conversation. Obey them.
More specific instructions take precedence over broader ones. They do not override system, developer, or direct user instructions.

Session requirements (this conversation only):
- 插件每次都要隔离测试后才能部署。

Global requirements:
- 用中文写注释。
- 不要删除或改写现有的测试。
</system-reminder>
```

---

## 配置（`Config`）

插件启动时用 `@deepseek-ai/schemastery` 校验 `Config`；非法值会令插件加载失败。

| 配置 | 默认 | 说明 |
|---|---|---|
| `scope` | —（必填） | 默认作用域，`/baize-rules` 未指定时使用；仅允许 `global`/`session` |
| `maxBytes` | —（必填） | 模型可见字节上限；超出时按「具体优先」裁剪 |
| `globalRulesPath` | `$DSH_HOME/rules/global.json` | 覆盖全局规则文件路径 |
| `injectAtEveryStep` | `false` | 每步强制重渲（调试用）；默认为仅变化时打补丁 |
| `injectTags` | `false` | 为 `true` 时把标签渲染进模型上下文（`- [流程,发布] 正文`）。默认关闭：标签是给人看的分类器，注入会占预算并添噪声 |

### 挂载元数据（`cordis.patch.yml`）

发布的 npm 包里携带 `dsh.bundle.patch`，安装 `dsh-baize-rules@<version>` 时由 dsh 自动接入：
`cordis.patch.yml` 中 `insert` 一行插件，默认 `scope: session`、`maxBytes: 8192`。如需调整默认作用域 / 预算，改这里即可。

---

## 数据落点

| 作用域 | 存储位置 | 何时写 | 持久性 |
|---|---|---|---|
| global | `$DSH_HOME/rules/global.json` | 任一命令 / API 提交时 | ✅ 跨重启 |
| session | `$DSH_HOME/rules/sessions/<sessionId>.json` | 同上 | ✅ 跨重启 |
| project | `$DSH_HOME/rules/projects/<slug>.json`（slug 来自会话 cwd） | 同上 | ✅ 跨重启 |
| 模板库 | `$DSH_HOME/rules/templates.json`（全局共享，不绑作用域） | 模板增删改 / 导入 / 套用计数时 | ✅ 跨重启 |

> `$DSH_HOME` 由 `@deepseek-ai/dsh-home-paths` 解析，默认 `~/.dsh`。
> 读写走 `ctx.fs`（`resolve/stat/readText/writeText`，写时自动建目录）；缺失容忍、损坏文件 failing-loud。
> **注意**：`project` 规则可通过命令管理并落盘，但**当前 pre-step 注入视图只包含 `global` + `session`**，故 `project` 规则暂未进入模型上下文（预留/实验性）。

---

## 客户端面板（可选）

发布包还暴露一个 dsh web 客户端面板（`lib/client.js`，见 `package.json` 的 `exports` 里的 `./client`），通过宿主 HTTP API `/baize-rules.api` 与命令共用同一套 store/core。

面板分两页：

- **规则页**：三作用域切换、标签 chip 筛选、每行 `编辑 / 存为模板 / 删除`、以及「从模板」批量勾选添加。
- **模板页**：新建/编辑（内容 + 标签）/删除、`加入规则`（选作用域直接套用）、`导出`（下载 JSON）/`导入`（选文件 → 先看 dry-run 预览 → 确认）。

> **作用域可用性**：面板只在**绑定了会话**时才提供「对话」「项目」两个作用域——在新会话页打开的面板（尚无会话）这两个按钮会置灰并给出提示，只能编辑「全局」规则。这样是为了避免旧版那种"显示添加成功、规则随即消失"的假成功。
>
> 项目目录**不需要**面板传递：宿主会用会话的 cwd 自行解析（`resolveProject`），所以只要在会话里，「项目」作用域就一直可用。

API：

- `GET /baize-rules.api?sessionId=…&project=…` → `{ global, session, project, templates }`
- `POST /baize-rules.api`，body `{ sessionId, project, op, … }` → `{ ok, text, view, templates }`
  - `op: 'raw'`（默认，兼容旧面板）`{ raw, scope }` —— 一条命令字符串，走与 `/baize-rules` 相同的 core
  - 规则：`rule.update`、`rule.setTags`、`rule.saveAsTemplate`、`rule.addFromTemplates`
  - 模板：`template.create`、`template.update`、`template.delete`、`template.export`、`template.import`
  - 每个 op 都返回变更后的 `view` 与 `templates`，面板一次调用即可刷新两个页面

---

## 模块结构

```
src/rules.ts      纯逻辑：Rule/RuleTemplate 模型 + 标签归一化 + 渲染/<system-reminder>/字节预算(具体优先)/digest/escapeReminder
src/core.ts       纯逻辑：parseCommand/runCommand/作用域解析/CRUD/模板库操作/模板导入导出（零依赖，可脱离 dsh 单测）
src/store.ts      纯逻辑：global/session/project 规则文件 + templates.json 持久化（ctx.fs + dshHomePath）
src/command.ts    薄 dsh 适配：喂 view/templates/defaultScope → core，持久化 nextView/nextTemplates；tmpl export|import 的文件 IO
src/index.ts      apply：agent/pre-step 注入 + /baize-rules 命令注册 + API 挂载（inject: agents/commands/fs/webServer/sessions）
src/api.ts        Host HTTP API：GET + POST(op 分派) /baize-rules.api（供前端面板）
src/invariant.ts  dsh-invariants 契约 companion（name/inject/apply）
scripts/dev-render.ts  Loop 0 演示
test/*.spec.ts    rules/core/composition 测试
cordis.patch.yml  挂载元数据（insert baize-rules 插件行 + 默认配置）
```

**公共入口**（见 `package.json` 的 `exports`）：`.`（index）、`./invariant`、`./client`、`./src/*`。

---

## 开发与即时反馈

```bash
pnpm dev:render            # 打印模型实际会看到的 <system-reminder> 文案（支持预算参数）
pnpm test                  # 跑单元 + REAL-composition 测试
pnpm test:watch            # 保存即重跑
pnpm build                 # tsc -p tsconfig.build.json → lib/
pnpm typecheck             # npx tsc --noEmit
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

---

## 变更日志

见 [CHANGELOG.md](./CHANGELOG.md)。

## 许可证

[MIT](./LICENSE)
