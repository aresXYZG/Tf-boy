import { tool, jsonSchema, Tool } from "ai";
import u from "@/utils";
import { z } from "zod";
import _ from "lodash";
import ResTool from "@/socket/resTool";

export const ScriptSchema = z.object({
  name: z.string().describe("剧本名称"),
  content: z.string().describe("剧本内容"),
});
export const planData = z.object({
  storySkeleton: z.string().describe("故事骨架"),
  adaptationStrategy: z.string().describe("改编策略"),
  script: z.string().describe("剧本内容"),
});

export type planData = z.infer<typeof planData>;

const keySchema = z.enum(Object.keys(planData.shape) as [keyof planData, ...Array<keyof planData>]);
const planDataKeyLabels = Object.fromEntries(
  Object.entries(planData.shape).map(([key, schema]) => [key, (schema as z.ZodTypeAny).description ?? key]),
) as Record<keyof planData, string>;

interface ToolConfig {
  resTool: ResTool;
  toolsNames?: string[];
  msg: ReturnType<ResTool["newMessage"]>;
}

export default (toolCpnfig: ToolConfig) => {
  const { resTool, toolsNames, msg } = toolCpnfig;
  const { socket } = resTool;

  // 写入工作区（o_agentWorkData）的公共逻辑：upsert，仅覆盖传入字段，避免清空 script 等其它数据
  const writePlanData = async ({ storySkeleton, adaptationStrategy }: { storySkeleton?: string; adaptationStrategy?: string }) => {
    console.log("[tools] writePlanData", { hasSkeleton: !!storySkeleton, hasAdaptation: !!adaptationStrategy });
    const thinking = msg.thinking(`正在写入故事骨架/改编策略到工作区...`);
    const projectId = resTool.data.projectId;
    const existing = await u.db("o_agentWorkData").where({ projectId, key: "scriptAgent" }).first();
    let dataObj: Record<string, any> = {};
    if (existing?.data) {
      try { dataObj = JSON.parse(existing.data) ?? {}; } catch { dataObj = {}; }
    }
    if (storySkeleton !== undefined) dataObj.storySkeleton = storySkeleton;
    if (adaptationStrategy !== undefined) dataObj.adaptationStrategy = adaptationStrategy;
    const jsonStr = JSON.stringify(dataObj);
    if (existing) {
      await u.db("o_agentWorkData").where({ projectId, key: "scriptAgent" }).update({ data: jsonStr });
    } else {
      await u.db("o_agentWorkData").insert({ projectId, key: "scriptAgent", data: jsonStr, createTime: Date.now(), updateTime: Date.now() });
    }
    thinking.appendText("已写入故事骨架/改编策略到工作区，可进入审核。");
    thinking.updateTitle("保存工作区完成");
    thinking.complete();
    return "成功写入故事骨架/改编策略到工作区";
  };

  const tools: Record<string, Tool> = {
    get_novel_events: tool({
      description: "获取章节事件",
      inputSchema: jsonSchema<{ chapterIndexs: number[] }>(
        z
          .object({
            chapterIndexs: z.array(z.number()).describe("章节的编号"),
          })
          .toJSONSchema(),
      ),
      execute: async ({ chapterIndexs }) => {
        console.log("[tools] get_novel_events", chapterIndexs);
        const thinking = msg.thinking("正在查询章节事件...");
        const data = await u
          .db("o_novel")
          .where("projectId", resTool.data.projectId)
          .select("id", "chapterIndex as index", "reel", "chapter", "chapterData", "event", "eventState")
          .whereIn("chapterIndex", chapterIndexs);
        thinking.appendText("正在查询章节编号: " + chapterIndexs.join(","));
        const eventString = data.map((i: any) => [`第${i.index}章，标题:${i.chapter}，事件:${i.event}`].join("\n")).join("\n");
        thinking.appendText("查询结果:\n" + eventString);
        thinking.updateTitle("查询章节事件完成");
        thinking.complete();
        return eventString ?? "无数据";
      },
    }),
    get_planData: tool({
      description: "获取工作区数据",
      inputSchema: jsonSchema<{ key: keyof planData }>(
        z
          .object({
            key: keySchema.describe("数据key"),
          })
          .toJSONSchema(),
      ),
      execute: async ({ key }) => {
        console.log("[tools] get_planData", key);
        const thinking = msg.thinking(`正在获取${planDataKeyLabels[key]}工作区数据...`);
        // 与 writePlanData 同源直读数据库,按本会话握手绑定的 projectId 隔离,不经过前端内存
        const projectId = resTool.data.projectId;
        let value: any;
        if (key === "script") {
          // 剧本内容来自 o_script 表,与 HTTP 路由 /api/scriptAgent/getPlanData 保持一致
          value = await u.db("o_script").where({ projectId }).select("id", "name", "content");
        } else {
          const existing = await u.db("o_agentWorkData").where({ projectId, key: "scriptAgent" }).first();
          let dataObj: Record<string, any> = {};
          if (existing?.data) {
            try { dataObj = JSON.parse(existing.data) ?? {}; } catch { dataObj = {}; }
          }
          value = dataObj[key];
        }
        thinking.appendText(`获取到${planDataKeyLabels[key]}:\n` + (typeof value === "string" ? value : JSON.stringify(value ?? "无数据")));
        thinking.updateTitle(`获取${planDataKeyLabels[key]}完成`);
        thinking.complete();
        return value ?? "无数据";
      },
    }),
    set_planData: tool({
      description:
        "将故事骨架/改编策略完整正文写入工作区（覆盖 o_agentWorkData）。当完成 storySkeleton 或 adaptationStrategy 并需保存供审核时调用。必须传入完整正文（通常数千字）；严禁传入确认语、摘要或修订说明等占位文本——那会覆盖并摧毁已有正文。",
      inputSchema: jsonSchema<{ storySkeleton?: string; adaptationStrategy?: string }>(
        z
          .object({
            storySkeleton: z.string().optional().describe("完整故事骨架内容"),
            adaptationStrategy: z.string().optional().describe("完整改编策略内容"),
          })
          .toJSONSchema(),
      ),
      execute: async ({ storySkeleton, adaptationStrategy }) => {
        console.log("[tools] set_planData", { hasSkeleton: !!storySkeleton, hasAdaptation: !!adaptationStrategy });
        return await writePlanData({ storySkeleton, adaptationStrategy });
      },
    }),
    set_planData_storySkeleton: tool({
      description:
        "将故事骨架完整正文写入工作区（o_agentWorkData）并持久化，供审核/下一阶段使用。仅在已完成完整故事骨架且需保存时调用。必须传入骨架完整正文（通常数千字）；严禁传入确认语（如“已写入”“修订完成”）、摘要、修订说明等占位文本——那会覆盖并摧毁已有正文。修复场景同样必须重新传入修订后的完整正文。",
      inputSchema: jsonSchema<{ storySkeleton: string }>(
        z.object({ storySkeleton: z.string().describe("完整故事骨架内容") }).toJSONSchema(),
      ),
      execute: async ({ storySkeleton }) => {
        console.log("[tools] set_planData_storySkeleton");
        return await writePlanData({ storySkeleton });
      },
    }),
    set_planData_adaptationStrategy: tool({
      description:
        "将改编策略完整正文写入工作区（o_agentWorkData）并持久化，供审核/下一阶段使用。仅在已完成完整改编策略且需保存时调用。必须传入策略完整正文（通常数千字）；严禁传入确认语（如“已写入”“修订完成”）、摘要、修订说明等占位文本——那会覆盖并摧毁已有正文。修复场景同样必须重新传入修订后的完整正文。",
      inputSchema: jsonSchema<{ adaptationStrategy: string }>(
        z.object({ adaptationStrategy: z.string().describe("完整改编策略内容") }).toJSONSchema(),
      ),
      execute: async ({ adaptationStrategy }) => {
        console.log("[tools] set_planData_adaptationStrategy");
        return await writePlanData({ adaptationStrategy });
      },
    }),
    get_novel_text: tool({
      description: "获取小说章节原始文本内容",
      inputSchema: jsonSchema<{ chapterIndex: string }>(
        z
          .object({
            chapterIndex: z.string().describe("章节编号"),
          })
          .toJSONSchema(),
      ),
      execute: async ({ chapterIndex }) => {
        console.log("[tools] get_novel_text", "[tools] get_novel_text", chapterIndex);
        const thinking = msg.thinking(`正在获取小说章节原文...`);
        const data = await u.db("o_novel").where("projectId", resTool.data.projectId).where({ chapterIndex }).select("chapterData").first();
        const text = data && data?.chapterData ? data.chapterData : "";
        thinking.appendText(`获取到原文:\n` + text);
        thinking.updateTitle(`获取小说章节原文完成`);
        thinking.complete();
        return text ?? "无数据";
      },
    }),
    get_script_content: tool({
      description: "获取剧本本内容",
      inputSchema: jsonSchema<{ ids: string[] }>(
        z
          .object({
            ids: z.array(z.string()).describe("脚本id"),
          })
          .toJSONSchema(),
      ),
      execute: async ({ ids }) => {
        console.log("[tools] get_script_content", "[tools] get_script_content", ids);
        const thinking = msg.thinking(`正在获取脚本内容...`);
        const data = await u.db("o_script").whereIn("id", ids).select("content", "name");
        const text = data && data.length ? data.map((d) => `<scriptItem name="${d.name}">${d.content}</scriptItem>`).join("\n") : "";
        thinking.appendText(`获取到脚本内容:\n` + JSON.stringify(data, null, 2));
        thinking.updateTitle(`获取脚本内容完成`);
        thinking.complete();
        return text ?? "无数据";
      },
    }),
    update_project_metadata: tool({
      description: "在剧本分析/故事骨架推断后，将推断出的项目总集数、单集时长、故事简介等元数据反写更新到项目数据库",
      inputSchema: jsonSchema<{ totalEpisodes?: number; episodeDuration?: number; intro?: string }>(
        z
          .object({
            totalEpisodes: z.number().optional().describe("推断出的总集数"),
            episodeDuration: z.number().optional().describe("推断出的单集目标时长(秒)"),
            intro: z.string().optional().describe("推断或提炼的故事核心简介"),
          })
          .toJSONSchema(),
      ),
      execute: async ({ totalEpisodes, episodeDuration, intro }) => {
        console.log("[tools] update_project_metadata", { totalEpisodes, episodeDuration, intro });
        const thinking = msg.thinking(`正在同步更新项目配置...`);
        const updateData: Record<string, any> = {};
        if (totalEpisodes !== undefined) updateData.totalEpisodes = totalEpisodes;
        if (episodeDuration !== undefined) updateData.episodeDuration = episodeDuration;
        if (intro !== undefined) updateData.intro = intro;

        if (Object.keys(updateData).length > 0) {
          await u.db("o_project").where("id", resTool.data.projectId).update(updateData);
          thinking.appendText(`已成功将推断配置同步至项目数据库:
` + JSON.stringify(updateData, null, 2));
        }
        thinking.updateTitle(`项目配置同步完成`);
        thinking.complete();
        return "项目元数据更新成功";
      },
    }),
  };
  return toolsNames ? Object.fromEntries(Object.entries(tools).filter(([n]) => toolsNames.includes(n))) : tools;
};
