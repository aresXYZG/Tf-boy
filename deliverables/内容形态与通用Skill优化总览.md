# Toonflow 内容形态与通用 Skill 优化总览

## 一、直接结论

这次不是简单给三个类型“补几条规则”，而是完成了一个必要的边界重构：

- `vertical_episode` 保留短剧能力，但短剧商业规则改为项目配置和真实剧情驱动；
- `series_drama` 围绕人物选择、长线因果和自然集间承接；
- `single_film` 围绕选择、后果、主题回收和单片闭环；
- `explainer_video` 围绕认知结构、证据边界和视觉功能；
- 根目录通用技能只保留跨形态的制作契约，不再默认把所有内容当短剧。

## 二、通用 Skill 是否仍与短剧创作有关

是的。原来的根目录通用技能明显带有短剧创作遗留，主要表现为：

- 通用剧本默认写“短剧改编项目”；
- 固定 55 秒、150 字/分钟、单句 20 字、3-15-45；
- 默认每集钩子、付费点、投流爆点、打脸/爽点；
- 默认主角/反派/大三角和连续集结构；
- 通用改编策略把短剧节奏、短剧平台和投放逻辑写成共同规则；
- 通用生产规则容易把剧情场次和科普/流程结构混在一起。

这些内容不应该放在通用层。通用层应该只负责：

1. 内容忠实和因果连续；
2. 可拍表达和声音边界；
3. 真实资产名称/ID；
4. Track `≤15秒` 的生成物理约束；
5. 台词/VO、分镜字段和 XML/工作区契约；
6. 各阶段的读取、写入和越权边界。

本轮已经重写根目录通用 `script_execution_*`、`production_execution_*`、决策层和监督层，使短剧商业规则回到 `vertical_episode` overlay。

## 三、三种剩余形态的优化方向

### 1. vertical_episode

保留短剧的优势，但从“模板必做”改成“真实剧情才做”：

- 每集必须有真实可视进展；
- 单集弧线采用“问题/异常 → 行动 → 阻碍/代价 → 可见变化 → 新问题”；
- 付费点仅在项目配置启用且剧情存在真实节点时使用；
- 投流点只从原剧情高光提取；
- 不再强制每集反转、固定打脸、固定前三秒危机；
- 台词、人物和世界规则必须保留动机与因果。

### 2. series_drama

从“多集内容堆叠”改为“长线因果管理”：

- 主线、支线和人物弧分别登记；
- 支线必须与主线或人物弧交汇；
- 每集完成一个局部目标或状态变化；
- 集末来自选择、后果、关系变化或信息缺口；
- 伏笔登记首次出现、重复/变形、揭晓和回看解释；
- 不混入付费点、投流、55 秒或每集反转。

### 3. single_film

从“固定三幕八节拍微电影模板”改为“选择—后果—主题闭环”：

- 三幕/八节拍只作为可选结构；
- 不强制四人上限、4~8 个场景或 3~20 分钟；
- 主题必须通过人物行为和后果呈现；
- 视觉母题、反转和开放结局都必须有材料依据；
- 留白和反应镜必须有功能，不为电影感拖时长。

## 四、本轮修改的技能文件范围

### 形态技能

- `data/skills/content_formats/vertical_episode/`：5 个正式文件；
- `data/skills/content_formats/series_drama/`：5 个正式文件；
- `data/skills/content_formats/single_film/`：5 个正式文件；
- `data/skills/content_formats/explainer_video/`：5 个正式文件。

### 通用与生产技能

- 根目录通用 `script_execution_skeleton.md`、`script_execution_adaptation.md`、`script_execution_script.md`；
- 根目录通用 `production_execution_director_plan.md`、`production_execution_storyboard_table.md`；
- `production_agent_decision.md`、`production_agent_supervision.md`；
- `script_agent_decision.md`、`script_agent_supervision.md`；
- `production_execution_derive_assets.md`、`production_execution_generate_assets.md`、`production_execution_storyboard_panel.md`、`production_execution_storyboard_gen.md`；
- `story_skills/Fun_science_director/` 下的科普风格说明和分镜技法。

## 五、真实代码链路核对结果

当前并不是“同名文件自动覆盖”。生产 Agent 明确按以下顺序拼接：

```text
通用 production skill
+ 当前 content_formats/<contentFormat>/ 同名文件
```

剧本 Agent 则按项目形态直接读取：

```text
content_formats/<contentFormat>/script_execution_<phase>.md
```

目前已核对的真实工具名：

- `get_flowData` 的工作区数据键包含 `script`、`assets`、`storyboardTable`、`storyboard`；
- `generate_deriveAsset`：生成衍生资产图片；
- `generate_storyboard`：生成分镜图片；
- `add_flowData_storyboard`：写入分镜面板；
- `set_planData_storySkeleton`：保存故事骨架；
- `set_planData_adaptationStrategy`：保存改编策略。

没有发现 `insert_script_to_sqlite` 工具，因此相关剧本技能已经改为只输出 `<scriptItem>`，由上层工作区流程解析保存。

## 六、还需要继续处理的事项

1. `data/skills/content_formats/vertical_episode/新建 文本文档.txt` 是未跟踪的重复拼接文件，当前没有被路由读取，尚未删除；
2. `Fun_science_director` 和各 `art_skills` 仍包含光影/色彩词汇，这是美术风格层内容，不能简单全局删除，但需要继续确认它们与制作层禁用规则的边界；
3. 视频提示词生成接口目前主要将 `videoDesc` 和资产名称交给模型，资产绑定不等于所有模式都自动传参考图；
4. 本轮只修改 Markdown，没有重建 `data/serve/app.js`；若后续修改源码才需要重新构建；
5. 当前大量文件仍是未提交改动，建议在确认回归样例通过后统一提交。

## 七、建议的回归样例

- `vertical_episode`：一集有冲突、有阶段性兑现、自然钩子，但没有无依据反转；
- `series_drama`：两条支线分别在中点和后期回到主线；
- `single_film`：一个人物选择在结尾产生明确代价和主题回响；
- `explainer_video`：天空为什么是蓝、秦始皇为什么修长城、房价与生育率、芯片如何制造、红眼睛居民谜题。

每个样例都检查：形态是否选对、是否混入其他形态规则、是否有真实因果、是否有无依据新增、是否能被后续生产阶段消费。
