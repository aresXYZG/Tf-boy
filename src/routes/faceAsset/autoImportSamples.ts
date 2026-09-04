import express from "express";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import u from "@/utils";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";

const router = express.Router();

// 数字码值字典（全系统统一）
const GENDER_LABEL: Record<number, string> = { 1: "男", 2: "女", 3: "中性" };
const ETHNICITY_LABEL: Record<number, string> = { 1: "东亚", 2: "欧美", 3: "东南亚", 4: "南亚", 5: "拉丁", 6: "非裔", 7: "混血" };
const AGE_GROUP_LABEL: Record<number, string> = { 1: "少年", 2: "青年", 3: "中年", 4: "老年" };

// 族裔码值 → randomuser.me 国籍代码（该图源无东亚/东南亚/非裔国籍，空数组组直接跳过）
const ETHNICITY_NATS: Record<number, string[]> = {
  2: ["us", "gb", "au", "fr", "de", "nl", "es", "ie", "ca", "ch", "fi", "no", "se", "dk", "nz", "be", "at", "it", "pl"], // 欧美
  4: ["in", "pk", "bd", "lk", "np"], // 南亚
  5: ["br", "mx", "ar", "co", "pe", "cl"], // 拉丁
};

// 年龄 → 年龄段码值：1=少年(12-17), 2=青年(18-35), 3=中年(36-55), 4=老年(56+)
function ageToGroupCode(age: number): number {
  if (age < 18) return 1;
  if (age < 36) return 2;
  if (age < 56) return 3;
  return 4;
}

// 在返回的候选人中挑选 age 跨度最大的 n 个，保证年龄段多样化
function pickAgeDiverse(candidates: any[], n: number): any[] {
  if (candidates.length <= n) return candidates;
  const sorted = [...candidates].sort((a, b) => (a.dob?.age ?? 0) - (b.dob?.age ?? 0));
  const picked: any[] = [];
  // 均匀采样：首尾 + 等距中间
  const step = (sorted.length - 1) / Math.max(n - 1, 1);
  for (let i = 0; i < n; i++) {
    picked.push(sorted[Math.min(sorted.length - 1, Math.round(i * step))]);
  }
  return picked;
}

// 素人图源默认颜值落在 5.2~6.8（真实素人正态分布主体区间），按名称哈希做确定性微扰，避免整库同分
function sampleBeautyScore(seedText: string): number {
  let hash = 0;
  for (let i = 0; i < seedText.length; i++) {
    hash = (hash * 31 + seedText.charCodeAt(i)) >>> 0;
  }
  return Math.round((5.2 + (hash % 17) * 0.1) * 10) / 10; // 5.2 ~ 6.8
}

/**
 * 自动导入多样化真人样例：覆盖有图源支持的族裔 × 男女，每组 N 张（年龄段尽量分散），全部按数字码值入库
 */
export default router.post(
  "/",
  validateFields({
    perGroup: z.number().optional(), // 每组张数，默认 5
  }),
  async (req, res) => {
    const perGroup = Math.min(Math.max(req.body?.perGroup ?? 8, 1), 20);

    try {
      // 1. 按族裔码值 × 性别码值逐组抓取（跳过无图源的族裔）
      const groups: { ethnicityCode: number; genderCode: 1 | 2; genderParam: string; nats: string[] }[] = [];
      for (const [ethnicityCode, nats] of Object.entries(ETHNICITY_NATS)) {
        if (!nats.length) continue;
        const code = Number(ethnicityCode);
        groups.push({ ethnicityCode: code, genderCode: 1, genderParam: "male", nats });
        groups.push({ ethnicityCode: code, genderCode: 2, genderParam: "female", nats });
      }

      // 已有资产名称，用于去重
      const existingRows = await u.db("o_faceAsset").select("name");
      const existingNames = new Set(existingRows.map((r: any) => r.name || ""));

      let successCount = 0;
      const failed: string[] = [];

      const importOne = async (user: any, genderCode: 1 | 2, ethnicityCode: number) => {
        const genderLabel = GENDER_LABEL[genderCode];
        const ethnicityLabel = ETHNICITY_LABEL[ethnicityCode] || "未知";
        const first = (user.name?.first || "").replace(/[^\u4e00-\u9fa5a-zA-Z]/g, "");
        const baseName = `${ethnicityLabel}${genderLabel}${first ? `-${first}` : ""}`;
        if (existingNames.has(`${baseName}_${genderLabel}`)) return;
        const name = `${baseName}_${genderLabel}`;
        try {
          const imgResp = await fetch(user.picture?.large || user.picture?.medium, { signal: AbortSignal.timeout(30000) });
          if (!imgResp.ok) throw new Error(`图片下载失败 ${imgResp.status}`);
          const buf = Buffer.from(await imgResp.arrayBuffer());

          const imagePath = `/faceAssets/${uuidv4()}.jpg`;
          await u.oss.writeFile(imagePath, buf);

          const ageGroupCode = ageToGroupCode(user.dob?.age ?? 25);
          const ageGroupLabel = AGE_GROUP_LABEL[ageGroupCode] || "青年";
          const beautyScore = sampleBeautyScore(name);
          // varchar 码值列一律以字符串写入（'1'），避免 SQLite 把数字绑定为 REAL 转成 '1.0' 文本
          const [id] = await u.db("o_faceAsset").insert({
            name,
            filePath: imagePath,
            species: 1,
            gender: String(genderCode),
            ethnicity: String(ethnicityCode),
            ageGroup: String(ageGroupCode),
            beautyScore,
          });
          if (id) {
            successCount++;
            existingNames.add(name);
          }
        } catch (e: any) {
          failed.push(`${name}: ${e?.message || e}`);
        }
      };

      for (const group of groups) {
        // 一次取较多候选，再挑选年龄段分散的 perGroup 张
        const resp = await fetch(
          `https://randomuser.me/api/?results=${perGroup * 4}&gender=${group.genderParam}&inc=gender,name,picture,nat,dob&nat=${group.nats.join(",")}&seed=${Date.now()}${Math.floor(Math.random() * 100000)}`,
          { signal: AbortSignal.timeout(30000) },
        );
        if (!resp.ok) {
          failed.push(`${ETHNICITY_LABEL[group.ethnicityCode]}${GENDER_LABEL[group.genderCode]}: 图源请求失败 ${resp.status}`);
          continue;
        }
        const data: any = await resp.json();
        const candidates = pickAgeDiverse(data?.results || [], perGroup);
        for (const user of candidates) {
          await importOne(user, group.genderCode, group.ethnicityCode);
        }
      }

      const ethnicityCount = new Set(groups.map((g) => g.ethnicityCode)).size;
      const msg = `自动导入完成：成功 ${successCount} 张（覆盖 ${ethnicityCount} 族裔 × 男女 × 每组 ${perGroup} 张），失败 ${failed.length} 张`;
      if (failed.length) console.warn("[autoImportSamples] 失败明细:", failed.slice(0, 5));
      res.status(200).send(success(msg));
    } catch (e) {
      console.error("[autoImportSamples Error]:", e);
      res.status(500).send(error(u.error(e).message));
    }
  },
);
