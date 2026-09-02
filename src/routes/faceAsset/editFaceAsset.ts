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
    gender: z.string().optional(),
    ageGroup: z.string().optional(),
    ethnicity: z.string().optional(),
    beautyLevel: z.string().optional(),
    tags: z.array(z.string()).optional(),
    description: z.string().optional(),
  }),
  async (req, res) => {
    const { id, name, gender, ageGroup, ethnicity, beautyLevel, tags, description } = req.body;

    const exist = await u.db("o_faceAsset").where("id", id).first();
    if (!exist) return res.status(404).send(error("人脸资产不存在"));

    const updateData: any = {};
    if (name !== undefined) updateData.name = name;
    if (gender !== undefined) updateData.gender = gender;
    if (ageGroup !== undefined) updateData.ageGroup = ageGroup;
    if (ethnicity !== undefined) updateData.ethnicity = ethnicity;
    if (beautyLevel !== undefined) updateData.beautyLevel = beautyLevel;
    if (tags !== undefined) updateData.tags = JSON.stringify(tags);
    if (description !== undefined) updateData.description = description;

    await u.db("o_faceAsset").where("id", id).update(updateData);

    res.status(200).send(success("更新成功"));
  },
);
