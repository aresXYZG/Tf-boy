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
declare const TextDecoder: any;
declare const TextEncoder: any;
declare const TransformStream: any;
declare const Response: any;
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

// ============================================================
// SSE 流清洗：部分中转模型（如 deepseek-v4-flash）在 tool_calls 分片里发送
// "type":""/"id":""/"name":""（标准应为 "type":"function" 或省略字段），
// AI SDK 严格校验会整块丢弃分片，导致工具调用参数丢失——表现为决策层
// 派发子任务后无响应。这里在流上原位修正为标准格式。
// ============================================================
const sanitizeSseLine = (line: string): string => {
  if (!line.includes('"tool_calls"')) return line;
  const prefixMatch = line.match(/^(\s*data:\s?)(.*)$/);
  if (!prefixMatch) return line;
  const dataRaw = prefixMatch[2];
  if (!dataRaw || dataRaw === "[DONE]") return line;
  try {
    const obj = JSON.parse(dataRaw);
    let changed = false;
    for (const choice of obj.choices ?? []) {
      const tcs = choice?.delta?.tool_calls;
      if (!Array.isArray(tcs)) continue;
      for (const tc of tcs) {
        if (!tc || typeof tc !== "object") continue;
        if (tc.type === "" || tc.type == null) {
          tc.type = "function";
          changed = true;
        }
        if (tc.id === "") {
          delete tc.id;
          changed = true;
        }
        if (tc.function && tc.function.name === "") {
          delete tc.function.name;
          changed = true;
        }
      }
    }
    if (!changed) return line;
    return `${prefixMatch[1]}${JSON.stringify(obj)}`;
  } catch {
    return line;
  }
};

const makeSanitizedFetch = () => async (url: any, init?: any) => {
  const res = await fetch(url, init);
  const contentType = String(res.headers?.get?.("content-type") ?? "");
  if (!res.ok || !res.body || !contentType.includes("text/event-stream")) return res;
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  const fixStream = new TransformStream({
    transform(chunk: any, controller: any) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) controller.enqueue(encoder.encode(`${sanitizeSseLine(line)}\n`));
    },
    flush(controller: any) {
      buffer += decoder.decode();
      if (buffer.trim()) controller.enqueue(encoder.encode(sanitizeSseLine(buffer)));
    },
  });
  return new Response(res.body.pipeThrough(fixStream), { status: res.status, statusText: res.statusText, headers: res.headers });
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
  return createOpenAI({ baseURL: vendor.inputValues.baseUrl, apiKey, fetch: makeSanitizedFetch() }).chat(model.modelName);
};

// ============================================================
// 分辨率档位 + 比例 → OpenAI Images 协议要求的 "宽x高" 像素尺寸
// 说明：OpenAI Images 协议对 gpt-image 系列只认 size="WxH"（宽高均能被16整除，
// 比例需在 1:3 ~ 3:1 之间）；aspect_ratio 是部分适配器的私有扩展字段，
// 上游透传时会被忽略（实测 gpt-image-2 不传 WxH 会输出正方形），因此必须换算像素尺寸。
// ============================================================
const PIXEL_SIZE_MAP: Record<string, Record<string, string>> = {
  "1K": { "16:9": "1280x720", "9:16": "720x1280", "1:1": "1024x1024", "4:3": "1152x864", "3:4": "864x1152" },
  "2K": { "16:9": "2048x1152", "9:16": "1152x2048", "1:1": "2048x2048", "4:3": "2048x1536", "3:4": "1536x2048" },
  "4K": { "16:9": "4096x2304", "9:16": "2304x4096", "1:1": "4096x4096", "4:3": "3840x2880", "3:4": "2880x3840" },
};
const toPixelSize = (tier: string, ratio: string): string => {
  const hit = PIXEL_SIZE_MAP[tier]?.[ratio];
  if (hit) return hit;
  // 未知比例兜底：长边按档位固定，短边按比例换算并取16的倍数（不小于256）
  const [w, h] = String(ratio || "16:9").split(":").map(Number);
  const long = tier === "4K" ? 4096 : tier === "2K" ? 2048 : 1280;
  if (!w || !h) return `${long}x${Math.round(((long * 9) / 16) / 16) * 16}`;
  const short = Math.max(256, Math.round(((long * Math.min(w, h)) / Math.max(w, h)) / 16) * 16);
  return w >= h ? `${long}x${short}` : `${short}x${long}`;
};

const imageRequest = async (config: ImageConfig, model: ImageModel): Promise<string> => {
  if (!vendor.inputValues.apiKey) throw new Error("缺少API Key");
  const baseUrl = vendor.inputValues.baseUrl.replace(/\/+$/, "");
  const apiKey = vendor.inputValues.apiKey.replace(/^Bearer\s+/i, "");

  const refs = config.referenceList || [];
  const pixelSize = toPixelSize(config.size || "1K", config.aspectRatio || "16:9");
  // 无参考图 → 文生图（JSON）
  if (refs.length === 0) {
    const requestBody: any = {
      model: model.modelName,
      prompt: config.prompt,
      size: pixelSize,
      aspect_ratio: config.aspectRatio || "16:9", // 保留给支持该扩展字段的模型（如 gemini 系）
    };
    logger(`API仓库 文生图，模型：${model.modelName}，比例：${config.aspectRatio || "16:9"}，像素：${pixelSize}`);
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
  fd.append("size", pixelSize);
  fd.append("aspect_ratio", config.aspectRatio || "16:9"); // 保留给支持该扩展字段的模型
  refs.forEach((img, i) => {
    const b64 = String(img.base64).replace(/^data:image\/\w+;base64,/, "");
    fd.append(`image`, Buffer.from(b64, "base64"), `ref_${i}.png`);
  });
  logger(`API仓库 图生图，模型：${model.modelName}，参考图 ${refs.length} 张，比例：${config.aspectRatio || "16:9"}，像素：${pixelSize}`);
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
