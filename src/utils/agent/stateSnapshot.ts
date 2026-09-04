import crypto from "node:crypto";
import { db as knexDb } from "@/utils/db";

/**
 * 剧本Agent状态快照：按"对话轮次"记录工作区状态，支持回退到任意一轮完成时的状态
 * 覆盖范围：故事骨架/改编策略(o_agentWorkData)、剧本(o_script)、剧本-资产映射(o_scriptAssets)、项目元数据(o_project)
 * 对话记忆(memories)不快照，回退时按时间截断删除
 */

const AGENT_KEY = "scriptAgent";
/** 每个项目保留的快照条数上限（超出后清理最旧的） */
const SNAPSHOT_LIMIT = 60;

interface SnapshotScriptRow {
  id: number;
  name: string | null;
  content: string | null;
  createTime: number | null;
}

interface SnapshotPayload {
  workData: string | null;
  scripts: SnapshotScriptRow[];
  scriptAssets: { scriptId: number; assetId: number }[];
  projectMeta: {
    totalEpisodes: number | null;
    episodeDuration: number | null;
    intro: string | null;
  };
}

/** 在 better-sqlite3 原生连接上同步执行，绕开 knex 写入丢失问题 */
async function withRawConnection<T>(fn: (conn: any) => T): Promise<T> {
  const conn: any = await (knexDb.client as any).acquireConnection();
  try {
    return fn(conn);
  } finally {
    await (knexDb.client as any).releaseConnection(conn);
  }
}

function readCurrentStateWithConn(conn: any, projectId: number): SnapshotPayload {
  const workRow = conn.prepare("SELECT data FROM o_agentWorkData WHERE projectId = ? AND key = ?").get(projectId, AGENT_KEY);
  const scripts = conn.prepare("SELECT id, name, content, createTime FROM o_script WHERE projectId = ?").all(projectId);
  const project = conn.prepare("SELECT totalEpisodes, episodeDuration, intro FROM o_project WHERE id = ?").get(projectId);
  const scriptIds = scripts.map((s: any) => s.id);
  const scriptAssets = scriptIds.length
    ? conn
        .prepare(`SELECT scriptId, assetId FROM o_scriptAssets WHERE scriptId IN (${scriptIds.map(() => "?").join(",")})`)
        .all(...scriptIds)
    : [];
  return {
    workData: workRow?.data ?? null,
    scripts,
    scriptAssets,
    projectMeta: {
      totalEpisodes: project?.totalEpisodes ?? null,
      episodeDuration: project?.episodeDuration ?? null,
      intro: project?.intro ?? null,
    },
  };
}

/** 沿 refId 链解析快照实际载荷（去重行 payload 为空，指向持有相同载荷的行） */
function resolvePayloadRowWithConn(conn: any, row: any): SnapshotPayload | null {
  let current = row;
  let guard = 0;
  while (current && current.payload == null && current.refId != null && guard++ < SNAPSHOT_LIMIT) {
    current = conn.prepare("SELECT id, payload, refId FROM o_agentStateSnapshot WHERE id = ?").get(current.refId);
  }
  if (!current?.payload) return null;
  try {
    return JSON.parse(current.payload);
  } catch {
    return null;
  }
}

/** 清理超出保留上限的旧快照；清理前将被引用的载荷物化到保留行，避免断链 */
async function pruneSnapshots(projectId: number, isolationKey: string) {
  await withRawConnection((conn) => {
    const rows: any[] = conn
      .prepare("SELECT id, payload, refId FROM o_agentStateSnapshot WHERE projectId = ? AND isolationKey = ? ORDER BY id DESC")
      .all(projectId, isolationKey);
    if (rows.length <= SNAPSHOT_LIMIT) return null;
    const keepRows = rows.slice(0, SNAPSHOT_LIMIT);
    const keepIds = new Set(keepRows.map((r: any) => r.id));
    for (const row of keepRows) {
      if (row.payload == null && row.refId != null && !keepIds.has(row.refId)) {
        const resolved = resolvePayloadRowWithConn(conn, row);
        if (resolved) {
          conn.prepare("UPDATE o_agentStateSnapshot SET payload = ?, refId = NULL WHERE id = ?").run(JSON.stringify(resolved), row.id);
        }
      }
    }
    const delIds = rows.slice(SNAPSHOT_LIMIT).map((r: any) => r.id);
    if (delIds.length) {
      conn.prepare(`DELETE FROM o_agentStateSnapshot WHERE id IN (${delIds.map(() => "?").join(",")})`).run(...delIds);
    }
    return null;
  });
}

