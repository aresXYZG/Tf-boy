import express from "express";
import u from "@/utils";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";

const router = express.Router();

/**
 * 将模型返回的性别字段归一化为标准值（男/女/未知）。
 * 不同视觉模型可能返回 男/女、男性/女性、male/female、man/woman、M/F 等格式，
 * 统一转换，避免因格式不匹配导致性别落成"未知"。
 */
function normalizeGender(raw: any): string | undefined {
  if (raw === null || raw === undefined) return undefined;
  const s = String(raw).trim().toLowerCase();
  if (!s) return undefined;
  if (/^男$|^男性$|^male$|^man$|^m$|^boy$|^先生$/.test(s)) return "男";
  if (/^女$|^女性$|^female$|^woman$|^w$|^f$|^girl$|^女士$/.test(s)) return "女";
  if (/未知|unknown|不确定|无法|无|n\/a|na$/.test(s)) return "未知";
  // 兜底：无法识别的文本保持"未知"（绝不猜测）
  return "未知";
}

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
    beautyLevel: z.string().optional(),
    model: z.string().optional(), // 允许用户自行指定用于智能打标的 Vision 模型，如 "openai:gpt-4o" 或 "universalAi"
  }),
  async (req, res) => {
    const { name, fileUrl, gender, ageGroup, ethnicity, tags, description, beautyLevel, model = "faceAssetVisionAgent" } = req.body;

    try {
      // 解析真实 MIME 类型与 base64，避免 PNG/WebP 被强制当作 JPEG 导致 Vision 解析失败
      const mimeMatch = fileUrl.match(/^data:image\/([a-zA-Z0-9+.-]+);base64,(.+)$/);
      const mimeType = mimeMatch ? mimeMatch[1].toLowerCase() : "jpeg";
      const realBase64 = mimeMatch ? mimeMatch[2] : fileUrl;
      const extMap: Record<string, string> = { jpeg: "jpg", jpg: "jpg", png: "png", webp: "webp" };
      const ext = extMap[mimeType] || "jpg";
      const imagePath = `/faceAssets/${uuidv4()}.${ext}`;

      await u.oss.writeFile(imagePath, Buffer.from(realBase64, "base64"));

      let autoGender = gender;
      let autoAgeGroup = ageGroup;
      let autoEthnicity = ethnicity;
      let autoBeauty = beautyLevel;
      let autoTags = tags || [];
      let autoDesc = description;

      // 尝试用 Vision 模型打标：依次尝试用户指定模型 → 通用AI（universalAi），全部失败则跳过打标
      if (model !== "none" && (!autoGender || !autoAgeGroup || !autoEthnicity || !autoBeauty || autoTags.length === 0 || !autoDesc)) {
        const modelCandidates = [...new Set([model || "faceAssetVisionAgent", "universalAi"])].filter(Boolean) as string[];

        for (const tryModel of modelCandidates) {
          try {
            const aiRes = await u.Ai.Text(tryModel as any).invoke({
              system: `你是一位专业的人像面部特征与骨相分析专家。请仔细分析上传的人脸照片，输出严格的 JSON 格式结果，不要包含任何 markdown 代码块标记以外的闲聊文字。
JSON 格式要求如下：
{
  "gender": "男" | "女" | "未知",
  "ageGroup": "少年" | "青年" | "中年" | "老年",
  "ethnicity": "东亚" | "东南亚" | "南亚" | "欧美" | "拉丁" | "非裔" | "其他",
  "beautyLevel": "高" | "中",
  "tags": ["高鼻梁", "内双", "下颌线条清晰", "微单眼皮", "剑眉", "桃花眼", "故事感神态"... 3-6个特征词],
  "description": "50字以内概括其面部骨相立体度、五官神态、眼型特征与皮肤质感"
}
注意：
1. 必须严格依据照片中人物的真实生理特征判断性别；如果照片模糊、遮挡或无法明确判断性别，一律返回 "未知"，严禁猜测或默认。
2. beautyLevel 表示颜值等级：五官比例协调、骨相立体、无明显瑕疵为 "高"；五官端正、略有瑕疵为 "中"。基于客观面部特征评估，不要刻意讨好。`,
              messages: [
                {
                  role: "user",
                  content: [
                    // AI SDK v6 ImagePart 标准格式：image 传「纯 base64」（不能带 data: 前缀，否则被当 URL fetch），mediaType 声明图片格式
                    {
                      type: "image" as const,
                      image: realBase64,
                      mediaType: `image/${mimeType}`,
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
              if (!autoGender && parsed.gender) autoGender = normalizeGender(parsed.gender);
              if (!autoAgeGroup && parsed.ageGroup) autoAgeGroup = parsed.ageGroup;
              if (!autoEthnicity && parsed.ethnicity) autoEthnicity = parsed.ethnicity;
              if (!autoBeauty && parsed.beautyLevel && ["高", "中"].includes(parsed.beautyLevel)) autoBeauty = parsed.beautyLevel;
              if (autoTags.length === 0 && Array.isArray(parsed.tags)) autoTags = parsed.tags;
              if (!autoDesc && parsed.description) autoDesc = parsed.description;
            }
            // 至少拿到一个有效结果就停止重试
            if (autoGender || autoAgeGroup || autoEthnicity || autoBeauty || autoTags.length || autoDesc) break;
          } catch (visionErr) {
            console.warn(`[addFaceAsset] Vision 模型 ${tryModel} 打标失败，尝试下一个:`, u.error(visionErr).message);
          }
        }
      }

      // 兜底：无法确定的字段一律标注「未知/未标注」，绝不伪造虚假内容
      autoGender = autoGender || "未知";
      autoAgeGroup = autoAgeGroup || "";
      autoEthnicity = autoEthnicity || "";
      autoBeauty = autoBeauty || "";
      autoTags = autoTags && autoTags.length ? autoTags : [];
      autoDesc = autoDesc || "";

      const [id] = await u.db("o_faceAsset").insert({
        name: name || `${autoEthnicity || "未知"}${autoAgeGroup || ""}${autoGender}_${Date.now().toString().slice(-4)}`,
        filePath: imagePath,
        gender: autoGender,
        ageGroup: autoAgeGroup,
        ethnicity: autoEthnicity,
        beautyLevel: autoBeauty,
        tags: JSON.stringify(autoTags),
        description: autoDesc,
        createTime: Date.now(),
      });

      let smallUrl = "";
      try {
        smallUrl = await u.oss.getSmallImageUrl(imagePath);
      } catch (e) {
        smallUrl = await u.oss.getFileUrl(imagePath);
      }

      res.status(200).send(
        success({
          id,
          name: name || `${autoEthnicity || "未知"}${autoAgeGroup || ""}${autoGender}`,
          fileUrl: smallUrl,
          gender: autoGender,
          ageGroup: autoAgeGroup,
          ethnicity: autoEthnicity,
          beautyLevel: autoBeauty,
          tags: autoTags,
          description: autoDesc,
        }),
      );
    } catch (e) {
      console.error("[addFaceAsset Error]:", e);
      res.status(500).send(error(u.error(e).message));
    }
  },
);
