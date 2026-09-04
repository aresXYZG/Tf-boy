import express from "express";
import u from "@/utils";
import { z } from "zod";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { tool, jsonSchema } from "ai";
import { o_script } from "@/types/database";

const router = express.Router();

/** 角色结构化元数据 Schema (数字码值规范) */
export const RoleMetaSchema = z.object({
  species: z.number().describe("物种: 1(人类), 2(非人类/怪兽/动物/机甲/异形/其他)"),
  gender: z.number().optional().describe("性别: 1(男), 2(女), 3(中性/其他)"),
  ethnicity: z.number().optional().describe("族裔: 1(东亚), 2(欧美), 3(东南亚), 4(南亚), 5(拉丁), 6(非裔), 7(混血/其他)"),
  ageGroup: z.number().optional().describe("年龄段: 1(少年12-17), 2(青年18-35), 3(中年36-55), 4(老年56+)"),
  actualAge: z.number().optional().describe("剧本设定具体年龄数字(如25)"),
  beautyScore: z.number().min(2.0).max(10.0).optional().describe("人类真实颜值打分(2.0-10.0，主角不一定好看，依据角色真实设定打分)"),
  personality: z.string().optional().describe("性格与气质关键词(如'冷静干练、眼神锐利')"),
  appearance: z.string().optional().describe("五官发型特征(如'单眼皮、鼻梁挺直、黑茶色微卷锁骨发')"),
  clothing: z.string().optional().describe("基础常规着装(如'米白色极简亚麻衬衫搭配烟灰色休闲西裤')"),
  figure: z.string().optional().describe("身高体型描述(如'身高168cm，体态自然放松')"),
});

/** 新资产：AI 首次识别到的资产，需要完整信息 */
const NewAssetSchema = z.object({
  name: z.string().describe("资产名称,仅为名称不做其他任何表述"),
  desc: z.string().describe("资产描述"),
  type: z.enum(["role", "tool", "scene"]).describe("资产类型"),
  roleMeta: RoleMetaSchema.optional().describe("若 type 为 role，必须提供结构化角色元数据；场景与道具留空"),
  scriptIds: z.array(z.number()).describe("使用该资产的剧本id数组"),
});

/** 已有资产：数据库中已存在的资产，只需给出名称和关联的剧本 */
const ExistingAssetRefSchema = z.object({
  name: z.string().describe("已有资产的名称,必须与已有资产列表中的名称完全一致"),
  scriptIds: z.array(z.number()).describe("使用该资产的剧本id数组"),
});

export const AssetSchema = z.object({
  name: z.string().describe("资产名称,仅为名称不做其他任何表述"),
  desc: z.string().describe("资产描述"),
  type: z.enum(["role", "tool", "scene"]).describe("资产类型"),
  roleMeta: RoleMetaSchema.optional().describe("角色结构化元数据"),
});

type NewAsset = z.infer<typeof NewAssetSchema>;
type ExistingAssetRef = z.infer<typeof ExistingAssetRefSchema>;
type Asset = z.infer<typeof AssetSchema>;

/** 每批 AI 调用的结果 */
type GroupResult = {
  batchScriptIds: number[];
  newAssets: NewAsset[];
  existingRefs: ExistingAssetRef[];
} | null;

/** 将 scriptIds 数组按 groupSize 分组 */
function chunkArray(arr: number[], groupSize: number): number[][][] {
  const chunks: number[][] = [];
  for (let i = 0; i < arr.length; i += 5) {
    chunks.push(arr.slice(i, i + 5));
  }
  const groupChunks = [];
  for (let i = 0; i < chunks.length; i += groupSize) {
    groupChunks.push(chunks.slice(i, i + groupSize));
  }
  return groupChunks;
}

