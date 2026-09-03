# 工作概览

## 本轮完成
- 继续优化 `vertical_episode`、`series_drama`、`single_film` 三种内容形态的脚本与制作提示词。
- 审查并重构根目录通用脚本/生产技能，去掉跨形态的短剧默认值。
- 校正生产决策、监督、衍生资产、分镜面板和分镜图生成技能的形态隔离与真实工具契约。
- 保留上一轮 `explainer_video` 的认知骨架、证据边界和视觉功能改造。
- 完成全局一致性复核：确认根目录通用层不再承载短剧商业模板，并核对生成/写入工具名与当前代码。

## 主要结果
- `vertical_episode` 仍支持短剧的情绪、分集、卡点和投流，但全部改为项目配置/真实剧情驱动，不再无条件硬编码 55 秒、3-15-45、每集反转和固定打脸。
- `series_drama` 以人物选择、主线因果、支线交汇、阶段性兑现、自然集间承接和伏笔回收为核心。
- `single_film` 以选择、后果和单片闭环为核心，三幕/八节拍、固定人数和固定时长不再强制。
- 通用层现在只负责跨形态契约：内容忠实、因果连续、可拍表达、真实资产、Track ≤15 秒、台词/VO、音效和 XML；各形态差异由 `content_formats/<format>/` 负责。
- `production_agent_supervision.md` 已按四种形态建立质量门，避免把短剧标准套给长剧、单片和科普。

## 修改文件范围
- `data/skills/content_formats/vertical_episode/` 下 5 个正式技能文件
- `data/skills/content_formats/series_drama/` 下 5 个正式技能文件
- `data/skills/content_formats/single_film/` 下 5 个正式技能文件
- `data/skills/content_formats/explainer_video/` 下 5 个正式技能文件
- 根目录通用 `script_execution_*`、`production_execution_*`、Agent 决策/监督相关 Markdown

## 验证与注意事项
- `git diff --check` 通过。
- 本轮只修改 Markdown 技能文件，没有重建 `data/serve/app.js`。
- 已完成代码工具名对照：`get_flowData` 的数据键包含 `storyboard`，衍生资产生成工具为 `generate_deriveAsset`，分镜图生成工具为 `generate_storyboard`，分镜面板写入工具为 `add_flowData_storyboard`；提示词中的这些名称与当前代码一致。
- 工作区仍有多文件未提交改动；`data/skills/content_formats/vertical_episode/新建 文本文档.txt` 是未跟踪的重复文件，本轮未删除。
- 详尽的科普分析与验收标准见 `deliverables/explainer_video_提示词优化复核蓝图.md`。
- 本轮整体边界分析与通用层结论见 `deliverables/内容形态与通用Skill优化总览.md`。
