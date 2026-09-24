# fix-mermaid

**一个直接修复 LLM 生成的 Mermaid 语法错误的js库。**

LLM 大多数时候能写出正确的 Mermaid，但总有一部分图渲染失败。常见原因有：全角标点、标签里有括号却没加引号、用 `end` 当节点 ID、漏写 `end`、饼图数值带 `%`、脑图写成了 Markdown 列表。`fix-mermaid` 是一个零依赖的 JavaScript 小模块，在渲染前把这些错误修好，让用户看到的是图，而不是 `Syntax error in text`。

[English](./README.md)

![修复前后对比：流程图中的全角符号](docs/images/F02.png)

## 亮点

- **前端直接可用**：它是一个只处理字符串的纯函数，不操作 DOM，没有依赖，也不需要构建。整个模块就是一个 ES Module 文件（约 28 KB，gzip 后约 10 KB），浏览器、Web Worker 和 Node 都能运行。
- **能修复大部分 LLM 输出的 Mermaid 语法错误**：覆盖流程图、时序图、类图、状态图、ER 图、饼图、柱状图/折线图（`xychart`）和脑图。在真实浏览器测试中，20 个可修复的错误图全部修复后正确渲染。
- **不会改坏正确的图**：`safeRepairMermaid` 会先用你渲染时用的同一个 `mermaid.parse` 做校验。能通过的原样返回；修复后的代码也会再校验一次，通过了才使用。
- **能发现"能解析但画错"的图**：比如脑图节点 `数学(微积分)` 能通过解析，但括号外的文字会丢掉。语义检查能识别这种写法并修复。
- **修不好也不会白屏**：配套的渲染封装会降级为展示源码，并附上复制按钮，不会出现空白或报错堆栈。
- **支持流式输出**：LLM 还在生成时，半截代码不会闪出报错，画面保留上一次成功的图，生成结束后再做最终渲染。
- **可观测**：每次修复都会列出命中了哪些规则（`fixes`），可以用来持续改进 prompt 和规则。
- **兼容性好**：没有使用正则后行断言，支持 iOS/Safari 13.4+、Chrome 80+、Firefox 78+。



## 快速开始



### 1. 安装

可以任选下面一种方式：

```bash
# 方式 A：从 GitHub 安装
npm install github:xillkey/fix-mermaid

# 方式 B：直接把文件复制进项目（没有任何依赖）
curl -O https://raw.githubusercontent.com/<your-github-name>/fix-mermaid/main/src/fixMermaid.js
```

```html
<!-- 方式 C：通过 CDN 引入，不需要构建 -->
<script type="module">
  import { fixMermaid } from 'https://cdn.jsdelivr.net/gh/xillkey/fix-mermaid@main/src/fixMermaid.js';
</script>
```

渲染和校验还需要 `mermaid` 本身（`npm install mermaid`），已在 Mermaid 11 上测试。

### 2. 30 秒上手：修复一段字符串

```js
import { fixMermaid } from 'fix-mermaid';

const llmOutput = 'flowchart LR\nA【用户】——>B（登录服务）\nB --> C[调用接口(v2)]';
const { code, changed, fixes } = fixMermaid(llmOutput);

console.log(code);
// flowchart LR
// A["用户"]-->B("登录服务")
// B --> C["调用接口(v2)"]
console.log(fixes); // 命中的修复规则
```



### 3. 推荐用法：校验 → 修复 → 再校验

`fixMermaid` 每次都会执行规则。线上建议用 `safeRepairMermaid`，它只处理真正解析失败的代码：

```js
import mermaid from 'mermaid';
import { safeRepairMermaid, createMermaidParser } from 'fix-mermaid';

mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });
const parse = createMermaidParser(mermaid);

const r = await safeRepairMermaid(llmOutput, parse);
if (r.ok) {
  const { svg } = await mermaid.render('diagram-1', r.code);
  container.innerHTML = svg;
} else {
  container.textContent = llmOutput; // 降级：展示源码
}
```



### 4. 使用渲染封装（可选）

`src/mermaid-render.js` 把整条流程都封装好了：校验、修复、渲染、缓存、降级、上报和流式处理。

```js
import { setupMermaid, renderMermaidSafe, hydrateMermaid } from 'fix-mermaid/render';

setupMermaid({
  theme: 'auto',                        // 'light' | 'dark' | 'auto'
  onReport: (r) => sendMetrics(r),      // { ok, code, fixes, originalError, error, source }
});

await renderMermaidSafe(element, llmOutput);  // 渲染单张图
await hydrateMermaid(messageElement);         // Markdown 渲染完成后，把所有 ```mermaid 代码块换成图
```

> `mermaid-render.js` 用的是裸模块名 `'mermaid'`。在 Vite、webpack 中可以直接使用；不用打包工具时，需要像 `examples/demo.html` 那样加一段 import map。



### 5. 流式输出

```js
import { createStreamingMermaid } from 'fix-mermaid/render';

