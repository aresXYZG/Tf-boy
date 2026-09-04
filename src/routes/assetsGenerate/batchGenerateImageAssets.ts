import express from "express";
import pLimit from "p-limit";
import u from "@/utils";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { error, success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { sampleAssetReferences, sampleDualFaceAssets, RoleMeta, GENDER_MAP, AGE_GROUP_MAP } from "@/utils/faceSampling";

const router = express.Router();

type AssetType = "role" | "scene" | "tool";

interface AssetTypeConfig {
  label: string;
  taskClass: string;
  dir: string;
  promptTitle: string;
  promptEnd: string;
}

const assetTypeConfig: Record<AssetType, AssetTypeConfig> = {
  role: {
    label: "角色",
    taskClass: "角色图生成",
    dir: "role",
    promptTitle: "角色标准四视图设定图",
    promptEnd: "人物/生物角色多视图设定图",
  },
  scene: {
    label: "场景",
    taskClass: "场景图生成",
    dir: "scene",
    promptTitle: "标准场景图",
    promptEnd: "标准场景图",
  },
  tool: {
    label: "道具",
    taskClass: "道具图生成",
    dir: "props",
    promptTitle: "标准道具图",
    promptEnd: "标准道具图",
  },
};

/** 动漫/卡通类画风检测：命中则切换为动画级约束块（写实摄影约束与赛璐璐画风冲突） */
function isAnimeStyle(artStyle: string): boolean {
  return /动漫|动画|卡通|二次元|赛璐璐|赛璐珞|国漫|漫画|anime|cartoon|cel|manga|ghibli/i.test(artStyle || "");
}

/** 人类角色四视图排版规范（写实/动画通用；细节质感由各画风的约束块负责） */
const FOUR_VIEW_LAYOUT = `【四视图标准布局规范】：
同一画面从左至右水平横排同一角色的四个视图：
- 左一：人像超大特写（正面平视，头顶至锁骨完整入画 head to collarbone complete，严禁裁切头顶，面部占比70%+，汇聚算力精细呈现五官细节、眼神神态与微表情）；
- 左二：正视图无头全身立像（正面0°，颈部以上完全截断留空 headless body，从颈部以下到脚底完整展示服装剪裁与体态）；
- 右二：侧视图无头全身立像（侧面90°，颈部以上完全截断留空 headless body，完整展示侧身轮廓、体态纵深与自然站姿受力分布）；
- 右一：后视图全身立像（后方180°，完整展现发型后脑层次、发尾与背后衣着版型，full body head to toe）；
自然站立，纯净白色背景（clean white background），四视图光影与比例严格一致。`;

function buildPrompt(
  cfg: AssetTypeConfig,
  artStyle: string,
  name: string,
  prompt: string,
  faceSummary: string = "",
  isNonHumanRole: boolean = false,
  roleMeta: RoleMeta | null = null,
): string {
  if (cfg.label === "角色") {
    if (isNonHumanRole) {
      return `
请根据以下设定生成【非人类/生物角色原生多视图设定图】：

**基础参数：**
- 画风风格: ${artStyle || "真实电影质感 / 概念设计"}

**角色设定：**
- 名称: ${name}
- 描述与特征: ${prompt}

**视觉总监与设计规范：**
- 完整生物设定：展示该生物/非人角色的完整生理结构、材质质感与体态特征，严禁无头截断。
- 物理接触与受力：姿态具有真实重量感、肌肉/机械受力与重心支撑，双脚/足部与地面形成自然接触阴影（contact shadows）。
- 原生多角度视图（自左至右横向排布）：
  1. 正面全貌立姿（展示正面结构与整体比例）
  2. 侧面全貌立姿（展示侧面体态厚度与轮廓）
  3. 背面全貌立姿（展示背部结构与细节）
  4. 头部/核心结构细节特写（展示面部表情或核心器官微观细节）

请严格按照系统规范生成生物角色多角度设定图。
      `.trim();
    }

    const roleLabel = `${roleMeta?.ageGroup ? AGE_GROUP_MAP[roleMeta.ageGroup] || "" : ""}${roleMeta?.gender ? GENDER_MAP[roleMeta.gender] || "" : ""}`;
    const faceSection = faceSummary ? `\n${faceSummary}\n` : `\n`;

    if (isAnimeStyle(artStyle)) {
      // 卡通/动漫画风：暂用原版提示词裸跑（不挂真人底图，真人参考会把画面往写实带）
      // 专用动画模板设计好后，可恢复下方注释中的动画级约束块
      /*
      return `
      ${name} · 全新原创${roleLabel}角色标准四视图设定图，${artStyle}，动画角色设定，character design sheet，character turnaround

      【动画级角色设计规范】：
      - 线条与结构：干净流畅的角色轮廓线，五官结构比例稳定统一，发型色块分组明确、走向清晰；
      - 上色质感：赛璐璐或薄涂上色，色块整洁，保持动画图形感，禁止真人毛孔级皮肤细节与照片噪点混入；
      - 身体力学：姿态重心自然、关节受力合理，服装褶皱简化但符合受力逻辑；
      - 光影统一：四视图受同一主光源影响，阴影色块简洁明确，配色严格一致。

      ${FOUR_VIEW_LAYOUT}

      【负面约束】：严禁照片写实皮肤纹理、3D塑料感、五官漂移、比例失衡、四视图人物不一致，全图无文字。
            `.trim();
      */
      return `
请根据以下设定生成【电影级角色标准四视图（真实摄影与光学物理约束规范）】：

**基础参数：**
- 画风风格: ${artStyle || "真实电影质感"}

**角色设定：**
- 名称: ${name}
- 提示词: ${prompt}
${faceSummary ? `- 人脸参考融合机制: ${faceSummary}` : ""}

**电影级真实人像摄影与光学约束：**
- 真实质感与去AI塑料感：遵循真实人体解剖学与真实摄影光学。人物保留轻微左右不对称、真实毛孔、细小绒毛、自然唇纹、眼下纹理、自然散落发丝与符合年龄的皮肤状态。严禁瓷娃娃磨皮、绝对对称五官、玻璃假眼、塑料感服装、假发贴图与过度锐化。
- 物理受力与重心：姿态具有真实重心支撑、关节受力与肌肉牵引，手指自然微弯，服装按照站姿产生真实下垂褶皱，双脚与地面形成自然接触阴影（contact shadows）。
- 统一环境光影：皮肤、头发与服装受到同一环境主光源与漫反射影响，克制的镜头自然噪点与景深。

**标准四视图排版布局（自左至右横向无缝排布在同一张画面中）：**
1. 左一：人像超大特写（正面平视，颈部以上完整展示，面部占比70%+，展现真实微表情与五官神韵）
2. 左二：正视全身素体（无头状态，headless body，标准A-pose，展示服装正面剪裁与体型比例）
3. 右二：侧视全身素体（无头状态，headless body，侧向站姿，展示侧面身型厚度与服装轮廓）
4. 右一：后视全身立像（背向站姿，展示背面发型、背部剪裁与完整服饰细节）

请严格按照系统规范生成人物角色四视图设定图。
      `.trim();
    }

    return `
${name} · 全新原创${roleLabel}角色标准四视图设定图，${artStyle || "真实电影质感"}，35mm镜头真实光影，character design sheet，character turnaround

【角色设定与服装造型】：
${prompt}
${faceSection}
【真实人体解剖学与质感约束】：
- 面部微细节：完整保留毛孔与肤色微微起伏，细小绒毛、自然唇纹、眼下纹理、零散碎发与符合年龄的真实皮肤质感；允许自然存在的轻微瑕疵：局部泛红、细小痘印、轻微雀斑（按年龄与角色设定克制呈现），杜绝瓷娃娃磨皮与绝对对称假脸；
- 眼部神态：虹膜呈现复杂放射状纤维结构，瞳孔边缘锐利清晰，角膜拥有真实湿润反射，高光符合物理光学规律，目光聚焦自然，睫毛粗细不一、排列自然，杜绝无神玻璃眼；
- 妆容：符合角色设定与画风，默认自然清透（男性清爽素颜感），严禁随机浓妆或与画风冲突的网红妆，保留真实皮肤质感；
- 身体力学：姿态具有真实重心、关节受力与肌肉牵引，手指自然弯曲；
- 物理光学：服装根据姿态产生真实重力褶皱，双脚与地面形成明确的接触阴影（contact shadows），皮肤、头发与服装受同一环境光统一影响；克制的镜头微噪点与自然景深。

${FOUR_VIEW_LAYOUT}

【负面约束】：严禁瓷娃娃皮肤、绝对对称五官、玻璃眼睛、塑料服装、假发贴图、漂浮身体、过度锐化、四视图人物不一致，全图无文字。
    `.trim();
  }

  return `
请根据以下参数生成${cfg.promptTitle}：

**基础参数：**
- 画风风格: ${artStyle || "未指定"}

**${cfg.label}设定：**
- 名称:${name},
- 提示词:${prompt},

请严格按照系统规范生成${cfg.promptEnd}。
  `.trim();
}

const requestSchema = {
  projectId: z.number(),
  model: z.string(),
  resolution: z.string(),
  concurrentCount: z.number().int().min(1).optional(),
  items: z.array(
    z.object({
      id: z.number(),
      type: z.enum(["role", "scene", "tool", "storyboard"]),
      name: z.string(),
      prompt: z.string(),
      base64: z.string().optional().nullable(),
    }),
  ),
};

export default router.post("/", validateFields(requestSchema), async (req, res) => {
  const { projectId, model, resolution, concurrentCount, items } = req.body;

  // 1. 查询项目
  const project = await u.db("o_project").where("id", projectId).select("artStyle", "type", "intro").first();
  if (!project) return res.status(500).send(error("项目为空"));

  // 2. 逐条插入 o_image 占位记录，收集 imageId 列表
  const totalNovelId: number[] = [];
  for (const item of items) {
    const [imageId] = await u.db("o_image").insert({
      type: item.type,
      state: "生成中",
      assetsId: item.id,
    });
    await u.db("o_assets").where("id", item.id).update({ imageId });
    totalNovelId.push(imageId);
  }

  // 3. 后台异步并发生成，不阻塞响应
  const limit = pLimit(concurrentCount ?? 1);

  const tasks = items.map((item: { id: number; type: string; name: string; prompt: string; base64: string | null | undefined }, index: number) =>
    limit(async () => {
      const imageId = totalNovelId[index];
      const data = await u.db("o_image").where("id", imageId).select("state").first();
      if (data?.state === "生成失败") {
        return;
      }
      const cfg = assetTypeConfig[item.type as AssetType];
      if (!cfg) return;

      await u.db("o_assets").where("id", item.id).update({ imageId });

      let referenceList: { type: "image"; base64: string }[] = [];
      let faceSummary = "";
      let isNonHumanRole = false;
      let roleMeta: RoleMeta | null = null;

      if (item.base64) {
        referenceList.push({ type: "image", base64: item.base64 });
      } else if (item.type === "role") {
        // 查询资产中持久化的 roleMeta
        const assetRecord = await u.db("o_assets").where("id", item.id).select("roleMeta").first();
        if (assetRecord?.roleMeta) {
          try {
            roleMeta = typeof assetRecord.roleMeta === "string" ? JSON.parse(assetRecord.roleMeta) : assetRecord.roleMeta;
          } catch (e) {
            console.warn("解析 roleMeta 失败:", e);
          }
        }

        if (roleMeta && roleMeta.species !== undefined && roleMeta.species !== 1) {
          isNonHumanRole = true;
        } else if (isAnimeStyle(project.artStyle ?? "")) {
          // 卡通/动漫画风：暂不挂真人底图（真人参考图会把画面往写实带），纯文生图裸跑
        } else {
          const faceSample = roleMeta ? await sampleAssetReferences(roleMeta, item.name) : await sampleDualFaceAssets(item.prompt, item.name);
          if (faceSample.referenceList.length > 0) {
            referenceList = faceSample.referenceList;
            faceSummary = faceSample.faceSummaryPrompt;
            await u.db("o_assets").where("id", item.id).update({
              faceAssetIds: JSON.stringify(faceSample.faceAssetIds),
            });
          }
        }
      }

      const imagePath = `/${projectId}/${cfg.dir}/${uuidv4()}.jpg`;
      const userPrompt = buildPrompt(cfg, project.artStyle ?? "", item.name, item.prompt, faceSummary, isNonHumanRole, roleMeta);
      const describe = `生成${cfg.label}图，名称：${item.name}，提示词：${item.prompt}`;
      const relatedObjects = { id: item.id, projectId, type: cfg.label };
      try {
        const aiImage = u.Ai.Image(model);
        await aiImage.run(
          {
            prompt: userPrompt,
            referenceList: referenceList,
            size: resolution,
            aspectRatio: "16:9",
          },
          {
            taskClass: cfg.taskClass,
            describe,
            projectId,
            relatedObjects: JSON.stringify(relatedObjects),
          },
        );
        aiImage.save(imagePath);

        const imageData = await u.db("o_image").where("id", imageId).select("*").first();
        if (!imageData) return res.status(500).send("资产已被删除");
        if (!imageData) return;
        if (imageData.state === "生成失败") return;
        await u
          .db("o_image")
          .where("id", imageId)
          .update({
            state: "已完成",
            filePath: imagePath,
            type: item.type,
            model: model.split(/:(.+)/)[1],
            resolution,
          });

        await u.db("o_assets").where("id", item.id).update({ imageId });
      } catch (e: any) {
        await u
          .db("o_image")
          .where("id", imageId)
          .update({ state: "生成失败", errorReason: u.error(e).message });
      }
    }),
  );

  // 后台执行，不等待结果
  Promise.all(tasks).catch(() => {});

  return res.status(200).send(success({ total: items.length }));
});
