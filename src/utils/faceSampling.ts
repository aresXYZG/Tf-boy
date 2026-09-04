import u from "@/utils";
import _ from "lodash";

/**
 * 角色结构化元数据（数字码值规范）
 */
export interface RoleMeta {
  species?: number; // 物种: 1(人类), 2(非人类/其他)
  gender?: number; // 性别: 1(男), 2(女), 3(中性/其他)
  ethnicity?: number; // 族裔: 1(东亚), 2(欧美), 3(东南亚), 4(南亚), 5(拉丁), 6(非裔), 7(混血/其他)
  ageGroup?: number; // 年龄段: 1(少年), 2(青年), 3(中年), 4(老年)
  actualAge?: number; // 具体年龄数字
  beautyScore?: number; // 颜值打分: 2.0 ~ 10.0
  personality?: string; // 性格与气质关键词
  appearance?: string; // 五官发型外貌特征
  clothing?: string; // 基础常规着装
  figure?: string; // 身高体型描述
}

export interface FaceSampleResult {
  referenceList: { type: "image"; base64: string }[];
  faceAssetIds: number[];
  faceSummaryPrompt: string;
}

// 码值转中文语义映射字典
export const ETHNICITY_MAP: Record<number, string> = {
  1: "东亚",
  2: "欧美",
  3: "东南亚",
  4: "南亚",
  5: "拉丁",
  6: "非裔",
  7: "混血",
};

export const AGE_GROUP_MAP: Record<number, string> = {
  1: "少年",
  2: "青年",
  3: "中年",
  4: "老年",
};

export const GENDER_MAP: Record<number, string> = {
  1: "男",
  2: "女",
  3: "中性",
};

/** 颜值分缺失时的中性兜底值（不再用旧 beautyLevel 高/中映射） */
const DEFAULT_BEAUTY_SCORE = 6.5;

/**
 * 单张人脸加权随机挑选（带温度系数，防止确定性死板锁定）
 */
function weightedPickOne(candidates: any[], targetScore: number, temperature: number = 0.8): any {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  const diffs = candidates.map((item) => {
    const score = typeof item.beautyScore === "number" && !isNaN(item.beautyScore) ? item.beautyScore : DEFAULT_BEAUTY_SCORE;
    return Math.abs(score - targetScore);
  });

  const weights = diffs.map((d) => Math.exp(-d / Math.max(0.1, temperature)));
  const sumWeights = _.sum(weights);

  let rand = Math.random() * sumWeights;
  for (let i = 0; i < candidates.length; i++) {
    rand -= weights[i];
    if (rand <= 0) return candidates[i];
  }
  return candidates[candidates.length - 1];
}

/**
 * 结构化人脸资产抽样函数
 * 筛选策略：年龄段硬锁（放开年龄会让老年角色配到年轻底图，出戏），族裔允许放宽（混血感可接受）
 * 一级：同性别+同族裔+同年龄段 → 二级：同性别+同年龄段（仅放宽族裔）→ 不再降级，单图/空参考兜底
 */
