import { Socket } from "socket.io";
import { tool, jsonSchema } from "ai";
import { z } from "zod";
import u from "@/utils";
import Memory from "@/utils/agent/memory";
import useTools from "@/agents/scriptAgent/tools";
import ResTool from "@/socket/resTool";
import * as fs from "fs";
import path from "path";

export interface AgentContext {
  socket: Socket;
  isolationKey: string;
  text: string;
  userMessageTime?: number;
  abortSignal?: AbortSignal;
  resTool: ResTool;
  msg: ReturnType<ResTool["newMessage"]>;
  thinkConfig: {
    think: boolean;
    thinlLevel: 0 | 1 | 2 | 3;
  };
}

export type ContentFormat = "vertical_episode" | "series_drama" | "single_film" | "explainer_video";

/** 内容形态中文标签：注入项目档案时使用，避免模型无法理解英文枚举 */
const CONTENT_FORMAT_LABELS: Record<ContentFormat, string> = {
  vertical_episode: "竖屏短剧",
  series_drama: "中长连续剧",
  single_film: "单片微电影",
  explainer_video: "知识科普解说",
};

/** 子任务单次生成的兜底超时（毫秒）：供应商连接 stall 时流式调用不会自行失败，必须主动中断避免前端无限等待 */
const SUB_AGENT_TIMEOUT_MS = 10 * 60 * 1000;
/** 决策层整轮兜底超时（毫秒）：覆盖多工具循环与多次子任务调用的合法长耗时 */
const DECISION_TIMEOUT_MS = 45 * 60 * 1000;

/** 组合外部中止信号与兜底超时信号，并暴露超时判定 */
function withTimeoutSignal(parent: AbortSignal | undefined, ms: number) {
  const timeoutSignal = AbortSignal.timeout(ms);
  const signal = parent ? AbortSignal.any([parent, timeoutSignal]) : timeoutSignal;
  return {
    signal,
    isTimeout: () => timeoutSignal.aborted,
  };
}

