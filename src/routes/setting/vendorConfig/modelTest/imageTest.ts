import express from "express";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import u from "@/utils";
import { z } from "zod";
import { tool, jsonSchema } from "ai";
const router = express.Router();

// 检查语言模型
export default router.post(
  "/",
  validateFields({
    modelName: z.string(),
    id: z.string(),
    imageBase64: z.string().optional(),
    imagesBase64: z.array(z.string()).optional(),
    prompt: z.string(),
    size: z.enum(["1K", "2K", "4K"]).optional(),
    aspectRatio: z.string().optional(),
  }),
  async (req, res) => {
    const { modelName, imageBase64, imagesBase64, id, prompt, size, aspectRatio } = req.body;

    try {
      const vendorConfigData = await u.db("o_vendorConfig").where("id", id).first();

      if (!vendorConfigData) return res.status(500).send(error("未找到该供应商配置"));
      if (!vendorConfigData.models) return res.status(500).send(error("未找到模型列表"));

      let refList: { type: "image"; base64: string }[] = [];
      if (imagesBase64 && Array.isArray(imagesBase64) && imagesBase64.length > 0) {
        refList = imagesBase64.filter(Boolean).map((b64: string) => ({ type: "image", base64: b64 }));
      } else if (imageBase64) {
        refList = [{ type: "image", base64: imageBase64 }];
      }

      const reqFn = await u.Ai.Image(`${id}:${modelName}`).run({
        prompt: prompt,
        referenceList: refList, //输入的图片提示词
        size: (size as "1K" | "2K" | "4K") || "1K", // 图片尺寸
        aspectRatio: (aspectRatio as `${number}:${number}`) || "16:9",
      });
      await reqFn.save("testImage.jpg");
      const resultUrl = await u.oss.getFileUrl("testImage.jpg");
      res.status(200).send(success(resultUrl));
    } catch (err) {
      console.error(err);
      const msg = u.error(err).message;
      console.error(msg);
      res.status(500).send(error(msg));
    }
  },
);