export default router.post(
  "/",
  validateFields({
    scriptIds: z.array(z.number()),
    projectId: z.number(),
    groupSize: z.number().min(1).optional(),
  }),
  async (req, res) => {
    const { scriptIds, projectId, groupSize = 5 } = req.body;

    if (!scriptIds.length) return res.status(400).send(error("请先选择剧本"));
    const scripts = await u.db("o_script").whereIn("id", scriptIds);

    // 构建 scriptId -> script 内容的映射
    const scriptMap = new Map(scripts.map((s: o_script) => [s.id, s]));

    await u.db("o_script").whereIn("id", scriptIds).update({
      extractState: 2,
    });

    const errors: { scriptId: number; error: string }[] = [];
    let successCount = 0;

    // 将 scriptIds 按 groupSize（默认5）分组，每组一起发给 AI
    const scriptGroups = chunkArray(scriptIds as number[], groupSize);

    /** 一组剧本提取完成后统一入库并建立关联 */
    async function persistGroupResult(result: GroupResult) {
      if (!result) return;
      const { batchScriptIds, newAssets, existingRefs } = result;
      if (!newAssets.length && !existingRefs.length) return;

      // 查询已有资产
      const existingAssets = await u.db("o_assets").where("projectId", projectId).select("id", "name");
      const existingMap = new Map(existingAssets.map((a) => [a.name!, a.id!]));

      // 插入新资产（不在已有列表中的）
      const toInsert = newAssets.filter((asset) => !existingMap.has(asset.name));
      if (toInsert.length) {
        await u.db("o_assets").insert(
          toInsert.map((asset) => ({
            name: asset.name,
            type: asset.type,
            describe: asset.desc,
            roleMeta: asset.roleMeta ? JSON.stringify(asset.roleMeta) : null,
            projectId: projectId,
            startTime: Date.now(),
          })),
        );
      }

      // 重新查询获取完整的 name -> id 映射
      const allAssets = await u.db("o_assets").where("projectId", projectId).select("id", "name");
      const nameToId = new Map(allAssets.map((a) => [a.name, a.id]));

      // 收集所有资产与剧本的关联关系
      const scriptAssetRows: { scriptId: number; assetId: number }[] = [];

      // 新资产的关联
      for (const asset of newAssets) {
        const assetId = nameToId.get(asset.name);
        if (assetId) {
          for (const sid of asset.scriptIds) {
            scriptAssetRows.push({ scriptId: sid, assetId });
          }
        }
      }

      // 已有资产的关联
      for (const ref of existingRefs) {
        const assetId = nameToId.get(ref.name);
        if (assetId) {
          for (const sid of ref.scriptIds) {
            scriptAssetRows.push({ scriptId: sid, assetId });
          }
        }
      }

      // 去重：相同 scriptId + assetId 只保留一条
      const uniqueRows = [...new Map(scriptAssetRows.map((r) => [`${r.scriptId}_${r.assetId}`, r])).values()];

      // 先删除本批 scriptId 的旧关联，再插入新的
      await u.db("o_scriptAssets").whereIn("scriptId", batchScriptIds).delete();
      if (uniqueRows.length) {
        await u.db("o_scriptAssets").insert(uniqueRows);
      }

      // 本批成功的剧本状态更新为 1（成功）
      await u.db("o_script").whereIn("id", batchScriptIds).where("projectId", projectId).update({
        extractState: 1,
        errorReason: null,
      });
    }
    res.send(success("开始提取资产"));

    function processGroup(group: number[][][]) {
      group.map(async (itemIds) => {
        const validScripts: { id: number; script: o_script }[] = [];
        for (const scriptIds of itemIds as number[][]) {
          for (const scriptId of scriptIds) {
            const script = scriptMap.get(scriptId);
            if (!script) {
              errors.push({ scriptId, error: "未找到对应剧本" });
              await u.db("o_script").where("id", scriptId).where("projectId", projectId).update({ extractState: -1, errorReason: "未找到对应剧本" });
            } else {
              // 查看状态是否为等待提取，仅对等待提取进行生成
              const item = await u.db("o_script").where("projectId", projectId).where("id", scriptId).select("extractState").first();
              if (item?.extractState == 2) {
                validScripts.push({ id: scriptId, script });
              }
            }
          }
        }
        if (!validScripts.length) return;
        const validScriptIds = validScripts.map((v) => v.id);
        // 修改状态为正在提取中
        await u.db("o_script").where("projectId", projectId).whereIn("id", validScriptIds).update({
          extractState: 0, // 正在提取
        });
        // 查询当前项目已有的资产列表，提供给 AI 参考
        const existingAssets = await u.db("o_assets").where("projectId", projectId).select("name", "type");
        const existingAssetsList = existingAssets.map((a) => `${a.name}(${a.type})`).join("、");

        // 拼接多集剧本内容，每集用分隔标记
        const scriptsContent = validScripts.map(({ id, script }) => `===== 【剧本ID: ${id}〛${script.name || ""} =====\n${script.content}`).join("\n\n");

        let collectedNew: NewAsset[] = [];
        let collectedExisting: ExistingAssetRef[] = [];
        try {
          const resultTool = tool({
            description: "返回结果时必须调用这个工具",
            inputSchema: jsonSchema<{ newAssets: NewAsset[]; existingAssetRefs: ExistingAssetRef[] }>(
              z
                .object({
                  newAssets: z
                    .array(NewAssetSchema)
                    .describe("新发现的资产列表（不在已有资产列表中的），必须包含完整的 name、desc、type、roleMeta(角色专属结构化画像) 和使用该资产的 scriptIds"),
                  existingAssetRefs: z
                    .array(ExistingAssetRefSchema)
                    .describe("已有资产的引用列表（在已有资产列表中已存在的），只需给出资产名称和使用该资产的 scriptIds"),
                })
                .toJSONSchema(),
            ),
            execute: async ({ newAssets, existingAssetRefs }) => {
              if (newAssets?.length) collectedNew = newAssets;
              if (existingAssetRefs?.length) collectedExisting = existingAssetRefs;
              return "无需回复用户任何内容";
            },
          });
          const promptData = await u.db("o_prompt").where("type", "scriptAssetExtraction").first();
          let scriptAssetExtraction = "" as string | undefined;
          if (promptData && promptData.useData) {
            scriptAssetExtraction = promptData.useData;
          } else {
            scriptAssetExtraction = promptData?.data ?? undefined;
          }
          const existingHint = existingAssetsList
            ? `

【已有资产列表】：${existingAssetsList}
对于已有资产，如果在剧本中出现，只需在 existingAssetRefs 中给出资产名称和对应的 scriptIds 数组即可，无需重复生成 desc/type。对于新发现的资产（不在已有列表中），请在 newAssets 中给出完整信息。`
            : "";

          const extractionGuide = `
【资产提取规范与角色数字画像指南】：
1. 资产类型分为：role (角色), scene (场景), tool (道具)。
2. 当类型为 role 时，必须在 roleMeta 中填入标准数字码值画像：
   - species (物种): 1=人类, 2=非人类/怪兽/动物/机甲/异形/其他。
   - gender (性别): 1=男, 2=女, 3=中性/其他。
   - ethnicity (族裔): 1=东亚, 2=欧美, 3=东南亚, 4=南亚, 5=拉丁, 6=非裔, 7=混血/其他。
   - ageGroup (年龄段): 1=少年(12-17), 2=青年(18-35), 3=中年(36-55), 4=老年(56+)。
   - beautyScore (颜值打分): 2.0-10.0 连续打分（注意：主角不一定好看，严格依据故事人物设定）：
     * 9.0-10.0: 顶级神颜、倾国倾城、校花校草顶流；
     * 7.5-8.9: 俊美出众、白领精英高颜值；
     * 5.5-7.4: 清秀耐看、普通生活剧/现实悬疑剧男女主、邻家大众；
     * 4.0-5.4: 平平无奇、底层小人物、大众脸路人；
     * 2.0-3.9: 饱经风霜、刀疤残破、特型反派/丑角。
   - personality, appearance, clothing, figure: 简明提炼对应结构化特征。
`;

          await u.Ai.Text("universalAi").invoke({
            messages: [
              {
                role: "system",
                content: `${scriptAssetExtraction || "提取剧本中涉及的资产（角色、场景、道具）。"}

${extractionGuide}

提取结果必须通过 resultTool 工具返回。

注意：本次会同时提供多集剧本，每集剧本以 ===== 【剧本ID: xxx】 ===== 分隔。你需要分析每集剧本使用了哪些资产，并在输出中用 scriptIds 数组标明每个资产在哪些剧本中出现。`,
              },
              {
                role: "user",
                content: `当前已有资产列表：${existingHint}

请根据以下${validScripts.length}集剧本提取对应的剧本资产（角色、场景、道具）:

${scriptsContent}`,
              },
            ],
            tools: { resultTool },
          });
          await persistGroupResult({
            batchScriptIds: validScriptIds,
            newAssets: collectedNew,
            existingRefs: collectedExisting,
          });
        } catch (e) {
          console.error(`[extractAssets] group=[${validScriptIds.join(",")}] 提取失败:`, e);
          for (const { id, script } of validScripts) {
            errors.push({ scriptId: id, error: (script.name || "") + ":" + u.error(e).message });
            await u
              .db("o_script")
              .where("id", id)
              .where("projectId", projectId)
              .update({ extractState: -1, errorReason: u.error(e).message });
          }
          return;
        }
        if (!collectedNew.length && !collectedExisting.length) {
          for (const { id } of validScripts) {
            errors.push({ scriptId: id, error: "AI 未返回任何资产" });
            await u.db("o_script").where("id", id).where("projectId", projectId).update({ extractState: -1, errorReason: "AI 未返回任何资产" });
          }
          return;
        }
      });
    }
    processGroup(scriptGroups);
  },
);