/** 读取技能包 README 标题作为中文名称，失败时回退原始 ID */
async function getSkillDisplayName(kind: "art_skills" | "story_skills", id?: string | null): Promise<string> {
  if (!id) return "未配置";
  try {
    const readmePath = path.join(u.getPath("skills"), kind, id, "README.md");
    const first = (await fs.promises.readFile(readmePath, "utf-8"))
      .split(/\r?\n/)
      .find((line) => line.trim().startsWith("# "));
    if (!first) return id;
    const name = first
      .replace(/^#\s+/, "")
      .replace(/\s*·\s*.*$/, "")
      .replace(/风格说明$/, "")
      .trim();
    return name || id;
  } catch {
    return id;
  }
}

export interface SkillFileMap {
  skeleton: string;
  adaptation: string;
  script: string;
}

/**
 * 剧本阶段多形态技能映射管理表
 * 统一管理各形态在不同改编阶段所对应的专属技能文件路径
 */
export const SCRIPT_SKILLS_MAP: Record<ContentFormat, SkillFileMap> = {
  vertical_episode: {
    skeleton: "content_formats/vertical_episode/script_execution_skeleton.md",
    adaptation: "content_formats/vertical_episode/script_execution_adaptation.md",
    script: "content_formats/vertical_episode/script_execution_script.md",
  },
  single_film: {
    skeleton: "content_formats/single_film/script_execution_skeleton.md",
    adaptation: "content_formats/single_film/script_execution_adaptation.md",
    script: "content_formats/single_film/script_execution_script.md",
  },
  series_drama: {
    skeleton: "content_formats/series_drama/script_execution_skeleton.md",
    adaptation: "content_formats/series_drama/script_execution_adaptation.md",
    script: "content_formats/series_drama/script_execution_script.md",
  },
  explainer_video: {
    skeleton: "content_formats/explainer_video/script_execution_skeleton.md",
    adaptation: "content_formats/explainer_video/script_execution_adaptation.md",
    script: "content_formats/explainer_video/script_execution_script.md",
  },
};

/**
 * 根据项目 contentFormat 获取对应形态与阶段的技能内容
 * 专属技能只存放在各自 content_formats/<形态>/ 目录下，不再回退根目录
 */
export async function getScriptSkillContent(
  projectId: string | number | undefined,
  phase: keyof SkillFileMap,
): Promise<string> {
  const project = projectId ? await u.db("o_project").where("id", projectId).first() : null;
  const formatKey =
    project?.contentFormat && project.contentFormat in SCRIPT_SKILLS_MAP
      ? (project.contentFormat as ContentFormat)
      : "vertical_episode";

  const relativePath = SCRIPT_SKILLS_MAP[formatKey][phase];
  const targetPath = path.join(u.getPath("skills"), relativePath);

  if (!fs.existsSync(targetPath)) {
    throw new Error(`[scriptAgent] 形态专属技能文件不存在: format=${formatKey}, phase=${phase}, path=${targetPath}`);
  }

  console.log(`[scriptAgent] 加载形态技能: format=${formatKey}, phase=${phase}, path=${relativePath}`);
  return await fs.promises.readFile(targetPath, "utf-8");
}

/**
 * 根据项目 contentFormat 获取对应形态的监督层技能
 * 专属技能只存放在各自 content_formats/<形态>/ 目录下，不再回退根目录
 */
export async function getSupervisionSkillContent(projectId: string | number | undefined): Promise<string> {
  const project = projectId ? await u.db("o_project").where("id", projectId).first() : null;
  const formatKey =
    project?.contentFormat && project.contentFormat in SCRIPT_SKILLS_MAP
      ? (project.contentFormat as ContentFormat)
      : "vertical_episode";

  const relativePath = `content_formats/${formatKey}/script_agent_supervision.md`;
  const targetPath = path.join(u.getPath("skills"), relativePath);
  if (!fs.existsSync(targetPath)) {
    throw new Error(`[scriptAgent] 形态专属监督技能文件不存在: format=${formatKey}, path=${targetPath}`);
  }
  console.log(`[scriptAgent] 加载形态监督技能: format=${formatKey}, path=${relativePath}`);
  return await fs.promises.readFile(targetPath, "utf-8");
}

/**
 * 根据项目 contentFormat 获取对应形态的决策层技能
 * 决策层按形态独立，不再共用根目录通用提示词
 */
export async function getDecisionSkillContent(projectId: string | number | undefined): Promise<string> {
  const project = projectId ? await u.db("o_project").where("id", projectId).first() : null;
  const formatKey =
    project?.contentFormat && project.contentFormat in SCRIPT_SKILLS_MAP
      ? (project.contentFormat as ContentFormat)
      : "vertical_episode";

  const relativePath = `content_formats/${formatKey}/script_agent_decision.md`;
  const targetPath = path.join(u.getPath("skills"), relativePath);
  if (!fs.existsSync(targetPath)) {
    throw new Error(`[scriptAgent] 形态专属决策技能文件不存在: format=${formatKey}, path=${targetPath}`);
  }
  console.log(`[scriptAgent] 加载形态决策技能: format=${formatKey}, path=${relativePath}`);
  return await fs.promises.readFile(targetPath, "utf-8");
}

function buildMemPrompt(mem: Awaited<ReturnType<Memory["get"]>>): string {
  let memoryContext = "";
  if (mem.rag.length) {
    memoryContext += `[相关记忆]\n${mem.rag.map((r) => r.content).join("\n")}`;
  }
  if (mem.summaries.length) {
    if (memoryContext) memoryContext += "\n\n";
    memoryContext += `[历史摘要]\n${mem.summaries.map((s, i) => `${i + 1}. ${s.content}`).join("\n")}`;
  }
  if (mem.shortTerm.length) {
    if (memoryContext) memoryContext += "\n\n";
    memoryContext += `[近期对话]\n${mem.shortTerm.map((m) => `${m.role}: ${m.content}`).join("\n")}`;
  }
  return `## Memory\n以下是你对用户的记忆，可作为参考但不要主动提及：\n${memoryContext}`;
}

export async function runDecisionAI(ctx: AgentContext) {
  const { isolationKey, text, userMessageTime, abortSignal, resTool } = ctx;
  const memory = new Memory("scriptAgent", isolationKey);
  await memory.add("user", text, { createTime: userMessageTime });

  const prompt = await getDecisionSkillContent(resTool.data.projectId);

  const mem = buildMemPrompt(await memory.get(text));

  const projectData = await u.db("o_project").where("id", resTool.data.projectId).first();

  const novelData = await u.db("o_novel").where("projectId", resTool.data.projectId).select("chapterIndex");

  const formatKey: ContentFormat =
    projectData?.contentFormat && projectData.contentFormat in CONTENT_FORMAT_LABELS
      ? (projectData.contentFormat as ContentFormat)
      : "vertical_episode";
  const [artStyleName, directorManualName] = await Promise.all([
    getSkillDisplayName("art_skills", projectData?.artStyle),
    getSkillDisplayName("story_skills", projectData?.directorManual),
  ]);
  const videoRatio = projectData?.videoRatio ?? "16:9";
  const ratioLabel = videoRatio === "9:16" ? "竖屏" : videoRatio === "16:9" ? "横屏" : "";
  const decisionTimeout = withTimeoutSignal(abortSignal, DECISION_TIMEOUT_MS);

  const projectInfo = [
    "## 项目档案（既定设定）",
    "以下设定已由用户在项目设置中确认，属于既定事实：不得再次询问、不得建议更换、不得擅自更改。",
    `小说名称：${projectData?.name ?? "未知"}`,
    `小说类型：${projectData?.type ?? "未知"}`,
    `小说简介：${projectData?.intro ?? "无"}`,
    `内容形态：${CONTENT_FORMAT_LABELS[formatKey]}（${formatKey}）`,
    `画风手册：${artStyleName}（${projectData?.artStyle ?? "未配置"}）`,
    `导演手册：${directorManualName}（${projectData?.directorManual ?? "未配置"}）`,
    `影片画幅：${videoRatio}${ratioLabel ? `（${ratioLabel}）` : ""}`,
    `章节数量：${novelData.length}章`,
  ].join("\n");

  const { fullStream } = await u.Ai.Text("scriptAgent:decisionAgent", ctx.thinkConfig.think, ctx.thinkConfig.thinlLevel).stream({
    messages: [
      { role: "system", content: `${prompt}\n\n---\n\n${projectInfo}` },
      { role: "assistant", content: mem },
      { role: "user", content: text },
    ],
    abortSignal: decisionTimeout.signal,
    tools: {
      ...memory.getTools(),
      ...useTools({ resTool: ctx.resTool, msg: ctx.msg }),
      ...createSubAgent(ctx),
    },
    onFinish: async (completion) => {
      await memory.add("assistant:decision", removeAllXmlTags(completion.text));
    },
  });

  let currentMsg = ctx.msg;
  await consumeFullStream(fullStream, currentMsg, () => {
    if (ctx.msg === currentMsg) return currentMsg;
    currentMsg.complete();
    currentMsg = ctx.msg;
    return currentMsg;
  });
}

function createSubAgent(parentCtx: AgentContext) {
  const { resTool, abortSignal } = parentCtx;
  const memory = new Memory("scriptAgent", parentCtx.isolationKey);

  // 当前项目的内容形态（决定各阶段加载哪套形态专属技能）
  const projectId = resTool.data.projectId;

  async function runAgent({
    key,
    prompt,
    system,
    name,
    memoryKey,
    tools: extraTools,
    messages,
    persist,
  }: {
    key: `${string}:${string}`;
    prompt: string;
    system: string;
    name: string;
    memoryKey: string;
    tools?: Record<string, any>;
    messages?: { role: "user" | "assistant" | "system"; content: string }[];
    /** 从模型完整回复中解析并落库（替代模型调用 set_planData_* 工具） */
    persist?: (fullResponse: string) => Promise<void>;
  }) {
    parentCtx.msg.complete();
    const subMsg = resTool.newMessage("assistant", name);
    const subTimeout = withTimeoutSignal(abortSignal, SUB_AGENT_TIMEOUT_MS);

    let fullStream: any;
    try {
      const streamResult: any = await u.Ai.Text(key, parentCtx.thinkConfig.think, parentCtx.thinkConfig.thinlLevel).stream({
        system,
        messages: messages ?? [{ role: "user", content: prompt }],
        abortSignal: subTimeout.signal,
        // 执行层禁止调用写工具：正文统一走"XML 输出 → persist 自动落库"，避免模型双写/污染
        tools: {
          ...extraTools,
          ...Object.fromEntries(
            Object.entries(useTools({ resTool, msg: subMsg })).filter(
              ([n]) => !["set_planData", "set_planData_storySkeleton", "set_planData_adaptationStrategy"].includes(n),
            ),
          ),
        },
      });
      fullStream = streamResult.fullStream ?? streamResult;
    } catch (err: any) {
      // 子Agent 异常必须落日志：之前异常只作为 tool error 传给决策层，后端看不到真实原因
      console.error(`[scriptAgent] subAgent 异常 key=${key} name=${name}:`, u.error(err).message);
      const errMsg = subTimeout.isTimeout()
        ? `子任务超时中断（超过 ${Math.round(SUB_AGENT_TIMEOUT_MS / 60000)} 分钟无响应），请检查模型服务状态后重试`
        : `子任务执行异常：${u.error(err).message}`;
      subMsg.error(errMsg);
      throw err;
    }

    let fullResponse: string;
    try {
      fullResponse = await consumeFullStream(fullStream, subMsg);
    } catch (err: any) {
      if (subTimeout.isTimeout()) {
        const errMsg = `子任务超时中断（超过 ${Math.round(SUB_AGENT_TIMEOUT_MS / 60000)} 分钟无响应），请检查模型服务状态后重试`;
        console.error(`[scriptAgent] subAgent 超时 key=${key} name=${name}`);
        subMsg.error(errMsg);
        throw new Error(errMsg);
      }
      throw err;
    }

    if (persist) {
      try {
        await persist(fullResponse);
      } catch (err: any) {
        console.error(`[scriptAgent] persist 落库异常 key=${key}:`, u.error(err).message);
        subMsg.error(`写入工作区失败：${u.error(err).message}`);
        // 不再吞掉：必须让决策层感知写入失败并可重试，否则会出现"模型声称已完成但工作区为空"
        throw err;
      }
    }

    if (fullResponse.trim()) {
      try {
        await memory.add(memoryKey, removeAllXmlTags(fullResponse), {
          name,
          createTime: new Date(subMsg.datetime).getTime(),
        });
      } catch (memErr: any) {
        // 记忆失败不应导致"剧本已写入但整体报错"，降级记录日志即可
        console.error(`[scriptAgent] memory.add 失败(数据已写入，仅记忆缺失) key=${key}:`, u.error(memErr).message);
      }
    }

    parentCtx.msg = resTool.newMessage("assistant", "视频策划");
    return fullResponse;
  }

  const promptInput = z
    .object({
      prompt: z.string().describe("交给子Agent的任务简约描述，100字以内"),
    })
    .toJSONSchema();

  const run_sub_agent_storySkeleton = tool({
    description: "运行执行subAgent来完成故事骨架相关任务",
    inputSchema: jsonSchema<{ prompt: string }>(promptInput),
    execute: async ({ prompt }) => {
      const systemPrompt = await getScriptSkillContent(projectId, "skeleton");

      const formatPrompt =
        "\n你必须使用如下XML格式写入工作区：\n<storySkeleton>故事骨架内容</storySkeleton>\n注意：系统自动解析XML落库，禁止输出\"正在写入/已写入工作区\"等叙述，完整正文必须包含在标签内。";

      return runAgent({
        key: "scriptAgent:storySkeletonAgent",
        prompt,
        system: systemPrompt + formatPrompt,
        name: "编剧",
        memoryKey: "assistant:execution:storySkeleton",
        messages: [{ role: "user", content: prompt + formatPrompt }],
        persist: async (resp) => {
          const content = extractXmlContent(resp, "storySkeleton");
          if (!content) {
            throw new Error(
              `模型回复中未找到 <storySkeleton>...</storySkeleton> 输出（响应${resp.length}字，可能被截断或格式不符），骨架未写入工作区，请重新派发并要求按XML格式输出完整正文`,
            );
          }
          await persistPlanData(resTool.data.projectId, { storySkeleton: content });
        },
      });
    },
  });

  const run_sub_agent_adaptationStrategy = tool({
    description: "运行执行subAgent来完成改编策略相关任务",
    inputSchema: jsonSchema<{ prompt: string }>(promptInput),
    execute: async ({ prompt }) => {
      const systemPrompt = await getScriptSkillContent(projectId, "adaptation");

      const formatPrompt =
        "\n你必须使用如下XML格式写入工作区：\n<adaptationStrategy>改编策略内容</adaptationStrategy>\n注意：系统自动解析XML落库，禁止输出\"正在写入/已写入工作区\"等叙述，完整正文必须包含在标签内。";

      return runAgent({
        key: "scriptAgent:adaptationStrategyAgent",
        prompt,
        system: systemPrompt + formatPrompt,
        name: "编剧",
        memoryKey: "assistant:execution:adaptationStrategy",
        messages: [{ role: "user", content: prompt + formatPrompt }],
        persist: async (resp) => {
          const content = extractXmlContent(resp, "adaptationStrategy");
          if (!content) {
            throw new Error(
              `模型回复中未找到 <adaptationStrategy>...</adaptationStrategy> 输出（响应${resp.length}字，可能被截断或格式不符），改编策略未写入工作区，请重新派发并要求按XML格式输出完整正文`,
            );
          }
          await persistPlanData(resTool.data.projectId, { adaptationStrategy: content });
        },
      });
    },
  });

  const run_sub_agent_script = tool({
    description: "运行执行subAgent来完成剧本相关任务",
    inputSchema: jsonSchema<{ prompt: string }>(promptInput),
    execute: async ({ prompt }) => {
      const systemPrompt = await getScriptSkillContent(projectId, "script");

      const scriptList = await u.db("o_script").where("projectId", resTool.data.projectId).select("id", "name");
      const scriptPrompt = ["## 可用剧本(ID:名称)", scriptList.map((s: any) => `${s.id}:${(s.name || "").replace(/[,:]/g, "")}`).join(","), ""].join(
        "\n",
      );

      const novelData = await u.db("o_novel").where("projectId", resTool.data.projectId).select("chapterIndex");

      const formatPrompt = `\n你必须使用如下XML格式写入工作区：\nXML不得添加任何额外标签<scriptItem name="剧本名称">剧本内容</scriptItem><scriptItem name="剧本名称">剧本内容</scriptItem><scriptItem name="剧本名称">剧本内容</scriptItem>\n注意：系统自动解析XML落库，禁止输出"正在写入/已写入工作区"等叙述；每集剧本完整正文（含场景、对白、动作描述）必须完整包含在对应<scriptItem>标签内，不得省略或用概要代替。`;

      return runAgent({
        key: "scriptAgent:scriptAgent",
        prompt,
        system: systemPrompt + formatPrompt,
        messages: [
          { role: "assistant", content: scriptPrompt + `章节数量：${novelData.length}章` },
          { role: "user", content: prompt + formatPrompt },
        ],
        name: "编剧",
        memoryKey: "assistant:execution:script",
        persist: async (resp) => {
          const items = extractScriptItems(resp);
          console.log(`[scriptAgent] script persist: 响应${resp.length}字，提取到 ${items.length} 个 scriptItem`);
          if (items.length === 0) {
            throw new Error(
              `模型回复中未找到 <scriptItem name="...">剧本内容</scriptItem> 格式输出（响应${resp.length}字，可能被截断或格式不符），剧本未写入工作区，请重新派发并要求按XML格式输出完整正文`,
            );
          }
          for (const item of items) {
            const row = await u.db("o_script").where({ projectId: resTool.data.projectId, name: item.name }).first();
            if (row) {
              await u.db("o_script").where({ id: row.id }).update({ content: item.content });
            } else {
              await u.db("o_script").insert({ projectId: resTool.data.projectId, name: item.name, content: item.content, createTime: Date.now() });
            }
          }
        },
      });
    },
  });

  const run_supervision_agent = tool({
    description: "运行监督层subAgent执行独立任务，完成后返回结果",
    inputSchema: jsonSchema<{ prompt: string }>(promptInput),
    execute: async ({ prompt }) => {
      const systemPrompt = await getSupervisionSkillContent(projectId);

      return runAgent({
        key: "scriptAgent:supervisionAgent",
        prompt,
        system: systemPrompt,
        name: "编辑",
        memoryKey: "assistant:supervision",
      });
    },
  });

  return {
    run_sub_agent_storySkeleton,
    run_sub_agent_adaptationStrategy,
    run_sub_agent_script,
    run_supervision_agent,
  };
}

async function consumeFullStream(
  fullStream: AsyncIterable<any>,
  initialMsg: ReturnType<ResTool["newMessage"]>,
  syncMsg?: () => ReturnType<ResTool["newMessage"]>,
): Promise<string> {
  let msg = initialMsg;
  let text = msg.text();
  let thinking: ReturnType<typeof msg.thinking> | null = null;
  let thinkTime = 0;
  let fullResponse = "";

  try {
    for await (const chunk of fullStream) {
      if (syncMsg) {
        const newMsg = syncMsg();
        if (newMsg !== msg) {
          msg = newMsg;
          text = msg.text();
        }
      }
      if (chunk.type === "reasoning-start") {
        thinkTime = Date.now();
        thinking = msg.thinking("思考中...");
      } else if (chunk.type === "reasoning-delta") {
        thinking?.append(chunk.text);
      } else if (chunk.type === "reasoning-end") {
        thinkTime = Date.now() - thinkTime;
        thinking?.updateTitle(`思考完毕（${(thinkTime / 1000).toFixed(1)} 秒）`);
        thinking?.complete();
        thinking = null;
      } else if (chunk.type === "text-delta") {
        text.append(chunk.text);
        fullResponse += chunk.text;
      } else if (chunk.type === "error") {
        throw chunk.error;
      }
    }
    text.complete();
    msg.complete();
  } catch (err: any) {
    thinking?.complete();
    const errMsg = err?.message ?? String(err);
    text.append(errMsg);
    text.error();
    msg.error();
    throw err;
  }

  return fullResponse;
}

function removeAllXmlTags(text: string): string {
  text = text.replace(/<([a-zA-Z][\w-]*)(\s+[^>]*)?>([\s\S]*?)<\/\1>/g, "");
  text = text.replace(/<([a-zA-Z][\w-]*)(\s+[^>]*)?\/>/g, "");
  text = text.replace(/<\/?[a-zA-Z][\w-]*(\s+[^>]*)?>/g, "");
  return text.trim();
}

/** 从模型完整回复中提取指定标签内的正文：取最后一个开标签到闭标签之间的内容，与前端 useChat.parseXmlTag 逻辑一致 */
function extractXmlContent(text: string, tag: string): string | null {
  const openRe = new RegExp(`<${tag}(\\s[^>]*)?>`, "g");
  let last: RegExpExecArray | null = null;
  let m: RegExpExecArray | null;
  while ((m = openRe.exec(text)) !== null) last = m;
  if (!last) return null;
  const start = last.index + last[0].length;
  const closeIdx = text.indexOf(`</${tag}>`, start);
  if (closeIdx === -1) return text.slice(start).trim();
  return text.slice(start, closeIdx).trim();
}

/** 提取全部 <scriptItem name="...">...</scriptItem>，与前端逐集解析一致 */
function extractScriptItems(text: string): { name: string; content: string }[] {
  const items: { name: string; content: string }[] = [];
  const re = /<scriptItem\s+name="([^"]*)"[^>]*>([\s\S]*?)<\/scriptItem>/g;
  let m: RegExpExecArray | null;
  let lastClosedEnd = 0;
  while ((m = re.exec(text)) !== null) {
    const name = (m[1] || "").trim();
    const content = m[2].trim();
    if (name || content) items.push({ name, content });
    lastClosedEnd = m.index + m[0].length;
  }
  // 截断救援：流被中途掐断时最后的 scriptItem 没有闭合标签，按已有内容写入，
  // 避免整集剧本因缺一个 </scriptItem> 而完全丢失
  const tail = text.slice(lastClosedEnd);
  const unclosed = tail.match(/<scriptItem\s+name="([^"]*)"[^>]*>([\s\S]*)$/);
  if (unclosed) {
    const name = (unclosed[1] || "").trim();
    const content = unclosed[2].trim();
    if (name || content) {
      console.warn(`[scriptAgent] 检测到未闭合的 scriptItem（响应可能被截断），按已有内容写入: ${name || "(未命名)"}`);
      items.push({ name, content });
    }
  }
  return items;
}

/** 落库到 o_agentWorkData（与前端 /scriptAgent/setPlanData 一致：upsert 单行 JSON） */
async function persistPlanData(projectId: number, patch: { storySkeleton?: string; adaptationStrategy?: string }) {
  const existing = await u.db("o_agentWorkData").where({ projectId, key: "scriptAgent" }).first();
  let dataObj: Record<string, any> = {};
  if (existing?.data) {
    try { dataObj = JSON.parse(existing.data) ?? {}; } catch { dataObj = {}; }
  }
  if (patch.storySkeleton !== undefined) dataObj.storySkeleton = patch.storySkeleton;
  if (patch.adaptationStrategy !== undefined) dataObj.adaptationStrategy = patch.adaptationStrategy;
  const jsonStr = JSON.stringify(dataObj);
  if (existing) {
    await u.db("o_agentWorkData").where({ projectId, key: "scriptAgent" }).update({ data: jsonStr });
  } else {
    await u.db("o_agentWorkData").insert({ projectId, key: "scriptAgent", data: jsonStr, createTime: Date.now(), updateTime: Date.now() });
  }
}
