import express from "express";
import u from "@/utils";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";

const router = express.Router();

/**
 * 数字码值字典（与 faceSampling.ts / extractAssets.ts 全系统统一）
 * 存储规范：gender/ethnicity/ageGroup 为历史 varchar 列，码值一律以字符串（如 '1'）写入/查询。
 * 严禁直接绑数字——SQLite 会把 REAL 1.0 转成文本 '1.0'，与 '1' 互不匹配。
 */
const GENDER_LABEL: Record<number, string> = { 1: "男", 2: "女", 3: "中性" };
const ETHNICITY_LABEL: Record<number, string> = { 1: "东亚", 2: "欧美", 3: "东南亚", 4: "南亚", 5: "拉丁", 6: "非裔", 7: "混血" };
const AGE_GROUP_LABEL: Record<number, string> = { 1: "少年", 2: "青年", 3: "中年", 4: "老年" };

/** 将 Vision 返回值收敛为合法数字码值，非法值返回 undefined */
function toCode(raw: any, min: number, max: number): number | undefined {
  const n = typeof raw === "string" ? Number(raw) : raw;
  if (typeof n !== "number" || !Number.isFinite(n)) return undefined;
  const int = Math.round(n);
  return int >= min && int <= max ? int : undefined;
}

/** 颜值分收敛到 2.0~10.0 连续区间，保留 1 位小数 */
function toBeautyScore(raw: any): number | undefined {
  const n = typeof raw === "string" ? Number(raw) : raw;
  if (typeof n !== "number" || !Number.isFinite(n)) return undefined;
  return Math.round(Math.max(2, Math.min(10, n)) * 10) / 10;
}