/**
 * 捕获当前工作区状态快照
 * @param userMessageTime 该轮用户消息时间戳；传 0 表示"初始状态"基线快照
 */
export async function captureSnapshot(projectId: number, isolationKey: string, userMessageTime: number) {
  const payload = await withRawConnection((conn) => readCurrentStateWithConn(conn, projectId));
  const stateHash = crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");

  await withRawConnection((conn) => {
    const latest = conn
      .prepare("SELECT id, stateHash, payload, refId FROM o_agentStateSnapshot WHERE projectId = ? AND isolationKey = ? ORDER BY id DESC LIMIT 1")
      .get(projectId, isolationKey);
    let payloadStr: string | null = JSON.stringify(payload);
    let refId: number | null = null;
    // 状态与上一张快照完全相同：存引用行避免重复占用空间
    if (latest && latest.stateHash === stateHash) {
      payloadStr = null;
      refId = latest.payload != null ? latest.id : latest.refId;
    }

    conn.prepare(
      "INSERT INTO o_agentStateSnapshot (projectId, isolationKey, userMessageTime, turnEndTime, stateHash, payload, refId, createTime) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(projectId, isolationKey, userMessageTime, Date.now(), stateHash, payloadStr, refId, Date.now());
    return null;
  });
  await pruneSnapshots(projectId, isolationKey);
}

/** 确保项目存在基线快照（首轮对话前调用，用于支持回退到"最开始"） */
export async function ensureBaselineSnapshot(projectId: number, isolationKey: string) {
  const existing = await withRawConnection((conn) =>
    conn.prepare("SELECT id FROM o_agentStateSnapshot WHERE projectId = ? AND isolationKey = ? LIMIT 1").get(projectId, isolationKey),
  );
  if (!existing) await captureSnapshot(projectId, isolationKey, 0);
}

/**
 * 回退到指定时间点的状态
 * @param mode keep=保留该轮结果（回退到某条AI回复完成时）；discard=丢弃该轮结果（回到某条用户消息发出前）
 * @param messageTime 目标消息的时间戳（毫秒）
 */
export async function restoreSnapshot(projectId: number, isolationKey: string, mode: "keep" | "discard", messageTime: number) {
  const row = await withRawConnection((conn) =>
    mode === "keep"
      ? conn
          .prepare("SELECT * FROM o_agentStateSnapshot WHERE projectId = ? AND isolationKey = ? AND userMessageTime <= ? ORDER BY id DESC LIMIT 1")
          .get(projectId, isolationKey, messageTime)
      : conn
          .prepare("SELECT * FROM o_agentStateSnapshot WHERE projectId = ? AND isolationKey = ? AND userMessageTime < ? ORDER BY id DESC LIMIT 1")
          .get(projectId, isolationKey, messageTime),
  );
  if (!row) throw new Error("该时间点之前没有可用的状态快照（快照功能启用前的消息无法回退）");

  const payload = await withRawConnection((conn) => (row.payload != null ? safeParse(row.payload) : resolvePayloadRowWithConn(conn, row)));
  if (!payload) throw new Error("快照数据损坏，无法回退");

  // 使用 better-sqlite3 原生连接同步执行全部恢复步骤，确保同一连接上的强一致读写
  const conn: any = await (knexDb.client as any).acquireConnection();
  try {
    // 1. 恢复骨架/改编策略工作区
    const existingWork = conn.prepare("SELECT id, data FROM o_agentWorkData WHERE projectId = ? AND key = ?").get(projectId, AGENT_KEY);
    if (payload.workData != null) {
      if (existingWork) {
        conn.prepare("UPDATE o_agentWorkData SET data = ?, updateTime = ? WHERE id = ?").run(payload.workData, Date.now(), existingWork.id);
      } else {
        conn.prepare("INSERT INTO o_agentWorkData (projectId, key, data, createTime, updateTime) VALUES (?, ?, ?, ?, ?)").run(
          projectId,
          AGENT_KEY,
          payload.workData,
          Date.now(),
          Date.now(),
        );
      }
    } else if (existingWork) {
      // 快照时从未写过工作区：清空骨架/策略但保留行结构
      const dataObj = safeJsonToRecord(existingWork.data);
      delete dataObj.storySkeleton;
      delete dataObj.adaptationStrategy;
      conn.prepare("UPDATE o_agentWorkData SET data = ?, updateTime = ? WHERE id = ?").run(JSON.stringify(dataObj), Date.now(), existingWork.id);
    }

    // 2. 恢复剧本与剧本-资产映射（保留原始 id，避免下游引用断裂）
    const currentIds: number[] = conn.prepare("SELECT id FROM o_script WHERE projectId = ?").all(projectId).map((r: any) => r.id);
    if (currentIds.length) {
      const assetPlaceholders = currentIds.map(() => "?").join(",");
      conn.prepare(`DELETE FROM o_scriptAssets WHERE scriptId IN (${assetPlaceholders})`).run(...currentIds);
    }
    conn.prepare("DELETE FROM o_script WHERE projectId = ?").run(projectId);
    if (payload.scripts?.length) {
      const insertScript = conn.prepare("INSERT INTO o_script (id, projectId, name, content, createTime) VALUES (?, ?, ?, ?, ?)");
      for (const s of payload.scripts) insertScript.run(s.id, projectId, s.name ?? null, s.content ?? null, s.createTime ?? null);
    }
    if (payload.scriptAssets?.length) {
      const insertMap = conn.prepare("INSERT INTO o_scriptAssets (scriptId, assetId) VALUES (?, ?)");
      for (const m of payload.scriptAssets) insertMap.run(m.scriptId, m.assetId);
    }

    // 3. 恢复项目元数据（仅恢复快照覆盖的字段）
    conn.prepare("UPDATE o_project SET totalEpisodes = ?, episodeDuration = ?, intro = ? WHERE id = ?").run(
      payload.projectMeta.totalEpisodes,
      payload.projectMeta.episodeDuration,
      payload.projectMeta.intro,
      projectId,
    );

    // 4. 截断对话记忆：删除被回退轮次的 message 与 summary
    // discard 模式 cutoff = messageTime - 2：该轮用户消息记忆 createTime = messageTime - 1，需一并删除
    const cutoff = mode === "keep" ? row.turnEndTime : messageTime - 2;
    const removedSummaries: { relatedMessageIds: string | null }[] = conn
      .prepare("SELECT relatedMessageIds FROM memories WHERE isolationKey = ? AND type = 'summary' AND createTime > ?")
      .all(isolationKey, cutoff);
    conn.prepare("DELETE FROM memories WHERE isolationKey = ? AND createTime > ?").run(isolationKey, cutoff);
    // 被删 summary 关联的幸存消息重置为未总结，保证短期记忆仍可见
    const unmarkIds = new Set<string>();
    for (const s of removedSummaries) {
      try {
        for (const id of JSON.parse(s.relatedMessageIds ?? "[]")) unmarkIds.add(String(id));
      } catch {}
    }
    if (unmarkIds.size) {
      const placeholders = [...unmarkIds].map(() => "?").join(",");
      conn.prepare(`UPDATE memories SET summarized = 0 WHERE id IN (${placeholders})`).run(...unmarkIds);
    }

    // 5. 删除被回退轮次的快照，保持快照历史与实际时间线一致
    conn.prepare("DELETE FROM o_agentStateSnapshot WHERE projectId = ? AND isolationKey = ? AND userMessageTime > ?").run(
      projectId,
      isolationKey,
      row.userMessageTime,
    );
  } finally {
    await (knexDb.client as any).releaseConnection(conn);
  }

  return {
    restoredTo: row.userMessageTime === 0 ? "初始状态" : new Date(row.turnEndTime).toLocaleString(),
    scriptCount: payload.scripts?.length ?? 0,
  };
}

function safeParse(json: string): SnapshotPayload | null {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function safeJsonToRecord(json: string | null | undefined): Record<string, any> {
  try {
    return JSON.parse(json ?? "{}") ?? {};
  } catch {
    return {};
  }
}


