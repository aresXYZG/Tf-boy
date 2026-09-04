import express from "express";
import { success } from "@/lib/responseFormat";
import u from "@/utils";
import { z } from "zod";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

// 重置对话到"原文已导入/解析完成、尚未开始生成"的初始状态：
// 清空 Agent 记忆 + 骨架/改编策略 + 已生成剧本及剧本-资产映射；
// 保留原文(o_novel)、事件解析与资产库(o_assets)，以便重新开始时直接复用。
export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
  }),
  async (req, res) => {
    const { projectId } = req.body;
    const isolationKey = `${projectId}:scriptAgent`;

    // 1. 清 Agent 对话记忆（message + summary）
    await u.db("memories").where({ isolationKey }).del();

    // 2. 重置骨架/策略：保留 o_agentWorkData 行，置空 storySkeleton/adaptationStrategy
    const row = await u.db("o_agentWorkData").where({ projectId, key: "scriptAgent" }).first();
    if (row) {
      let dataObj: Record<string, any> = {};
      try { dataObj = JSON.parse(row.data ?? "{}") ?? {}; } catch { dataObj = {}; }
      delete dataObj.storySkeleton;
      delete dataObj.adaptationStrategy;
      await u.db("o_agentWorkData").where({ projectId, key: "scriptAgent" }).update({ data: JSON.stringify(dataObj) });
    }

    // 3. 删除已生成的剧本及剧本-资产映射
    const scripts = await u.db("o_script").where({ projectId }).select("id");
    const scriptIds = scripts.map((s: any) => s.id);
    if (scriptIds && scriptIds.length > 0) {
      await u.db("o_scriptAssets").whereIn("scriptId", scriptIds).del();
    }
    await u.db("o_script").where({ projectId }).del();

    res.status(200).send(success({ ok: true }));
  },
);
