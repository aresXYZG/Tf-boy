import express from "express";
import { success } from "@/lib/responseFormat";
import u from "@/utils";
import { z } from "zod";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    agentType: z.enum(["scriptAgent"]),
    data: z.object({
      storySkeleton: z.string(),
      adaptationStrategy: z.string(),
      // script 为可选：早期阶段（如仅存骨架/改编）可能尚未生成剧本，避免因缺字段被 zod 打回
      script: z
        .array(z.object({ id: z.number().optional(), name: z.string(), content: z.string() }))
        .optional()
        .default([] as { name: string; content: string }[]),
    }),
  }),
  async (req, res) => {
    const { projectId, agentType, data } = req.body;

    // upsert：o_agentWorkData 若尚无该行（首次保存骨架/剧本），update 会命中 0 行导致写入丢失，
    // 因此先查是否存在，不存在则插入，存在则更新。
    const existing = await u.db("o_agentWorkData").where({ projectId: projectId, key: agentType }).first();
    if (existing) {
      await u.db("o_agentWorkData").where({ projectId: projectId, key: agentType }).update({
        data: JSON.stringify(data),
      });
    } else {
      await u.db("o_agentWorkData").insert({
        projectId: projectId,
        key: agentType,
        data: JSON.stringify(data),
      });
    }

    const script = data.script ?? [];

    await Promise.all(
      script.map(async (s: any) => {
        const row = await u.db("o_script").where({ projectId, name: s.name }).first();
        if (row) {
          await u.db("o_script").where({ id: row.id }).update({ content: s.content });
        } else {
          await u.db("o_script").insert({ projectId, name: s.name, content: s.content });
        }
      }),
    );

    res.status(200).send(success());
  },
);
