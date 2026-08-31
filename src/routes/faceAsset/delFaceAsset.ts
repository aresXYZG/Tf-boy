import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    id: z.number().optional(),
    ids: z.array(z.number()).optional(),
  }),
  async (req, res) => {
    const { id, ids } = req.body;
    const targetIds: number[] = ids && ids.length > 0 ? ids : id ? [id] : [];

    if (targetIds.length === 0) {
      return res.status(400).send(error("请提供要删除的人脸资产ID"));
    }

    const list = await u.db("o_faceAsset").whereIn("id", targetIds).select("filePath");
    for (const item of list) {
      if (item.filePath) {
        try {
          await u.oss.deleteFile(item.filePath);
        } catch (e) {
          console.warn("删除文件失败:", item.filePath, e);
        }
      }
    }

    await u.db("o_faceAsset").whereIn("id", targetIds).delete();

    res.status(200).send(success("删除成功"));
  },
);
