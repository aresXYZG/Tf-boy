import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

// 编辑项目
export default router.post(
  "/",
  validateFields({
    id: z.number(),
    name: z.string().optional(),
    intro: z.string().optional().default(""),
    type: z.string().optional().default("都市"),
    artStyle: z.string().optional(),
    directorManual: z.string().optional(),
    videoRatio: z.string().optional(),
    imageModel: z.string().optional(),
    videoModel: z.string().optional().nullable(),
    projectType: z.string().optional(),
    imageQuality: z.string().optional(),
    mode: z.string().optional(),
    contentFormat: z.enum(["vertical_episode", "series_drama", "single_film", "explainer_video"]).optional(),
    episodeDuration: z.number().optional(),
    totalEpisodes: z.number().optional(),
  }),
  async (req, res) => {
    const {
      id,
      name,
      intro,
      type,
      artStyle,
      videoRatio,
      directorManual,
      imageModel,
      videoModel,
      imageQuality,
      projectType,
      mode,
      contentFormat,
      episodeDuration,
      totalEpisodes,
    } = req.body;

    const updatePayload: any = {};
    if (name !== undefined) updatePayload.name = name;
    if (intro !== undefined) updatePayload.intro = intro;
    if (type !== undefined) updatePayload.type = type;
    if (artStyle !== undefined) updatePayload.artStyle = artStyle;
    if (videoRatio !== undefined) updatePayload.videoRatio = videoRatio;
    if (directorManual !== undefined) updatePayload.directorManual = directorManual;
    if (imageModel !== undefined) updatePayload.imageModel = imageModel;
    if (videoModel !== undefined) updatePayload.videoModel = videoModel;
    if (imageQuality !== undefined) updatePayload.imageQuality = imageQuality;
    if (projectType !== undefined) updatePayload.projectType = projectType;
    if (mode !== undefined) updatePayload.mode = mode;
    if (contentFormat !== undefined) updatePayload.contentFormat = contentFormat;
    if (episodeDuration !== undefined) updatePayload.episodeDuration = episodeDuration;
    if (totalEpisodes !== undefined) updatePayload.totalEpisodes = totalEpisodes;

    await u.db("o_project").where("id", id).update(updatePayload);

    res.status(200).send(success({ message: "编辑项目成功" }));
  },
);