export default router.post(
  "/",
  validateFields({
    name: z.string().optional(),
    fileUrl: z.string(), // base64（可带 data:image/xxx;base64, 前缀）
    species: z.number().int().min(1).max(2).optional(), // 1: 人类, 2: 非人类
    gender: z.number().int().min(1).max(3).optional(), // 1: 男, 2: 女, 3: 中性/其他
    ethnicity: z.number().int().min(1).max(7).optional(), // 1: 东亚 ... 7: 混血/其他
    ageGroup: z.number().int().min(1).max(4).optional(), // 1: 少年 ... 4: 老年
    beautyScore: z.number().min(2).max(10).optional(), // 2.0 ~ 10.0 连续客观打分
    model: z.string().optional(), // 允许用户自行指定用于智能打标的 Vision 模型，如 "openai:gpt-4o" 或 "universalAi"
  }),
  async (req, res) => {
    const { name, fileUrl, species, gender, ethnicity, ageGroup, beautyScore, model = "faceAssetVisionAgent" } = req.body;

    try {
      // 解析真实 MIME 类型与 base64，避免 PNG/WebP 被强制当作 JPEG 导致 Vision 解析失败
      const mimeMatch = fileUrl.match(/^data:image\/([a-zA-Z0-9+.-]+);base64,(.+)$/);
      const mimeType = mimeMatch ? mimeMatch[1].toLowerCase() : "jpeg";
      const realBase64 = mimeMatch ? mimeMatch[2] : fileUrl;
      const extMap: Record<string, string> = { jpeg: "jpg", jpg: "jpg", png: "png", webp: "webp" };
      const ext = extMap[mimeType] || "jpg";
      const imagePath = `/faceAssets/${uuidv4()}.${ext}`;

      await u.oss.writeFile(imagePath, Buffer.from(realBase64, "base64"));

      let autoSpecies = species;
      let autoGender = gender;
      let autoEthnicity = ethnicity;
      let autoAgeGroup = ageGroup;
      let autoBeautyScore = beautyScore;

      // Vision 智能打标：用户未传的字段交给模型识别，依次尝试 指定模型 → universalAi
      if (model !== "none" && (!autoSpecies || !autoGender || !autoEthnicity || !autoAgeGroup || autoBeautyScore === undefined)) {
        const modelCandidates = [...new Set([model || "faceAssetVisionAgent", "universalAi"])].filter(Boolean) as string[];

        for (const tryModel of modelCandidates) {
          try {
            const aiRes = await u.Ai.Text(tryModel as any).invoke({
              system: `你是一名资深电影选角导演与角色视觉总监，同时是人像骨相分析专家。请以苛刻、客观、冷静的工业级眼光分析上传的人脸照片，严格按【标准数字码值字典】输出结构化元数据。

【标准数字码值字典】
species（物种）：1=人类；2=非人类（动物/怪兽/机甲/异形/拟人生物等）
gender（性别）：1=男；2=女；3=中性/难以界定
ethnicity（族裔）：1=东亚；2=欧美（高加索）；3=东南亚；4=南亚；5=拉丁；6=非裔；7=混血/其他
ageGroup（年龄段）：1=少年(12-17)；2=青年(18-35)；3=中年(36-55)；4=老年(56+)
beautyScore（客观颜值连续打分 2.0~10.0）——严禁谄媚与分数通胀，必须以真实人类社会正态分布为基准：
- 9.0~10.0 顶级神颜：骨相皮相近乎完美、无死角黄金比例，稀世罕见（极少给出）
- 7.5~8.9 俊美出众：明星/模特/高颜值素人，五官立体或极具辨识度
- 5.5~7.4 清秀耐看/邻家生活感：正常五官，稍有个人特色，现实剧男女主常见档位
- 4.0~5.4 平平无奇/大众脸：五官无亮点，可能有轻微凸嘴、不对称、塌鼻梁等小瑕疵
- 2.0~3.9 沧桑特型/丑角：明显不对称、大疤痕、严重衰老或特定反向特征

只输出如下纯 JSON，禁止 markdown 代码块、注释或任何多余文字：
{"species":1,"gender":1,"ethnicity":1,"ageGroup":2,"beautyScore":6.8}`,
              messages: [
                {
                  role: "user",
                  content: [
                    // AI SDK v6 ImagePart 标准格式：image 传「纯 base64」（不能带 data: 前缀），mediaType 声明图片格式
                    { type: "image" as const, image: realBase64, mediaType: `image/${mimeType}` },
                    {
                      type: "text" as const,
                      text: "请以选角总监视角分析这张人像，按标准数字码值字典输出纯 JSON。特别注意：beautyScore 必须落在真实人群正态分布区间，普通人严禁超过 7.4。",
                    },
                  ],
                },
              ],
            });

            const jsonMatch = aiRes.text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              const parsed = JSON.parse(jsonMatch[0]);
              if (autoSpecies === undefined) autoSpecies = toCode(parsed.species, 1, 2);
              if (autoGender === undefined) autoGender = toCode(parsed.gender, 1, 3);
              if (autoEthnicity === undefined) autoEthnicity = toCode(parsed.ethnicity, 1, 7);
              if (autoAgeGroup === undefined) autoAgeGroup = toCode(parsed.ageGroup, 1, 4);
              if (autoBeautyScore === undefined) autoBeautyScore = toBeautyScore(parsed.beautyScore);
            }
            // 至少拿到一个有效结果就停止重试
            if (autoGender || autoEthnicity || autoAgeGroup || autoBeautyScore !== undefined) break;
          } catch (visionErr) {
            console.warn(`[addFaceAsset] Vision 模型 ${tryModel} 打标失败，尝试下一个:`, u.error(visionErr).message);
          }
        }
      }

      // 兜底：无法识别的字段不猜测（species 默认人类 1，人脸库本身就是人类底图库；其余留空待人工补录）
      autoSpecies = autoSpecies ?? 1;

      const fallbackName = `${ETHNICITY_LABEL[autoEthnicity ?? 7] || "未知"}${AGE_GROUP_LABEL[autoAgeGroup ?? 2] || ""}${
        GENDER_LABEL[autoGender ?? 3] || ""
      }_${Date.now().toString().slice(-4)}`;

      const insertData = {
        name: name || fallbackName,
        filePath: imagePath,
        species: autoSpecies,
        gender: autoGender != null ? String(autoGender) : null,
        ethnicity: autoEthnicity != null ? String(autoEthnicity) : null,
        ageGroup: autoAgeGroup != null ? String(autoAgeGroup) : null,
        beautyScore: autoBeautyScore ?? null,
      };
      const [id] = await u.db("o_faceAsset").insert(insertData);

      let smallUrl = "";
      try {
        smallUrl = await u.oss.getSmallImageUrl(imagePath);
      } catch (e) {
        smallUrl = await u.oss.getFileUrl(imagePath);
      }

      res.status(200).send(
        success({
          id,
          ...insertData,
          name: insertData.name,
          fileUrl: smallUrl,
        }),
      );
    } catch (e) {
      console.error("[addFaceAsset Error]:", e);
      res.status(500).send(error(u.error(e).message));
    }
  },
);
