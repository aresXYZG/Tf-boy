/**
 * Toonflow AI供应商模板 - API仓库(apicangku)
 * @version 1.0
 *
 * 说明：
 * 1) API仓库(apicangku.icu) 为 AI 模型聚合中转平台（New API 架构），OpenAI 兼容格式
 * 2) 文本接口：https://apicangku.icu/v1（OpenAI 兼容），支持 GPT/Claude/DeepSeek/Gemini 等模型
 * 3) 图片接口：
 *    - 文生图：POST /images/generations（JSON）
 *    - 图生图：POST /images/edits（multipart，参考图随 form-data 上传）
 *    支持 gpt-image-2、gemini-3.1-flash-image（Nano Banana 2）等
 * 4) TTS 接口：POST /v1/audio/speech（OpenAI 兼容）
 * 5) 模型列表可在 API仓库 控制台查看（Console → 模型）或 GET /v1/models
 */

// ============================================================
// 类型定义
// ============================================================
type VideoMode =
  | "singleImage"
  | "startEndRequired"
  | "endFrameOptional"
  | "startFrameOptional"
  | "text"
  | (`videoReference:${number}` | `imageReference:${number}` | `audioReference:${number}`)[];
interface TextModel {
  name: string;
  modelName: string;
  type: "text";
  think: boolean;
  apiKey?: string; // 可选：模型级独立 API Key（部分渠道每个模型一个 key）
}
interface ImageModel {
  name: string;
  modelName: string;
  type: "image";
  mode: ("text" | "singleImage" | "multiReference")[];
  associationSkills?: string;
}
interface VideoModel {
  name: string;
  modelName: string;
  type: "video";
  mode: VideoMode[];
  associationSkills?: string;
  audio: "optional" | false | true;
  durationResolutionMap: { duration: number[]; resolution: string[] }[];
}
interface TTSModel {
  name: string;
  modelName: string;
  type: "tts";
  voices: { title: string; voice: string }[];
}
interface VendorConfig {
  id: string;
  version: string;
  name: string;
  author: string;
  description?: string;
  icon?: string;
  inputs: { key: string; label: string; type: "text" | "password" | "url"; required: boolean; placeholder?: string }[];
  inputValues: Record<string, string>;
  models: (TextModel | ImageModel | VideoModel | TTSModel)[];
}
type ReferenceList =
  | { type: "image"; sourceType: "base64"; base64: string }
  | { type: "audio"; sourceType: "base64"; base64: string }
  | { type: "video"; sourceType: "base64"; base64: string };
