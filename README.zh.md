# dsh-baize-rules

![npm version](https://img.shields.io/npm/v/dsh-baize-rules)
![license](https://img.shields.io/npm/l/dsh-baize-rules)

> English: *`dsh-baize-rules` (Baize) is a dsh plugin that injects user-set, durable "must-do / must-not" requirements — plain-text rules — into the model at conversation start as a sourced `user/message`.*

[dsh](https://www.npmjs.com/package/@deepseek-ai/dsh) 的**会话 / 全局「必须做 / 不能做」要求**插件。名字取自**白泽**——传说中「通万物之情、晓万物之名、知万物之理」的神兽，用它来承载「用户给模型立下的行为基线」。

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

---

## 安装

> dsh 插件从 npm 仓库分发，通过 `dsh plugin` 安装到某个 profile。

```bash
# 从 npm 安装到 web profile（版本以发布后的实际版本为准）
dsh plugin --profile web add dsh-baize-rules@0.1.3
pm2 restart dsh          # dsh 由 pm2 托管时重载生效
dsh --profile web
```

安装时依赖的 peer 包（`@deepseek-ai/` 系列、`react` 等）由 dsh profile 提供；若缺少，pnpm 会在 profile 目录里按 `peerDependencies` 解析。

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
```

---

## 命令

所有子命令挂在 **`/baize-rules`** 下；无参数时等价于 `list`。

```
/baize-rules [list|add <text>|remove <id>|edit <id> <text>|enable|disable <id>|scope <global|session|project>|clear <scope>|export]
```

| 子命令 | 语法 | 作用 |
|---|---|---|
| **list** | `/baize-rules list` | 列出合并后的生效规则（`Project`/`Global`/`Session` 节；空时显示 `No active rules.`） |
| **add** | `/baize-rules add <text>` | 追加一条规则到目标作用域（默认 `scope`）；文本即规则 |
| **remove** | `/baize-rules remove <id>` | 按**完整 id** 删除一条规则 |
| **edit** | `/baize-rules edit <id> <text>` | 修改某条规则的文本 |
| **enable** | `/baize-rules enable <id>` | 启用一条被停用的规则 |
| **disable** | `/baize-rules disable <id>` | 停用一条规则（保留但不生效） |
| **scope** | `/baize-rules scope <global\|session\|project>` | 切换后续命令的默认作用域（持久到当前进程） |
| **clear** | `/baize-rules clear <global\|session\|project>` | 清空某作用域的全部规则 |
| **export** | `/baize-rules export` | 以 JSON 导出 `{ global, session }` |

**参数细节**

- `<text>`：规则正文，可含空格；是「必须做」还是「不能做」由正文语言表达，无标记。
- `<id>`：规则的稳定 id（`crypto.randomUUID`）。`list` 显示**前 8 位缩略 id** 便于阅读；
  执行 `remove`/`edit`/`enable`/`disable` 时请提供**完整 id**（可用 `list` 或 `export` 查看完整 id）。

### 作用域写法

`add/remove/edit/enable/disable` 支持**显式作用域**，两种等价写法：

- **前缀**：`/baize-rules global add 用中文。`
- **后缀**：`/baize-rules add 用中文。 global`（仅当作用域是**最后一个 token** 时）

> 只有 `add/remove/edit/enable/disable` 会把**末尾**的作用域关键字识别为作用域修饰；
> `scope`/`clear` 的参数本身就是作用域，不会被吞。因此正文里含 `global`/`session` 不会被误判
>（例如 `/baize-rules add 用global写`）。

未指定作用域时，用 `/baize-rules scope` 设定的默认值（初始来自配置文件 `Config.scope`，通常 `session`）。

---

## 注入行为（模型上下文如何被改变）

- **会话起点基线**：会话开始时，`agent/pre-step`（`prepend:true`）把生效规则作为一条 `user/message` 插入请求，内容为 `<system-reminder>` 框架，`source.kind='plugin'`、`plugin='baize-rules'`、`form='snapshot'`。
- **具体优先**：`project > session > global`；预算受限时优先裁剪较宽泛的 `global` 规则。
- **去重**：对渲染文本算 SHA-1 digest，规则不变则不重复注入；`injectAtEveryStep:true` 时每步强制刷新。
- **转义**：正文里的 `</system-reminder>` 会被 `escapeReminder` 转义。
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

> `$DSH_HOME` 由 `@deepseek-ai/dsh-home-paths` 解析，默认 `~/.dsh`。
> 读写走 `ctx.fs`（`resolve/stat/readText/writeText`，写时自动建目录）；缺失容忍、损坏文件 failing-loud。
> **注意**：`project` 规则可通过命令管理并落盘，但**当前 pre-step 注入视图只包含 `global` + `session`**，故 `project` 规则暂未进入模型上下文（预留/实验性）。

---

## 客户端面板（可选）

发布包还暴露一个 dsh web 客户端面板（`lib/client.js`，见 `package.json` 的 `exports` 里的 `./client`），通过宿主 HTTP API `/baize-rules.api` 与命令共用同一套 store/core：

- `GET /baize-rules.api?sessionId=…&project=…` → `{ global, session, project }`
- `POST /baize-rules.api`，body `{ sessionId, raw, scope }` → `{ ok, text, view }`

---

## 模块结构

```
src/rules.ts      纯逻辑：Rule 模型 + 渲染/<system-reminder>/字节预算(具体优先)/digest/escapeReminder
src/core.ts       纯逻辑：parseCommand/runCommand/作用域解析/CRUD（零依赖，可脱离 dsh 单测）
src/store.ts      纯逻辑：global/session/project 规则文件持久化（ctx.fs + dshHomePath）
src/command.ts    薄 dsh 适配：喂 view/defaultScope → core，持久化 nextView/defaultScope
src/index.ts      apply：agent/pre-step 注入 + /baize-rules 命令注册 + API 挂载（inject: agents/commands/fs/webServer/sessions）
src/api.ts        Host HTTP API：GET/POST /baize-rules.api（供前端面板）
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

发布是**单一来源**：升版本号、推送 `v*` tag，由 GitHub Actions 自动发布到 npm；**请勿在本地手动 `npm publish`**——否则会跟 tag 触发的发布冲突（同一版本无法重复发布）。

```bash
# 1. 升版本：更新 package.json 的 version + 两份 README 里的安装示例
# 2. 本地验证
pnpm build && pnpm test
# 3. 提交并推送 tag，触发 CI 发布
git add -A && git commit -m "release: vX.Y.Z"
git tag vX.Y.Z && git push origin main --tags
```

`.github/workflows/ci.yml` 的 `publish` job 在 `v*` tag 时运行，需 `test` 通过，并使用 GitHub `NPM_TOKEN` secret。

---

## 变更日志

见 [CHANGELOG.md](./CHANGELOG.md)。

## 许可证

[MIT](./LICENSE)
