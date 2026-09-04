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
    messages: z.array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.union([z.string(), z.array(z.any())]).optional(),
        images: z.array(z.string()).optional(),
        image: z.string().optional(),
      }),
    ),
  }),
  async (req, res) => {
    const { modelName, messages, id } = req.body;

    try {
      const vendorConfigData = await u.db("o_vendorConfig").where("id", id).first();

      if (!vendorConfigData) return res.status(500).send(error("未找到该供应商配置"));
      if (!vendorConfigData.models) return res.status(500).send(error("未找到模型列表"));

      const modelList = await u.vendor.getModelList(vendorConfigData.id!);

      const getWeatherTool = tool({
        description: "Get the weather in a location",
        inputSchema: jsonSchema<{ location: string }>(
          z
            .object({
              location: z.string().describe("The location to get the weather for"),
            })
            .toJSONSchema(),
        ),
        execute: async ({ location }) => {
          return {
            location,
            temperature: 72 + Math.floor(Math.random() * 21) - 10,
          };
        },
      });

      // 处理消息格式：如果包含图片，则构造成 AI SDK 支持的 CoreUserMessage (ImagePart + TextPart)
      const formattedMessages = messages.map((msg: any) => {
        if (msg.role === "assistant") {
          return {
            role: "assistant" as const,
            content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content ?? ""),
          };
        }

        const imgs: string[] = [];
        if (Array.isArray(msg.images)) {
          imgs.push(...msg.images.filter(Boolean));
        }
        if (msg.image && typeof msg.image === "string") {
          imgs.push(msg.image);
        }

        // 如果用户消息已有复杂 content 结构且无外置 images，直接保留
        if (Array.isArray(msg.content)) {
          return {
            role: "user" as const,
            content: msg.content,
          };
        }

        const textContent = typeof msg.content === "string" ? msg.content : "";

        if (imgs.length > 0) {
          const contentParts: any[] = [];
          for (const img of imgs) {
            const mimeMatch = img.match(/^data:image\/([a-zA-Z0-9+.-]+);base64,(.+)$/);
            const mimeType = mimeMatch ? mimeMatch[1].toLowerCase() : "jpeg";
            const realBase64 = mimeMatch ? mimeMatch[2] : img;
            contentParts.push({
              type: "image" as const,
              image: realBase64,
              mediaType: `image/${mimeType}`,
            });
          }
          if (textContent) {
            contentParts.push({
              type: "text" as const,
              text: textContent,
            });
          }
          return {
            role: "user" as const,
            content: contentParts,
          };
        }

        return {
          role: "user" as const,
          content: textContent,
        };
      });

      const data = await u.Ai.Text(`${id}:${modelName}`).invoke({
        messages: formattedMessages,
        tools: { getWeatherTool },
      });
      console.log("%c Line:46 🍐 data", "background:#6ec1c2", data);
      if (!data) return res.status(500).send(error("模型未返回结果"));
      res.status(200).send(success({ thinking: data.reasoningText, content: data.text }));
    } catch (err) {
      console.error(err);
      const msg = u.error(err).message;
      console.error(msg);
      res.status(500).send(error(msg));
    }
  },
);
