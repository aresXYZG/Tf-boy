import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

// 新增项目
export default router.post(
  "/",
  validateFields({
    projectType: z.string().optional().default("novel"),
    name: z.string().optional().default(""),
    intro: z.string().optional().default(""),
    type: z.string().optional().default("都市"),
    artStyle: z.string(),
    directorManual: z.string(),
    videoRatio: z.string().optional(),
    imageModel: z.string().optional(),
    videoModel: z.string().optional().nullable(),
    imageQuality: z.string().optional().default("2K"),
    mode: z.string().optional(),
    contentFormat: z.enum(["vertical_episode", "series_drama", "single_film", "explainer_video"]).optional().default("vertical_episode"),
    episodeDuration: z.number().optional(),
    totalEpisodes: z.number().optional(),
  }),
  async (req, res) => {
    const {
      projectType = "novel",
      name,
      intro = "",
      type = "都市",
      directorManual,
      artStyle,
      videoRatio,
      imageModel = "openlux:gpt-image-2",
      videoModel = null,
      imageQuality = "2K",
      mode = JSON.stringify(["singleImage"]),
      contentFormat = "vertical_episode",
      episodeDuration,
      totalEpisodes,
    } = req.body;

    // 自动推导画幅比例：竖屏短剧默认 9:16，其余默认 16:9
    const finalVideoRatio = videoRatio || (contentFormat === "vertical_episode" ? "9:16" : "16:9");
    // 单集时长与总集数：新建时不强制兜底硬编码数值，由后续剧本 Agent 根据体量推断
    const finalEpisodeDuration = episodeDuration ?? 0;
    const finalTotalEpisodes = totalEpisodes ?? 0;
    // 项目名称兜底
    const finalName = name && name.trim() ? name.trim() : `未命名项目_${new Date().toISOString().slice(0, 10)}`;

    await u.db("o_project").insert({
      id: Date.now(),
      projectType,
      name: finalName,
      intro,
      type,
      artStyle,
      videoRatio: finalVideoRatio,
      directorManual,
      userId: 1,
      imageModel: imageModel || "openlux:gpt-image-2",
      videoModel: videoModel || null,
      createTime: Date.now(),
      imageQuality: imageQuality || "2K",
      mode: mode || JSON.stringify(["singleImage"]),
      contentFormat,
      episodeDuration: finalEpisodeDuration,
      totalEpisodes: finalTotalEpisodes,
    });

    res.status(200).send(success({ message: "新增项目成功" }));
  },
);