const stream = createStreamingMermaid(element);
onToken((textSoFar) => stream.update(textSoFar));   // 生成过程中不会闪出报错
onDone((fullText) => stream.update(fullText, { done: true }));
```



### 6. React

```jsx
import MermaidBlock, { MarkdownCode } from './examples/MermaidBlock.jsx';

<MermaidBlock code={text} streaming={!messageDone} />

// 配合 react-markdown
<ReactMarkdown components={{ code: MarkdownCode }}>{markdown}</ReactMarkdown>
```



### 7. 运行示例

```bash
git clone https://github.com/xillkey/fix-mermaid.git
cd fix-mermaid
python3 -m http.server 8765        # 或者：npx serve .
# 打开 http://localhost:8765/examples/demo.html
```

示例页面会把每个错误样例的**修复前**和**修复后**并排展示。页面上还有一个"模拟流式输出"按钮，可以直接对比闪烁问题和修复后的效果。

![前端调用示例：修复前后对比](docs/images/demo.png)

## 能修复哪些错误


| 图类型                  | 能修复的常见 LLM 错误                                                                                                                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 通用                   | 图前后的说明文字和 ````mermaid `围栏（包括流式输出中还没闭合的围栏）；零宽字符和全角空格；缺少图类型声明；类型名大小写错误或写成别名（`pie chart`、`lineChart`、`mindMap`）；流程图缺少方向                                                                        |
| 流程图                  | 标签含 `() [] {} / : ; "` 却没加引号；`/api/users` 被误识别成梯形；全角 `【】（）` 被当作形状；`——>`、`→`、`->`、`=>` 等箭头写法；`-- 文本 -->` 形式的边文本；用 `end` 当节点 ID；subgraph 标题含空格；`subgraph` 和 `end` 数量不匹配；`click` 指令（出于安全考虑会删除） |
| 时序图                  | 全角冒号；消息缺冒号（`A->>B 消息`）；消息里有分号；非法箭头（`=>`）；`loop/alt/opt/par` 等块没闭合；孤立的 `deactivate` 和 `-` 标记                                                                                                 |
| 类图 / 状态图 / ER 图      | `{ }` 不平衡，并按缩进推断右括号应补在哪里；全角冒号；ER 关系标签没加引号或缺失                                                                                                                                                |
| 饼图                   | 标签没加引号、用了单引号或中文引号；全角冒号；数值写成 `45%`、`¥1,200万`、`800 万元`；`title:` 后面多了冒号；没有数值的行会被删除（会记录在 `fixes` 中）；负数行会被删除                                                                                     |
| 柱状图 / 折线图（`xychart`） | 中文标题、坐标轴标题、类别和系列名没加引号；全角方括号和逗号；范围写成 `0 ~ 100` 或 `0 - 100`；`bar:`、`x-axis:` 后面多了冒号；数值带 `%` 或单位                                                                                               |
| 脑图                   | Markdown 标题（`#`、`##`）和列表符号（`-`、`*`、`1.`）转成缩进；出现多个根节点时挂到第一个根节点下；含括号的文本加引号；`数学(微积分)` 这类能解析但会丢字的写法                                                                                             |



| 饼图                         | 脑图                         |
| -------------------------- | -------------------------- |
| ![饼图](docs/images/P01.png) | ![脑图](docs/images/M02.png) |


![语义检查：脑图丢字](docs/images/M03.png)

## API



### `fixMermaid(input, options?) → { code, changed, fixes }`

同步执行规则修复，不会抛出异常。


| 选项            | 默认值     | 说明                       |
| ------------- | ------- | ------------------------ |
| `quoteAll`    | `false` | 给流程图的所有标签都加引号，而不只是有风险的标签 |
| `removeClick` | `true`  | 删除 `click` 指令            |


`fixes` 是一个数组，里面是命中规则的中文说明。

### `safeRepairMermaid(input, parse, options?) → Promise<{ ok, code, fixes, originalError, error }>`

1. 先解析原文。如果能通过、也没有发现可疑写法，就原样返回。
2. 否则执行 `fixMermaid`，然后再解析一次。
3. `ok: false` 表示修不好。这时可以降级展示源码，或者交给 LLM 修复。



### `createMermaidParser(mermaid) → (code) => Promise<string | null>`

把 Mermaid 实例包装成一个校验函数：代码合法时返回 `null`，不合法时返回错误信息。

### 渲染封装（`fix-mermaid/render`）