export async function sampleAssetReferences(roleMeta?: RoleMeta | null, roleName: string = ""): Promise<FaceSampleResult> {
  // 1. 非人类角色：直接返回空参考，不注入人脸融合
  if (roleMeta && roleMeta.species !== undefined && roleMeta.species !== 1) {
    return {
      referenceList: [],
      faceAssetIds: [],
      faceSummaryPrompt: "",
    };
  }

  // 2. 提取并规范人类属性码值
  const genderCode = roleMeta?.gender ?? 2; // 默认女
  const ethnicityCode = roleMeta?.ethnicity ?? 1; // 默认东亚
  const ageGroupCode = roleMeta?.ageGroup ?? 2; // 默认青年
  const targetScore = Math.max(2.0, Math.min(10.0, roleMeta?.beautyScore ?? 6.5));

  const genderLabel = GENDER_MAP[genderCode] || "女";
  const ethnicityLabel = ETHNICITY_MAP[ethnicityCode] || "东亚";
  const ageGroupLabel = AGE_GROUP_MAP[ageGroupCode] || "青年";

  // 3. 一级查询：同性别+同族裔+同年龄段（species 为 integer 列，varchar 码值列须按字符串 '1' 匹配）
  let candidates = await u
    .db("o_faceAsset")
    .where({ species: 1, gender: String(genderCode), ethnicity: String(ethnicityCode), ageGroup: String(ageGroupCode) })
    .select("*");

  // 二级降级：仅放宽族裔，年龄段硬锁不动
  let ethnicityRelaxed = false;
  if (candidates.length < 2) {
    candidates = await u
      .db("o_faceAsset")
      .where({ species: 1, gender: String(genderCode), ageGroup: String(ageGroupCode) })
      .select("*");
    ethnicityRelaxed = true;
  }

  if (candidates.length === 0) {
    return {
      referenceList: [],
      faceAssetIds: [],
      faceSummaryPrompt: `【角色特征建议】：全新原创${ethnicityLabel}${ageGroupLabel}${genderLabel}角色，骨相立体自然，杜绝模板化假脸。（人脸库缺${ageGroupLabel}${genderLabel}底图，补充后可启用参考融合）`,
    };
  }

  // 4. 颜值打分容差过滤 (±1.5 分区间加权采样)
  let windowCandidates = candidates.filter((item) => {
    const score = typeof item.beautyScore === "number" && !isNaN(item.beautyScore) ? item.beautyScore : DEFAULT_BEAUTY_SCORE;
    return Math.abs(score - targetScore) <= 1.5;
  });
  if (windowCandidates.length < 2) windowCandidates = candidates;

  // 5. 非对称加权抽样：图2 (70%五官主导) + 图1 (30%骨相辅助)
  const primaryFace = weightedPickOne(windowCandidates, targetScore, 0.8);
  const remainingCandidates = candidates.filter((c) => c.id !== primaryFace.id);
  const secondaryFace = remainingCandidates.length > 0 ? weightedPickOne(remainingCandidates, targetScore, 1.0) : primaryFace;

  const selected = primaryFace.id === secondaryFace.id ? [primaryFace] : [secondaryFace, primaryFace];
  const referenceList: { type: "image"; base64: string }[] = [];
  const faceAssetIds: number[] = [];

  for (const item of selected) {
    if (item.id !== undefined) faceAssetIds.push(item.id);
    if (item.filePath) {
      try {
        const base64 = await u.oss.getImageBase64(item.filePath);
        if (base64) referenceList.push({ type: "image", base64 });
      } catch (e) {
        console.warn("读取人脸底图Base64失败:", item.filePath, e);
      }
    }
  }

  // 6. 组装双底图特征解耦融合 Prompt
  // 不注入底图的具体描述：模型本身看得见垫图，文字复述特征反而会把融合锁死在少数词上
  // 目标族裔文字锚 + 体型解耦：参考底图只管脸，体型永远以角色设定为准
  let faceSummaryPrompt = "";
  const ethnicAnchor = `全新原创${ethnicityLabel}${ageGroupLabel}${genderLabel}角色`;
  if (selected.length >= 2) {
    faceSummaryPrompt = `【双真人参考底图融合（核心必守）】：
基于两张参考底图生成${ethnicAnchor}（严禁直接复制任一张）：
- 图2（主要参考70%）：人物脸部结构、五官比例、眼型神韵、唇形与核心气质以图2为主；
- 图1（辅助参考30%）：只借少量下颌线与鼻骨立体轮廓、皮肤质感、面部状态与肖像氛围；
${ethnicityRelaxed ? "- 两图若族裔不同：五官族裔特征以图2为主自然融合，允许适度混血感，最终族裔向设定（" + ethnicityLabel + "）靠拢；\n" : ""}- 体型与身形以角色设定的身材描述为准，参考底图不约束体型；
两图解耦重构为独立原创角色。`;
  } else if (selected.length === 1) {
    faceSummaryPrompt = `【单真人参考底图融合（核心必守）】：
基于参考底图生成${ethnicAnchor}（严禁直接复制），参考底图仅提供面部骨相、五官气质与肖像质感，体型以角色设定为准。`;
  }

  return { referenceList, faceAssetIds, faceSummaryPrompt };
}

/**
 * 兼容旧接口的适配封装
 */
export async function sampleDualFaceAssets(roleDesc: string, roleName: string = ""): Promise<FaceSampleResult> {
  // 解析简单的关键词转为码值
  const fullText = `${roleName} ${roleDesc}`;
  let gender = 2; // 女
  if (/男|男主|少年|叔|公|兄|弟|爷|先生|帅哥|小伙|boy|man|male/i.test(fullText)) {
    gender = 1;
  }
  let ethnicity = 1; // 东亚
  if (/欧美|白人|西方|金发|碧眼|caucasian|western|white/i.test(fullText)) {
    ethnicity = 2;
  } else if (/东南亚|泰国|越南|印尼|菲律宾|马来/i.test(fullText)) {
    ethnicity = 3;
  } else if (/南亚|印度|巴基斯坦/i.test(fullText)) {
    ethnicity = 4;
  } else if (/拉丁|拉美|巴西|墨西哥/i.test(fullText)) {
    ethnicity = 5;
  } else if (/非裔|黑人|black|african/i.test(fullText)) {
    ethnicity = 6;
  } else if (/混血|中西|half|mixed/i.test(fullText)) {
    ethnicity = 7;
  }

  let ageGroup = 2; // 青年
  if (/幼|少儿|童|萝莉|正太|孩|少年|学生|teen/i.test(fullText)) {
    ageGroup = 1;
  } else if (/中年|大叔|熟男|熟女|3\d岁|4\d岁/i.test(fullText)) {
    ageGroup = 3;
  } else if (/老|爷|婆|年迈|白发|6\d岁|7\d岁|elder/i.test(fullText)) {
    ageGroup = 4;
  }

  let beautyScore = 6.5;
  if (/绝美|盛世美颜|神颜|倾国/i.test(fullText)) {
    beautyScore = 9.2;
  } else if (/颜值|美女|帅哥|惊艳|俊朗|好看|漂亮|帅气/i.test(fullText)) {
    beautyScore = 8.0;
  } else if (/普通|路人|平平|一般|大众脸/i.test(fullText)) {
    beautyScore = 4.8;
  } else if (/沧桑|刀疤|破相|丑|残疾/i.test(fullText)) {
    beautyScore = 3.5;
  }

  return sampleAssetReferences(
    {
      species: 1,
      gender,
      ethnicity,
      ageGroup,
      beautyScore,
    },
    roleName,
  );
}
