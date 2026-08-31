import u from "@/utils";

export interface FaceSampleResult {
  referenceList: { type: "image"; base64: string }[];
  faceAssetIds: number[];
  faceSummaryPrompt: string;
}

/**
 * 根据角色描述文本（推断性别/人种/年龄段），从 o_faceAsset 表中抽样 2 张人脸底图
 */
export async function sampleDualFaceAssets(roleDesc: string, roleName: string = ""): Promise<FaceSampleResult> {
  const fullText = `${roleName} ${roleDesc}`;

  // 1. 性别推断（默认女）
  let gender = "女";
  if (/男|男主|少年|叔|公|兄|弟|爷|先生|帅哥|小伙|boy|man|male/i.test(fullText)) {
    gender = "男";
  } else if (/女|女主|少女|姐|妹|婆|女士|美女|姑娘|girl|woman|female/i.test(fullText)) {
    gender = "女";
  }

  // 2. 人种推断（默认东亚）
  let ethnicity = "东亚";
  if (/欧美|白人|西方|金发|碧眼|caucasian|western|white/i.test(fullText)) {
    ethnicity = "欧美";
  } else if (/混血|中西|half|mixed/i.test(fullText)) {
    ethnicity = "混血";
  } else if (/非裔|黑人|black|african/i.test(fullText)) {
    ethnicity = "非裔";
  }

  // 3. 年龄段推断（默认青年）
  let ageGroup = "青年";
  if (/幼|少儿|童|萝莉|正太|孩|child|kid/i.test(fullText)) {
    ageGroup = "少年";
  } else if (/少年|高中生|初中生|学生|青涩|teen/i.test(fullText)) {
    ageGroup = "少年";
  } else if (/中年|大叔|熟男|熟女|3\d岁|4\d岁|middle/i.test(fullText)) {
    ageGroup = "中年";
  } else if (/老|爷|婆|年迈|白发沧桑|6\d岁|7\d岁|elder/i.test(fullText)) {
    ageGroup = "老年";
  }

  // 4. 从数据库中查询匹配的人脸资产
  let candidates = await u.db("o_faceAsset").where({ gender, ethnicity }).select("*");
  if (candidates.length < 2) {
    // 降级：仅按性别匹配
    candidates = await u.db("o_faceAsset").where({ gender }).select("*");
  }
  if (candidates.length < 2) {
    // 再次降级：全量候选
    candidates = await u.db("o_faceAsset").select("*");
  }

  // 如果数据库中没有足够的人脸资产，返回空引用
  if (candidates.length === 0) {
    return {
      referenceList: [],
      faceAssetIds: [],
      faceSummaryPrompt: `【角色特征建议】：${ethnicity}${ageGroup}${gender}，骨相立体自然，杜绝模板化网红脸。`,
    };
  }

  // 随机洗牌抽取 2 张（如果只有 1 张就用 1 张）
  const shuffled = candidates.sort(() => 0.5 - Math.random());
  const selected = shuffled.slice(0, 2);

  const referenceList: { type: "image"; base64: string }[] = [];
  const faceAssetIds: number[] = [];

  for (const item of selected) {
    faceAssetIds.push(item.id);
    if (item.filePath) {
      try {
        const base64 = await u.oss.getImageBase64(item.filePath);
        if (base64) {
          referenceList.push({ type: "image", base64 });
        }
      } catch (e) {
        console.warn("读取人脸资产base64失败:", item.filePath, e);
      }
    }
  }

  let faceSummaryPrompt = "";
  if (selected.length >= 2) {
    const f1 = selected[0];
    const f2 = selected[1];
    faceSummaryPrompt = `【双参考底图特征融合】：全新原创${ethnicity}${ageGroup}${gender}角色，融合两张参考底图：图2（主要参考70%：${f2.description || "主导五官神韵与生活化面孔"}）与图1（辅助参考30%：${f1.description || "提供骨相立体度与下颌线条"}），严禁机械克隆单张底图。`;
  } else if (selected.length === 1) {
    const f = selected[0];
    faceSummaryPrompt = `【参考底图特征融合】：全新原创${ethnicity}${ageGroup}${gender}角色，参考底图（${f.description || "提供面部骨相与五官气质"}），生成全新原创面容。`;
  }

  return {
    referenceList,
    faceAssetIds,
    faceSummaryPrompt,
  };
}
