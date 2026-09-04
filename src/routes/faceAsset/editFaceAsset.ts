import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    id: z.number(),
    name: z.string().optional(),
    species: z.number().int().min(1).max(2).optional(), // 1: 人类, 2: 非人类
    gender: z.number().int().min(1).max(3).optional(), // 1: 男, 2: 女, 3: 中性/其他
    ethnicity: z.number().int().min(1).max(7).optional(), // 1: 东亚 ... 7: 混血/其他
    ageGroup: z.number().int().min(1).max(4).optional(), // 1: 少年 ... 4: 老年
    beautyScore: z.number().min(2).max(10).optional(), // 2.0 ~ 10.0 连续客观打分
    tags: z.array(z.string()).optional(),
    description: z.string().optional(),
  }),
  async (req, res) => {
    const { id, name, species, gender, ethnicity, ageGroup, beautyScore, tags, description } = req.body;

    try {
      const exist = await u.db("o_faceAsset").where("id", id).first();
      if (!exist) return res.status(404).send(error("人脸资产不存在"));

      const updateData: any = {};
      if (name !== undefined) updateData.name = name;
      if (species !== undefined) updateData.species = species;
      // gender/ethnicity/ageGroup 为 varchar 码值列，一律写字符串（'1'），避免 SQLite 数字绑定转成 '1.0'
      if (gender !== undefined) updateData.gender = String(gender);
      if (ethnicity !== undefined) updateData.ethnicity = String(ethnicity);
      if (ageGroup !== undefined) updateData.ageGroup = String(ageGroup);
      if (beautyScore !== undefined) updateData.beautyScore = Math.round(Math.max(2, Math.min(10, beautyScore)) * 10) / 10;
      if (tags !== undefined) updateData.tags = JSON.stringify(tags);
      if (description !== undefined) updateData.description = description;

      await u.db("o_faceAsset").where("id", id).update(updateData);

      res.status(200).send(success("更新成功"));
    } catch (e) {
      console.error("[editFaceAsset Error]:", e);
      res.status(500).send(error(u.error(e).message));
    }
  },
);
