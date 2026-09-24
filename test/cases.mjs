// 每个用例：id、标题、要测的问题、错误的 mermaid 源码、期望（用于自动核对修复后的图是否"没少东西"）
// expect.nodes / expect.edges 用于 flowchart；expect.messages 用于 sequence
// expectFixable=false 表示这是规则修复的已知边界，预期修不好，用来验证降级逻辑
export const cases = [
  {
    id: 'F01', title: 'LLM 输出带说明文字和代码围栏', type: 'flowchart',
    problem: '图前后有自然语言说明、```mermaid 围栏；graph 缺方向；节点和边标签含括号',
    src: '好的，下面是登录流程图：\n```mermaid\ngraph\nA[开始] --> B[调用接口(v2)]\nB --> C{是否成功?}\nC -->|是| D[返回结果]\nC -->|否(重试)| B\n```\n以上就是完整流程。',
    expect: { nodes: 4, edges: 4 },
  },
  {
    id: 'F02', title: '全角符号', type: 'flowchart',
    problem: '全角【】（）当作节点形状，——> 与 → 当箭头，标签用中文弯引号',
    src: 'flowchart LR\nA【用户】——>B（登录服务）\nB → C[“token 校验”]\nC → D【完成】',
    expect: { nodes: 4, edges: 3 },
  },
  {
    id: 'F03', title: '节点 ID 使用保留字 end', type: 'flowchart',
    problem: 'end 是 subgraph 的结束关键字，不能做节点 ID',
    src: 'flowchart TD\nstart[开始] --> process[处理]\nprocess --> end[结束]',
    expect: { nodes: 3, edges: 2 },
  },
  {
    id: 'F04', title: '标签是 URL 路径', type: 'flowchart',
    problem: 'A[/api/users] 会被识别为梯形开头；标签含 { }',
    src: 'flowchart TD\nA[/api/users] --> B[GET /api/v1/{id}]\nB --> C[POST /api/v1/orders]',
    expect: { nodes: 3, edges: 2 },
  },
  {
    id: 'F05', title: '标签含冒号、分号、双引号', type: 'flowchart',
    problem: '未加引号的标签中出现 ; 与 " 等特殊字符',
    src: 'flowchart TD\nA[读取配置; 校验] --> B[设置 "debug" 为 true]\nB --> C[key:value 写入]',
    expect: { nodes: 3, edges: 2 },
  },
  {
    id: 'F06', title: '"-- 文本 -->" 边文本含 { } ( )（预判为错误）', type: 'flowchart',
    problem: '构造时预判会报错，实测 Mermaid 11 能正确解析 → 用于验证 safeRepairMermaid 不改动可解析的原文',
    src: 'flowchart TD\nA[客户端] -- 请求 {json} --> B[网关]\nB -- 转发(HTTP/2) --> C[服务]',
    expect: { nodes: 3, edges: 2 },
  },
  {
    id: 'F07', title: 'subgraph 标题含空格/括号且缺 end', type: 'flowchart',
    problem: 'subgraph 标题带空格和括号；嵌套 subgraph 少一个 end',
    src: 'flowchart TD\nsubgraph 用户 模块(前端)\nA[页面] --> B[状态管理]\nsubgraph inner\nC[组件] --> D[Hook]\nend\nB --> C',
    expect: { nodes: 4, edges: 3 },
  },
  {
    id: 'F08', title: '非法箭头写法', type: 'flowchart',
    problem: '单横线 ->、=>、以 o 开头的节点紧跟 ---',
    src: 'flowchart LR\nA[下单]->B[支付]\nB=>C[发货]\nC---ops[运维]',
    expect: { nodes: 4, edges: 3 },
  },
  {
    id: 'F09', title: '缺少图类型声明', type: 'flowchart',
    problem: '第一行直接是节点，没有 flowchart/graph',
    src: 'A[开始] --> B[处理中]\nB --> C[结束]',
    expect: { nodes: 3, edges: 2 },
  },
  {
    id: 'S01', title: '时序图综合错误', type: 'sequence',
    problem: '全角冒号、消息含分号、=> 箭头、消息缺冒号、loop 缺 end、无效的 - 去激活标记',
    src: 'sequenceDiagram\nparticipant U as 用户\nparticipant S as 服务\nparticipant DB as 数据库\nU->>S：请求数据; 带分页参数\nS=>DB: 查询\nDB-->>S 返回结果\nloop 重试三次\nS->>DB: 再次查询\nS-->>-U: 返回',
    expect: { messages: 5 },
  },
  {
    id: 'S02', title: '时序图多余 end 与孤立 deactivate', type: 'sequence',
    problem: '没有 activate 就 deactivate；多出一个 end',
    src: 'sequenceDiagram\nA->>B: 你好\ndeactivate B\nB-->>A: 收到\nend',
    expect: { messages: 2 },
  },
  {
    id: 'E01', title: 'ER 图标签与括号问题', type: 'er',
    problem: '关系标签含括号未加引号、有一条关系缺标签、实体块缺 }',
    src: 'erDiagram\nCUSTOMER ||--o{ ORDER : 下单(一对多)\nORDER ||--|{ LINE-ITEM\nCUSTOMER {\n  string name\n  string email',
    expect: { nodes: 3 },
  },
  {
    id: 'ST01', title: '状态图全角冒号与缺 }', type: 'state',
    problem: '转移标签用全角冒号；复合状态缺 }',
    src: 'stateDiagram-v2\n[*] --> Idle\nIdle --> Running：start\nstate Running {\n  Loading --> Ready\nRunning --> [*]',
  },
  {
    id: 'C01', title: '类图缺 }', type: 'class',
    problem: 'class 定义块没有闭合',
    src: 'classDiagram\nclass Animal {\n  +String name\n  +eat()\nAnimal <|-- Dog',
    expect: { nodes: 2 },
  },
  {
    id: 'P01', title: '饼图：常见格式错误', type: 'pie',
    problem: '类型写成 pie chart；title 后带冒号；标签没加引号 / 用单引号 / 用全角冒号；数值带 %',
    src: "pie chart\ntitle: 2026 Q3 渠道占比\n直营 : 45%\n\"电商\"：30%\n'代理' : 15%\n其他 : 10 %",
    expect: { slices: 4 },
  },
  {
    id: 'P02', title: '饼图：金额带单位、千分位与无效数据', type: 'pie',
    problem: 'LLM 输出带说明文字和代码围栏；数值写成 ¥1,200万、800 万元、约 300；有一行数值是“待定”',
    src: "好的，下面是部门预算饼图：\n```mermaid\npie showData\n    title 部门预算（万元）\n    \"研发\" : ¥1,200万\n    \"市场\" : 800 万元\n    \"行政\" : 约 300\n    \"其他\" : 待定\n```",
    expect: { slices: 3 },
  },
  {
    id: 'L01', title: '折线图：类型名与中文坐标轴', type: 'xychart',
    problem: '类型写成 lineChart；标题、坐标轴含中文未加引号；全角逗号；y 轴范围写成 0 ~ 120；line 后带冒号',
    src: "lineChart\ntitle 2026 年月活用户趋势\nx-axis [一月， 二月， 三月， 四月， 五月， 六月]\ny-axis 用户数(万) 0 ~ 120\nline: [52, 61, 70, 78, 95, 110]",
    expect: { lines: 1, bars: 0 },
  },
  {
    id: 'B01', title: '柱状图：全角括号与带单位数值', type: 'xychart',
    problem: 'title 后带冒号；x 轴标题未加引号且用全角方括号；y 轴范围写成 0 - 500；数值带“万”字',
    src: "xychart-beta\ntitle: 各区域销售额\nx-axis 区域 ［华东, 华南, 华北, 西部］\ny-axis \"销售额（万元）\" 0 - 500\nbar [320万, 280万, 210万, 95万]",
    expect: { bars: 4, lines: 0 },
  },
  {
    id: 'B02', title: '柱状图 + 折线组合', type: 'xychart',
    problem: '系列名是中文未加引号；折线数值带 %；y 轴标题未加引号',
    src: "xychart\ntitle 季度营收与增长率\nx-axis [Q1, Q2, Q3, Q4]\ny-axis 营收 0 --> 100\nbar 营收 [40, 55, 62, 80]\nline 增长率 [10%, 37.5%, 12.7%, 29%]",
    expect: { bars: 4, lines: 1 },
  },
  {
    id: 'M01', title: '脑图：Markdown 标题与列表写法', type: 'mindmap',
    problem: '用 # / ## 标题和 - 列表表达层级（Mermaid 会判为多个根节点）；节点文本含括号',
    src: "mindmap\n# 前端技术栈\n## 框架\n- React\n- Vue\n## 状态管理(全局)\n- Redux\n- Zustand\n## 构建工具\n- Vite\n- Webpack",
    expect: { nodes: 10 },
  },
  {
    id: 'M02', title: '脑图：多个根节点与特殊括号', type: 'mindmap',
    problem: '一级分支与根节点同级缩进（多个根）；节点文本含 [ ] { } ( )',
    src: "mindmap\n  root((项目计划))\n  需求分析\n    用户访谈\n    竞品调研[3家]\n  开发(两周)\n    前端\n    后端{API}\n  上线",
    expect: { nodes: 8 },
  },
  {
    id: 'M03', title: '脑图：语法合法但文字丢失', type: 'mindmap',
    problem: '“数学(微积分)”能通过解析，但会被当成 id + 圆角形状，只显示“微积分”；需要语义检查才能发现',
    src: "mindmap\n  root((学习计划))\n    数学(微积分)\n    英语(口语)\n    编程",
    expect: { nodes: 4 },
  },
  {
    id: 'X01', title: '【已知边界】节点 ID 含空格', type: 'flowchart',
    problem: '节点 ID 本身带空格，规则无法判断作者意图，预期修不好 → 验证降级展示源码',
    src: 'flowchart TD\n用户 登录 --> 校验 密码\n校验 密码 --> 登录 成功',
    expectFixable: false,
  },
  {
    id: 'V01', title: '【对照组】本来就正确的图', type: 'flowchart',
    problem: '原文合法，safeRepairMermaid 应原样返回，不做任何改动',
    src: 'flowchart TD\n  A[Start] --> B{Ok?}\n  B -->|Yes| C[Done]\n  B -->|No| A',
    expect: { nodes: 3, edges: 3 },
  },
];
