import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    species: z.number().int().min(1).max(2).optional(), // 1: 人类, 2: 非人类
    gender: z.number().int().min(1).max(3).optional(), // 1: 男, 2: 女, 3: 中性/其他
    ethnicity: z.number().int().min(1).max(7).optional(), // 1: 东亚 ... 7: 混血/其他
    ageGroup: z.number().int().min(1).max(4).optional(), // 1: 少年 ... 4: 老年
    beautyMin: z.number().min(2).max(10).optional(), // 颜值分区间下限
    beautyMax: z.number().min(2).max(10).optional(), // 颜值分区间上限
    page: z.number().optional(),
    pageSize: z.number().optional(),
  }),
  async (req, res) => {
    const { species, gender, ethnicity, ageGroup, beautyMin, beautyMax, page = 1, pageSize = 50 } = req.body;

    try {
      let query = u.db("o_faceAsset");

      // species 为 integer 列按数字查；gender/ethnicity/ageGroup 为 varchar 码值列按字符串查（'1'）
      if (species !== undefined) query = query.where("species", species);
      if (gender !== undefined) query = query.where("gender", String(gender));
      if (ethnicity !== undefined) query = query.where("ethnicity", String(ethnicity));
      if (ageGroup !== undefined) query = query.where("ageGroup", String(ageGroup));
      if (beautyMin !== undefined || beautyMax !== undefined) {
        query = query.whereBetween("beautyScore", [beautyMin ?? 2, beautyMax ?? 10]);
      }

      // 总数统计须遵循同一筛选条件
      const totalRes = (await query.clone().count("* as count").first()) as { count?: number | string } | undefined;
      const total = Number(totalRes?.count || 0);

      const list = await query
        .select("*")
        .orderBy("id", "desc")
        .limit(pageSize)
        .offset((page - 1) * pageSize);

      const data = await Promise.all(
        list.map(async (item: any) => {
          const fileUrl = item.filePath ? await u.oss.getSmallImageUrl(item.filePath) : "";
          const fileUrlRaw = item.filePath ? await u.oss.getFileUrl(item.filePath) : "";
          let tags: string[] = [];
          try {
            tags = item.tags ? JSON.parse(item.tags) : [];
          } catch {
            tags = [];
          }
          return {
            ...item,
            fileUrl,
            fileUrlRaw,
            tags,
          };
        }),
      );

      res.status(200).send(success({ list: data, total }));
    } catch (e) {
      console.error("[getFaceAssets Error]:", e);
      res.status(500).send(error(u.error(e).message));
    }
  },
);
