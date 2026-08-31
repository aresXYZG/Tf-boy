import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    gender: z.string().optional(),
    ethnicity: z.string().optional(),
    ageGroup: z.string().optional(),
    page: z.number().optional(),
    pageSize: z.number().optional(),
  }),
  async (req, res) => {
    const { gender, ethnicity, ageGroup, page = 1, pageSize = 50 } = req.body;

    let query = u.db("o_faceAsset");

    if (gender) {
      query = query.where("gender", gender);
    }
    if (ethnicity) {
      query = query.where("ethnicity", ethnicity);
    }
    if (ageGroup) {
      query = query.where("ageGroup", ageGroup);
    }

    const list = await query
      .select("*")
      .orderBy("id", "desc")
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    const totalRes = await u.db("o_faceAsset").count("* as count").first();
    const total = Number(totalRes?.count || 0);

    const data = await Promise.all(
      list.map(async (item: any) => {
        const fileUrl = item.filePath ? await u.oss.getSmallImageUrl(item.filePath) : "";
        let tags: string[] = [];
        try {
          tags = item.tags ? JSON.parse(item.tags) : [];
        } catch {
          tags = [];
        }
        return {
          ...item,
          fileUrl,
          tags,
        };
      }),
    );

    res.status(200).send(success({ list: data, total }));
  },
);
