import express from "express";
import u from "@/utils";
import { success, error } from "@/lib/responseFormat";

const router = express.Router();

/**
 * 人脸库缺口报告：按 族裔 × 性别 × 年龄段 统计库存。
 * 选图策略为「年龄段硬锁、族裔可放宽」，缺口优先看：某 性别+年龄段 整行为 0（该档完全无底图），
 * 其次看目标族裔列是否为 0（会触发族裔放宽，产生混血融合）。
 */
export default router.post("/", async (req, res) => {
  try {
    const rows = (await u.db("o_faceAsset").where("species", 1).select("gender", "ethnicity", "ageGroup")) as any[];

    const GENDERS = ["1", "2", "3"];
    const ETHNICITIES = ["1", "2", "3", "4", "5", "6", "7"];
    const AGE_GROUPS = ["1", "2", "3", "4"];

    // matrix[gender][ageGroup][ethnicity] = count
    const matrix: Record<string, Record<string, Record<string, number>>> = {};
    for (const g of GENDERS) {
      matrix[g] = {};
      for (const a of AGE_GROUPS) {
        matrix[g][a] = {};
        for (const e of ETHNICITIES) matrix[g][a][e] = 0;
      }
    }
    for (const row of rows) {
      const g = row.gender != null ? String(row.gender) : null;
      const a = row.ageGroup != null ? String(row.ageGroup) : null;
      const e = row.ethnicity != null ? String(row.ethnicity) : null;
      if (g && a && e && matrix[g]?.[a]?.[e] !== undefined) matrix[g][a][e]++;
    }

    // 缺口提示：某 性别+年龄段 总数为 0 → 该档生图将拿不到任何参考底图
    const missingBuckets: string[] = [];
    const GENDER_LABEL: Record<string, string> = { "1": "男", "2": "女", "3": "中性" };
    const ETHNICITY_LABEL: Record<string, string> = { "1": "东亚", "2": "欧美", "3": "东南亚", "4": "南亚", "5": "拉丁", "6": "非裔", "7": "混血" };
    const AGE_LABEL: Record<string, string> = { "1": "少年", "2": "青年", "3": "中年", "4": "老年" };
    for (const g of GENDERS) {
      for (const a of AGE_GROUPS) {
        const total = ETHNICITIES.reduce((s, e) => s + matrix[g][a][e], 0);
        if (total === 0) missingBuckets.push(`${AGE_LABEL[a]}${GENDER_LABEL[g]}`);
      }
    }

    res.status(200).send(
      success({
        matrix,
        labels: { gender: GENDER_LABEL, ethnicity: ETHNICITY_LABEL, ageGroup: AGE_LABEL },
        missingBuckets,
        total: rows.length,
      }),
    );
  } catch (e) {
    console.error("[faceAssetStats Error]:", e);
    res.status(500).send(error(u.error(e).message));
  }
});
