import express from "express";
import u from "@/utils";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";

const router = express.Router();

export default router.post(
  "/",
  validateFields({
    name: z.string().optional(),
    fileUrl: z.string(), // base64
    gender: z.string().optional(),
    ageGroup: z.string().optional(),
    ethnicity: z.string().optional(),
    tags: z.array(z.string()).optional(),
    description: z.string().optional(),
    model: z.string().optional(), // 允许用户自行指定用于智能打标的 Vision 模型，如 "openai:gpt-4o" 或 "universalAi"
  }),
  async (req, res) => {
    const { name, fileUrl, gender, ageGroup, ethnicity, tags, description, model = "universalAi" } = req.body;

    try {
      const imagePath = `/faceAssets/${uuidv4()}.jpg`;
      const matches = fileUrl.match(/^data:image/[a-zA-Z0-9+.-]+;base64,(.+)$/);
      const realBase64 = matches ? matches[1] : fileUrl;

      await u.oss.writeFile(imagePath, Buffer.from(realBase64, "base64"));

      let autoGender = gender;
      let autoAgeGroup = ageGroup;
      let autoEthnicity = ethnicity;
      let autoTags = tags || [];
      let autoDesc = description;

      // 如果未完全填写，调用 Vision 模型进行面容智能打标
      if (!autoGender || !autoAgeGroup || !autoEthnicity || autoTags.length === 0 || !autoDesc) {
        try {
          const aiRes = await u.Ai.Text(model as any).invoke({
            system: `你是一位专业的人像面部特征与骨相分析专家。请仔细分析上传的人脸照片，输出严格的 JSON 格式结果，不要包含任何 markdown 代码块标记以外的闲聊文字。
JSON 格式要求如下：
{
  "gender": "男" | "女",
  "ageGroup": "少年" | "青年" | "中年" | "老年",
  "ethnicity": "东亚" | "欧美" | "混血" | "非裔" | "其他",
  "tags": ["高鼻梁", "内双", "下颌线条清晰", "微单眼皮", "剑眉", "桃花眼", "故事感神态"... 3-6个特征词],
  "description": "50字以内概括其面部骨相立体度、五官神态、眼型特征与皮肤质感"
}`,
            messages: [
              {
                role: "user",
                content: [
                  {
                    type: "image" as const,
                    image: `data:image/jpeg;base64,${realBase64}`,
                  },
                  {
                    type: "text" as const,
                    text: "请分析此真人人脸的骨相特征、五官神韵、性别、年龄段与人种，并按规范输出 JSON。",
                  },
                ],
              },
            ],
          });

          const jsonMatch = aiRes.text.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            if (!autoGender && parsed.gender) autoGender = parsed.gender;
            if (!autoAgeGroup && parsed.ageGroup) autoAgeGroup = parsed.ageGroup;
            if (!autoEthnicity && parsed.ethnicity) autoEthnicity = parsed.ethnicity;
            if (autoTags.length === 0 && Array.isArray(parsed.tags)) autoTags = parsed.tags;
            if (!autoDesc && parsed.description) autoDesc = parsed.description;
          }
        } catch (visionErr) {
          console.warn("自动视觉打标未完成，将采用默认/基础参数:", visionErr);
        }
      }

      const [id] = await u.db("o_faceAsset").insert({
        name: name || `${autoEthnicity || "东亚"}${autoAgeGroup || "青年"}${autoGender || "角色"}_${Date.now().toString().slice(-4)}`,
        filePath: imagePath,
        gender: autoGender || "女",
        ageGroup: autoAgeGroup || "青年",
        ethnicity: autoEthnicity || "东亚",
        tags: JSON.stringify(autoTags),
        description: autoDesc || "",
        createTime: Date.now(),
      });

      const smallUrl = await u.oss.getSmallImageUrl(imagePath);

      res.status(200).send(
        success({
          id,
          name: name || `${autoEthnicity || "东亚"}${autoAgeGroup || "青年"}${autoGender || "角色"}`,
          fileUrl: smallUrl,
          gender: autoGender || "女",
          ageGroup: autoAgeGroup || "青年",
          ethnicity: autoEthnicity || "东亚",
          tags: autoTags,
          description: autoDesc || "",
        }),
      );
    } catch (e) {
      res.status(500).send(error(u.error(e).message));
    }
  },
);