interface ImageConfig {
  prompt: string;
  referenceList?: Extract<ReferenceList, { type: "image" }>[];
  size: "1K" | "2K" | "4K";
  aspectRatio: `${number}:${number}`;
}
interface VideoConfig {
  duration: number;
  resolution: string;
  aspectRatio: "16:9" | "9:16";
  prompt: string;
  referenceList?: ReferenceList[];
  audio?: boolean;
  mode: VideoMode[];
}
interface TTSConfig {
  text: string;
  voice: string;
  speechRate: number;
  pitchRate: number;
  volume: number;
}
interface PollResult {
  completed: boolean;
  data?: string;
  error?: string;
}
// ============================================================
// 全局声明
// ============================================================
declare const axios: any;
declare const logger: (msg: string) => void;
declare const jsonwebtoken: any;
declare const zipImage: (base64: string, size: number) => Promise<string>;
declare const zipImageResolution: (base64: string, w: number, h: number) => Promise<string>;
declare const mergeImages: (base64Arr: string[], maxSize?: string) => Promise<string>;
declare const urlToBase64: (url: string) => Promise<string>;
declare const pollTask: (fn: () => Promise<PollResult>, interval?: number, timeout?: number) => Promise<PollResult>;
declare const createOpenAI: any;
declare const createDeepSeek: any;
declare const createZhipu: any;
declare const createQwen: any;
declare const createAnthropic: any;
declare const createOpenAICompatible: any;
declare const createXai: any;
declare const createMinimax: any;
declare const createGoogleGenerativeAI: any;
declare const Buffer: any;
declare const FormData: any;
declare const exports: {
  vendor: VendorConfig;
  textRequest: (m: TextModel, t: boolean, tl: 0 | 1 | 2 | 3) => any;
  imageRequest: (c: ImageConfig, m: ImageModel) => Promise<string>;
  videoRequest: (c: VideoConfig, m: VideoModel) => Promise<string>;
  ttsRequest: (c: TTSConfig, m: TTSModel) => Promise<string>;
  checkForUpdates?: () => Promise<{ hasUpdate: boolean; latestVersion: string; notice: string }>;
  updateVendor?: () => Promise<string>;
};
// ============================================================
// 供应商配置
// ============================================================
const vendor: VendorConfig = {
  id: "apicangku",
  version: "1.0",
  author: "Toonflow",
  name: "API仓库",
  description:
    "API仓库(apicangku.icu) AI 聚合中转平台（OpenAI 兼容），支持 GPT / Claude / DeepSeek / Gemini 文本对话及图片生成/图生图。\n[官方文档](https://apicangku.icu) ｜ [价格页](https://apicangku.icu/pricing)\n\n可用模型请在 API仓库 控制台「模型」中查看，或填入密钥后访问 `GET /v1/models`；也可在下方手动添加/修改模型。",
  icon: "",
  inputs: [
    { key: "apiKey", label: "API密钥", type: "password", required: true, placeholder: "控制台创建，格式 sk-xxx" },
    { key: "baseUrl", label: "请求地址", type: "url", required: true, placeholder: "以v1结束，示例：https://apicangku.icu/v1" },
  ],
  inputValues: {
    apiKey: "",
    baseUrl: "https://apicangku.icu/v1",
  },
  models: [
    // ---- 文本对话（基础模型，仅保留两个）----
    { name: "DeepSeek V4 Flash Vision", modelName: "deepseek-v4-flash-vision-exp", type: "text", think: false },
    { name: "GPT-5.6 Sol", modelName: "gpt-5.6-sol", type: "text", think: false },
  ],
};
// ============================================================
// 辅助函数
// ============================================================
const getHeaders = () => {
  const apiKey = vendor.inputValues.apiKey.replace(/^Bearer\s+/i, "");
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
};
// 解析 OpenAI 兼容图片响应（url 或 b64_json）
const parseImageResponse = async (data: any): Promise<string> => {
  const result = data?.data?.[0];
  if (!result) throw new Error(`图片生成失败：未返回结果 ${JSON.stringify(data).slice(0, 200)}`);
  const image = result.b64_json || result.url;
  if (!image) throw new Error(`图片生成失败：无图片数据 ${JSON.stringify(data).slice(0, 200)}`);
  if (image.startsWith("data:") || image.length > 300) return image;
  return await urlToBase64(image);
};
// ============================================================
// 适配器函数
// ============================================================
const textRequest = (model: TextModel, think: boolean, thinkLevel: 0 | 1 | 2 | 3) => {
  // 优先使用模型级独立 API Key（每个模型可配不同 key），否则用供应商全局 key
  const apiKey = (model.apiKey || vendor.inputValues.apiKey || "").replace(/^Bearer\s+/i, "");
  if (!apiKey) throw new Error("缺少API Key（可在模型配置中单独填写该模型的 key）");
  return createOpenAI({ baseURL: vendor.inputValues.baseUrl, apiKey }).chat(model.modelName);
};
const imageRequest = async (config: ImageConfig, model: ImageModel): Promise<string> => {
  if (!vendor.inputValues.apiKey) throw new Error("缺少API Key");
  const baseUrl = vendor.inputValues.baseUrl.replace(/\/+$/, "");
  const apiKey = vendor.inputValues.apiKey.replace(/^Bearer\s+/i, "");

  const refs = config.referenceList || [];
  // 无参考图 → 文生图（JSON）
  if (refs.length === 0) {
    const requestBody: any = {
      model: model.modelName,
      prompt: config.prompt,
      size: config.size || "1K",
    };
    logger(`API仓库 文生图，模型：${model.modelName}`);
    const resp = await fetch(`${baseUrl}/images/generations`, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify(requestBody),
    });
    if (!resp.ok) throw new Error(`图片生成失败：${await resp.text()}`);
    return await parseImageResponse(await resp.json());
  }

  // 有参考图 → 图生图（multipart /images/edits）
  const fd = new FormData();
  fd.append("model", model.modelName);
  fd.append("prompt", config.prompt);
  fd.append("size", config.size || "1K");
  refs.forEach((img, i) => {
    const b64 = String(img.base64).replace(/^data:image\/\w+;base64,/, "");
    fd.append(`image_${i}`, Buffer.from(b64, "base64"), `ref_${i}.png`);
  });
  logger(`API仓库 图生图，模型：${model.modelName}，参考图 ${refs.length} 张`);
  const resp = await fetch(`${baseUrl}/images/edits`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, ...fd.getHeaders() },
    body: fd.getBuffer(),
  });
  if (!resp.ok) throw new Error(`图生图失败：${await resp.text()}`);
  return await parseImageResponse(await resp.json());
};
const videoRequest = async (config: VideoConfig, model: VideoModel): Promise<string> => {
  return "";
};
const ttsRequest = async (config: TTSConfig, model: TTSModel): Promise<string> => {
  if (!vendor.inputValues.apiKey) throw new Error("缺少API Key");
  const baseUrl = vendor.inputValues.baseUrl.replace(/\/+$/, "");
  const apiKey = vendor.inputValues.apiKey.replace(/^Bearer\s+/i, "");

  logger(`API仓库 TTS 合成，模型：${model.modelName}，音色：${config.voice}`);
  const resp = await fetch(`${baseUrl}/audio/speech`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({
      model: model.modelName,
      input: config.text,
      voice: config.voice || "alloy",
      response_format: "mp3",
      speed: config.speechRate || 1,
    }),
  });
  if (!resp.ok) throw new Error(`TTS 生成失败：${await resp.text()}`);
  const audioBuffer = await resp.arrayBuffer();
  return `data:audio/mp3;base64,${Buffer.from(audioBuffer).toString("base64")}`;
};
const checkForUpdates = async (): Promise<{ hasUpdate: boolean; latestVersion: string; notice: string }> => {
  return { hasUpdate: false, latestVersion: "1.0", notice: "" };
};
const updateVendor = async (): Promise<string> => {
  return "";
};
// ============================================================
// 导出
// ============================================================
exports.vendor = vendor;
exports.textRequest = textRequest;
exports.imageRequest = imageRequest;
exports.videoRequest = videoRequest;
exports.ttsRequest = ttsRequest;
exports.checkForUpdates = checkForUpdates;
exports.updateVendor = updateVendor;
export {};
