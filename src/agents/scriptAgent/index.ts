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
 * 若子目录专属技能因意外缺失，具备自动回退根目录原始技能的容错机制
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

  if (fs.existsSync(targetPath)) {
    console.log(`[scriptAgent] 加载形态技能: format=${formatKey}, phase=${phase}, path=${relativePath}`);
    return await fs.promises.readFile(targetPath, "utf-8");
  }

  // 兜底回退：如果子目录文件不存在，则回退读取根目录下原始技能
  const fallbackPath = path.join(u.getPath("skills"), `script_execution_${phase}.md`);
  console.warn(`[scriptAgent] 形态技能缺失，使用通用规则: format=${formatKey}, phase=${phase}, path=${fallbackPath}`);
  return await fs.promises.readFile(fallbackPath, "utf-8");
}

/**
 * 根据项目 contentFormat 获取对应形态的监督层技能（分形态独立审核文件）
 * 若形态专属审核文件缺失，回退根目录 script_agent_supervision.md
 */
export async function getSupervisionSkillContent(projectId: string | number | undefined): Promise<string> {
  const project = projectId ? await u.db("o_project").where("id", projectId).first() : null;
  const formatKey =
    project?.contentFormat && project.contentFormat in SCRIPT_SKILLS_MAP
      ? (project.contentFormat as ContentFormat)
      : "vertical_episode";

  const relativePath = `content_formats/${formatKey}/script_agent_supervision.md`;
  const targetPath = path.join(u.getPath("skills"), relativePath);
  if (fs.existsSync(targetPath)) {
    console.log(`[scriptAgent] 加载形态监督技能: format=${formatKey}, path=${relativePath}`);
    return await fs.promises.readFile(targetPath, "utf-8");
  }
  const fallbackPath = path.join(u.getPath("skills"), "script_agent_supervision.md");
  console.warn(`[scriptAgent] 形态监督技能缺失，使用通用审核: format=${formatKey}, path=${fallbackPath}`);
  return await fs.promises.readFile(fallbackPath, "utf-8");
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

  const skill = path.join(u.getPath("skills"), "script_agent_decision.md");
  const prompt = await fs.promises.readFile(skill, "utf-8");

  const mem = buildMemPrompt(await memory.get(text));

  const projectData = await u.db("o_project").where("id", resTool.data.projectId).first();

  const novelData = await u.db("o_novel").where("projectId", resTool.data.projectId).select("chapterIndex");

  const projectInfo = [
    "## 项目信息",
    `小说名称：${projectData?.name ?? "未知"}`,
    `小说类型：${projectData?.type ?? "未知"}`,
    `小说简介：${projectData?.intro ?? "无"}`,
    `内容形态：${projectData?.contentFormat ?? "vertical_episode"}`,
    `目标改编影视视觉手册|画风：${projectData?.artStyle ?? "无"}`,
    `目标导演手册：${projectData?.directorManual ?? "无"}`,
    `目标改编视频画幅：${projectData?.videoRatio ?? "16:9"}`,
    `章节数量：${novelData.length}章`,
  ].join("\n");

  const { fullStream } = await u.Ai.Text("scriptAgent:decisionAgent", ctx.thinkConfig.think, ctx.thinkConfig.thinlLevel).stream({
    messages: [
      { role: "system", content: prompt },
      { role: "assistant", content: projectInfo + "\n" + mem },
      { role: "user", content: text },
    ],
    abortSignal,
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

    let fullStream: any;
    try {
      const streamResult: any = await u.Ai.Text(key, parentCtx.thinkConfig.think, parentCtx.thinkConfig.thinlLevel).stream({
        system,
        messages: messages ?? [{ role: "user", content: prompt }],
        abortSignal,
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
      subMsg.error(`子任务执行异常：${u.error(err).message}`);
      throw err;
    }

    const fullResponse = await consumeFullStream(fullStream, subMsg);

    if (persist) {
      try {
        await persist(fullResponse);
      } catch (err: any) {
        console.error(`[scriptAgent] persist 落库异常 key=${key}:`, u.error(err).message);
      }
    }

    if (fullResponse.trim()) {
      await memory.add(memoryKey, removeAllXmlTags(fullResponse), {
        name,
        createTime: new Date(subMsg.datetime).getTime(),
      });
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

      const formatPrompt = "\n你必须使用如下XML格式写入工作区：\n<storySkeleton>故事骨架内容</storySkeleton>";

      return runAgent({
        key: "scriptAgent:storySkeletonAgent",
        prompt,
        system: systemPrompt + formatPrompt,
        name: "编剧",
        memoryKey: "assistant:execution:storySkeleton",
        messages: [{ role: "user", content: prompt + formatPrompt }],
        persist: async (resp) => {
          const content = extractXmlContent(resp, "storySkeleton");
          if (content) await persistPlanData(resTool.data.projectId, { storySkeleton: content });
        },
      });
    },
  });

  const run_sub_agent_adaptationStrategy = tool({
    description: "运行执行subAgent来完成改编策略相关任务",
    inputSchema: jsonSchema<{ prompt: string }>(promptInput),
    execute: async ({ prompt }) => {
      const systemPrompt = await getScriptSkillContent(projectId, "adaptation");

      const formatPrompt = "\n你必须使用如下XML格式写入工作区：\n<adaptationStrategy>改编策略内容</adaptationStrategy>";

      return runAgent({
        key: "scriptAgent:adaptationStrategyAgent",
        prompt,
        system: systemPrompt + formatPrompt,
        name: "编剧",
        memoryKey: "assistant:execution:adaptationStrategy",
        messages: [{ role: "user", content: prompt + formatPrompt }],
        persist: async (resp) => {
          const content = extractXmlContent(resp, "adaptationStrategy");
          if (content) await persistPlanData(resTool.data.projectId, { adaptationStrategy: content });
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

      const formatPrompt = `\n你必须使用如下XML格式写入工作区：\nXML不得添加任何额外标签<scriptItem name="剧本名称">剧本内容</scriptItem><scriptItem name="剧本名称">剧本内容</scriptItem><scriptItem name="剧本名称">剧本内容</scriptItem>`;

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
  while ((m = re.exec(text)) !== null) {
    const name = (m[1] || "").trim();
    const content = m[2].trim();
    if (name || content) items.push({ name, content });
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
