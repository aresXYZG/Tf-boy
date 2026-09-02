import express from "express";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import u from "@/utils";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";

const router = express.Router();

// 人种 → nat 列表（randomuser.me 国籍代码）
const ETHNICITY_NATS: Record<string, string[]> = {
  东亚: [],
  东南亚: [],
  南亚: ["in", "pk", "bd", "lk", "np"],
  欧美: ["us", "gb", "au", "fr", "de", "nl", "es", "ie", "ca", "ch", "fi", "no", "se", "dk", "nz", "be", "at", "it", "pl"],
  拉丁: ["br", "mx", "ar", "co", "pe", "cl"],
  非裔: [],
  其他: [],
};

// 年龄 → 年龄段映射
function ageToGroup(age: number): string {
  if (age < 18) return "少年";
  if (age < 30) return "青年";
  if (age < 50) return "中年";
  return "老年";
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

/**
 * 自动导入多样化真人男女样例：覆盖 5 种人种 × 男女，每组 5 张（年龄段尽量分散）
 */
export default router.post(
  "/",
  validateFields({
    perGroup: z.number().optional(), // 每组张数，默认 5
  }),
  async (req, res) => {
    const perGroup = Math.min(Math.max(req.body?.perGroup ?? 5, 1), 10);

    try {
      // 1. 按人种 × 性别 逐组抓取
      const groups: { ethnicity: string; gender: "男" | "女"; genderParam: string; nats: string[] }[] = [];
      for (const [ethnicity, nats] of Object.entries(ETHNICITY_NATS)) {
        groups.push({ ethnicity, gender: "男", genderParam: "male", nats });
        groups.push({ ethnicity, gender: "女", genderParam: "female", nats });
      }

      // 已有资产名称，用于去重
      const existingRows = await u.db("o_faceAsset").select("name");
      const existingNames = new Set(existingRows.map((r: any) => r.name || ""));

      let successCount = 0;
      const failed: string[] = [];

      const importOne = async (user: any, gender: "男" | "女", ethnicity: string) => {
        const first = (user.name?.first || "").replace(/[^\u4e00-\u9fa5a-zA-Z]/g, "");
        const baseName = `${ethnicity}${gender}${first ? `-${first}` : ""}`;
        if (existingNames.has(`${baseName}_${gender}`)) return;
        const name = `${baseName}_${gender}`;
        try {
          const imgResp = await fetch(user.picture?.large || user.picture?.medium, { signal: AbortSignal.timeout(30000) });
          if (!imgResp.ok) throw new Error(`图片下载失败 ${imgResp.status}`);
          const buf = Buffer.from(await imgResp.arrayBuffer());

          const imagePath = `/faceAssets/${uuidv4()}.jpg`;
          await u.oss.writeFile(imagePath, buf);

          const ageGroup = ageToGroup(user.dob?.age ?? 25);
          const [id] = await u.db("o_faceAsset").insert({
            name,
            filePath: imagePath,
            gender,
            ageGroup,
            ethnicity,
            tags: JSON.stringify(["真人样例", gender, ethnicity]),
            description: `自动导入的${ethnicity}${gender}性真人样例（${ageGroup}），来源 randomuser.me，可用于角色生图参考底图。`,
            createTime: Date.now(),
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
          failed.push(`${group.ethnicity}${group.gender}: 图源请求失败 ${resp.status}`);
          continue;
        }
        const data: any = await resp.json();
        const candidates = pickAgeDiverse(data?.results || [], perGroup);
        for (const user of candidates) {
          await importOne(user, group.gender, group.ethnicity);
        }
      }

      const msg = `自动导入完成：成功 ${successCount} 张（覆盖 5 人种 × 男女 × 每组 ${perGroup} 张），失败 ${failed.length} 张`;
      if (failed.length) console.warn("[autoImportSamples] 失败明细:", failed.slice(0, 5));
      res.status(200).send(success(msg));
    } catch (e) {
      console.error("[autoImportSamples Error]:", e);
      res.status(500).send(error(u.error(e).message));
    }
  },
);