| 函数                                                 | 说明                                                            |
| -------------------------------------------------- | ------------------------------------------------------------- |
| `setupMermaid({ theme, onReport, mermaidConfig })` | 初始化 Mermaid，只需调用一次；默认开启 `securityLevel: 'strict'`，并配置了清晰的图表色板 |
| `renderMermaidSafe(el, source)`                    | 校验、修复、渲染；失败时降级为源码加复制按钮                                        |
| `compileMermaid(source)`                           | 执行同样的流程，但不操作 DOM；返回 `{ ok, svg, code, fixes, ... }`（带缓存）      |
| `hydrateMermaid(root)`                             | 把 `<pre><code class="language-mermaid">` 代码块替换成图              |
| `createStreamingMermaid(el, { delay })`            | 用于流式输出，返回 `{ update(source, { done }), cancel() }`            |
| `renderMermaidRaw(el, source)`                     | 不做任何修复、直接渲染原文，用于调试和对比                                         |


多次渲染会排队依次执行，避免 `mermaid.render` 并发冲突。结果按源码缓存（最多 200 条），同一段源码只上报一次。

## 工作原理

```
LLM 输出
   │
   ▼
mermaid.parse ── 通过 ──► 语义检查 ── 没问题 ──► 原样渲染
   │ 失败                   │ 可疑
   ▼                        ▼
fixMermaid（规则）──────► mermaid.parse ── 通过 ──► 渲染修复后的代码
                             │ 失败
                             ▼
                   展示源码 + 复制按钮（或交给 LLM 修复）
```

所有规则都是确定性的，几毫秒就能跑完。`fixMermaid` 不会主动删除节点或边。浏览器测试会在每次修复后统计渲染出的 SVG 中的节点、边、消息、扇区和柱子数量，以此来验证。

## 测试

```bash
npm install
npm test                      # 24 个用例，用真实的 mermaid.parse 校验（通过 jsdom 提供 DOM）
```

浏览器测试会在无头 Chromium 中分别渲染每个用例的修复前和修复后，并保存截图：

```bash
pip install playwright && playwright install chromium
python3 -m http.server 8765 &
python3 test/browser/run.py   # 截图保存在 test/browser/shots/
```

在 Mermaid 11.17.2 上的当前结果：


|                   | 数量          |
| ----------------- | ----------- |
| 测试用例              | 24          |
| 语法错误且可修复 → 修复成功   | **20 / 20** |
| 能解析但画错 → 语义检查修复   | 1           |
| 原文正确 → 未改动        | 2           |
| 已知边界 → 按预期降级为展示源码 | 1           |


测试时通过看图发现了一个只靠 parse 校验发现不了的 bug：类图缺 `}` 时，右括号被补在文件末尾，导致 `Animal <|-- Dog` 被画成了类的成员。修复方法是按缩进推断块在哪里结束：

![类图修复前后](docs/images/C01.png)

## 局限

- **有时无法判断作者意图**：时序图缺 `end` 时只能补在最后，末尾的消息可能会被包进 `loop` 里。
- **节点 ID 带空格**（`用户 登录 --> 校验 密码`）无法修复，渲染封装会降级为展示源码。
- **饼图中没有数值的行会被删除**，属于有损修复。这会记录在 `fixes` 中，建议在界面上提示用户"部分数据未显示"。
- **依赖缩进的脑图只覆盖了常见情况**，严重错乱的脑图更适合交给 LLM 修复。
- **Mermaid 版本**：已在 Mermaid 11 上测试。因为校验始终使用你自己的 Mermaid 实例，即使某条规则不适合你的版本，也不会把正确的图改坏。

规则修不好的情况，建议再接一层 LLM 修复：把源码和报错信息交给一个便宜的模型，最多重试 2～3 次。

## 使用建议

- **图表配色**：Mermaid 默认主题下，`xychart` 的第一个系列颜色非常浅。`setupMermaid` 已经帮你配置了 `themeVariables.xyChart.plotColorPalette`；如果你自己初始化 Mermaid，也建议这样配置。
![色板](docs/images/palette.png)
- **Prompt**：要求模型所有标签都加引号（`A["..."]`）、不要用 `end` 当 ID、所有块都要闭合。模型出错越少，需要修复的就越少。
- **安全**：保持 `securityLevel: 'strict'`，不要用 `innerHTML` 把未修复的源码插入页面。



## 参与贡献

如果你发现 LLM 常犯、但本库还修不了的 Mermaid 错误，欢迎在 `test/cases.mjs` 中补充用例，写上错误的源码，最好也写上预期的元素数量：

```js
{
  id: 'F10', title: '简短描述', type: 'flowchart',
  problem: '错在哪里',
  src: 'flowchart TD\n...',
  expect: { nodes: 3, edges: 2 },
}
```

提交 PR 前，请运行 `npm test` 和浏览器测试，并看一遍截图。新增规则不能把正确的图改坏，也不能使用正则后行断言。

## 许可证

[MIT](./LICENSE)