/**
 * Toonflow AI供应商模板 - OpenLux
 * @version 2.4
 *
 * 说明：
 * 1) OpenLux 为 AI 模型聚合中转平台，OpenAI 兼容格式
 * 2) 文本接口：https://api.openlux.ai/v1（OpenAI 兼容），支持 GPT/Claude/DeepSeek/Gemini 等模型
 * 3) 图片接口：
 *    - 文生图：POST /images/generations（JSON）
 *    - 图生图：POST /images/edits（multipart，参考图随 form-data 上传）
 *    支持 gpt-image-2、gemini-3.1-flash-image（Nano Banana 2）等
 * 4) TTS 接口：
 *    - OpenAI 兼容：POST /v1/audio/speech（tts-1、gpt-4o-mini-tts 等）
 *    - MiniMax 异步：POST /minimax/v1/t2a_async_v2（MiniMax-Voice-Design 海螺音色设计）
 *    支持 tts-1、tts-1-hd、gpt-4o-mini-tts、MiniMax-Voice-Design 等
 * 5) 模型列表可在 OpenLux 控制台查看（Console → supported models）或 GET /v1/models
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
  id: "openlux",
  version: "2.4",
  author: "Toonflow",
  name: "OpenLux",
  description:
    "OpenLux AI 聚合中转平台（OpenAI 兼容），支持 GPT / Claude / DeepSeek / Gemini 文本对话及图片生成/图生图。\n[官方文档](https://doc.openlux.ai) ｜ [控制台](https://console.openlux.ai)\n\n可用模型请在 OpenLux 控制台「supported models」查看，或填入密钥后访问 `GET /v1/models`；也可在下方手动添加/修改模型。",
  icon: "",
  inputs: [
    { key: "apiKey", label: "API密钥", type: "password", required: true, placeholder: "Console → API tokens 创建，格式 sk-xxx" },
    { key: "baseUrl", label: "请求地址", type: "url", required: true, placeholder: "以v1结束，示例：https://api.openlux.ai/v1" },
  ],
  inputValues: {
    apiKey: "",
    baseUrl: "https://api.openlux.ai/v1",
  },
  models: [
    // ---- 文本对话 ----
    { name: "GPT-5.6 Sol", modelName: "gpt-5.6-sol", type: "text", think: false },
    { name: "Claude Opus 5", modelName: "claude-opus-5", type: "text", think: false },
    { name: "Claude Fable 5", modelName: "claude-fable-5", type: "text", think: false },
    { name: "Claude Opus 4.8", modelName: "claude-opus-4-8", type: "text", think: false },
    { name: "DeepSeek V4 Flash", modelName: "deepseek-v4-flash", type: "text", think: false },
    { name: "DeepSeek V4 Pro", modelName: "deepseek-v4-pro", type: "text", think: false },
    { name: "Gemini 3.7 Flash", modelName: "gemini-3.7-flash", type: "text", think: false },
    // ---- 高性价比多模态（支持图片分析/视觉打标）----
    { name: "Gemini 3.5 Flash-Lite（便宜·视觉）", modelName: "gemini-3.5-flash-lite", type: "text", think: false },
    { name: "Gemini 3.1 Flash-Lite（更省·视觉）", modelName: "gemini-3.1-flash-lite", type: "text", think: false },
    { name: "Gemini 2.5 Flash-Lite（极致省钱·视觉）", modelName: "gemini-2.5-flash-lite", type: "text", think: false },
    // ---- 图片生成（文生图 + 图生图）----
    { name: "GPT Image 2", modelName: "gpt-image-2", type: "image", mode: ["text", "singleImage", "multiReference"] },
    { name: "Nano Banana 2", modelName: "gemini-3.1-flash-image", type: "image", mode: ["text", "singleImage", "multiReference"] },
    // ---- TTS 语音合成 ----
    {
      name: "GPT-4o Mini TTS",
      modelName: "gpt-4o-mini-tts",
      type: "tts",
      voices: [
        { title: "Alloy（均衡）", voice: "alloy" },
        { title: "Echo（温暖）", voice: "echo" },
        { title: "Fable（明亮）", voice: "fable" },
        { title: "Onyx（低沉）", voice: "onyx" },
        { title: "Nova（柔和）", voice: "nova" },
        { title: "Shimmer（清亮）", voice: "shimmer" },
      ],
    },
    {
      name: "TTS-1",
      modelName: "tts-1",
      type: "tts",
      voices: [
        { title: "Alloy（均衡）", voice: "alloy" },
        { title: "Echo（温暖）", voice: "echo" },
        { title: "Fable（明亮）", voice: "fable" },
        { title: "Onyx（低沉）", voice: "onyx" },
        { title: "Nova（柔和）", voice: "nova" },
        { title: "Shimmer（清亮）", voice: "shimmer" },
      ],
    },
    {
      name: "MiniMax-Voice-Design（海螺音色设计）",
      modelName: "MiniMax-Voice-Design",
      type: "tts",
      voices: [
        { title: "温柔女声-轻清", voice: "female-qn-qingse" },
        { title: "活泼女声-甜甜", voice: "female-tianmei" },
        { title: "磁性男声-沉稳", voice: "male-qn-jingying" },
        { title: "青年男声-阳光", voice: "male-calm" },
        { title: "默认音色", voice: "male-qn-qingse" },
      ],
    },
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
  if (!vendor.inputValues.apiKey) throw new Error("缺少API Key");
  const apiKey = vendor.inputValues.apiKey.replace(/^Bearer\s+/i, "");
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
    logger(`OpenLux 文生图，模型：${model.modelName}`);
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
  logger(`OpenLux 图生图，模型：${model.modelName}，参考图 ${refs.length} 张`);
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
  const modelName = model.modelName;
  const headers = getHeaders();

  // ---- MiniMax 系模型：走异步 TTS（t2a_async_v2）----
  if (/minimax/i.test(modelName)) {
    const apiRoot = baseUrl.replace(/\/v1$/, ""); // https://api.openlux.ai
    logger(`MiniMax TTS 提交任务，模型：${modelName}，音色：${config.voice}`);
    const submitResp = await fetch(`${apiRoot}/minimax/v1/t2a_async_v2`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: modelName,
        text: config.text,
        voice_setting: {
          voice_id: config.voice || "female-qn-qingse",
          speed: config.speechRate || 1,
          vol: config.volume || 1,
          pitch: config.pitchRate || 0,
        },
        audio_setting: { sample_rate: 32000, bitrate: 128000, format: "mp3", channel: 1 },
      }),
    });
    const submitData = await submitResp.json();
    if (submitData?.base_resp?.status_code !== 0) {
      throw new Error(`MiniMax TTS 提交失败：${submitData?.base_resp?.status_msg || JSON.stringify(submitData).slice(0, 200)}`);
    }
    const taskId = submitData?.data?.task_id;
    if (!taskId) throw new Error(`MiniMax TTS 提交失败：无 task_id ${JSON.stringify(submitData).slice(0, 200)}`);
    logger(`MiniMax TTS 任务提交成功，task_id: ${taskId}`);

    // 轮询任务结果
    const pollResult = await pollTask(
      async () => {
        const queryResp = await fetch(`${apiRoot}/minimax/v1/query_async_t2a_v2`, {
          method: "POST",
          headers,
          body: JSON.stringify({ task_id: taskId }),
        });
        const queryData = await queryResp.json();
        if (queryData?.base_resp?.status_code !== 0) {
          return { completed: true, error: queryData?.base_resp?.status_msg || "查询失败" };
        }
        const status = queryData?.data?.status;
        if (status === "Success") {
          const audioFile = queryData?.data?.audio_file;
          return { completed: true, data: audioFile };
        }
        if (status === "Fail") {
          return { completed: true, error: queryData?.data?.fail_reason || "语音生成失败" };
        }
        return { completed: false };
      },
      3000,
      120000,
    );
    if (pollResult.error) throw new Error(pollResult.error);
    logger(`MiniMax TTS 生成成功，下载音频`);
    return await urlToBase64(pollResult.data!);
  }

  // ---- 其他模型：OpenAI 兼容 /audio/speech ----
  logger(`OpenLux TTS 合成，模型：${modelName}，音色：${config.voice}`);
  const resp = await fetch(`${baseUrl}/audio/speech`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: modelName,
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
  return { hasUpdate: false, latestVersion: "2.3", notice: "" };
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
