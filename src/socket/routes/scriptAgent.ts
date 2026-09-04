import jwt from "jsonwebtoken";
import u from "@/utils";
import { Namespace, Socket } from "socket.io";
import * as agent from "@/agents/scriptAgent/index";
import ResTool from "@/socket/resTool";
import { captureSnapshot, ensureBaselineSnapshot, restoreSnapshot } from "@/utils/agent/stateSnapshot";

async function verifyToken(rawToken: string): Promise<Boolean> {
  const setting = await u.db("o_setting").where("key", "tokenKey").select("value").first();
  if (!setting) return false;
  const { value: tokenKey } = setting;
  if (!rawToken) return false;
  const token = rawToken.replace("Bearer ", "");
  try {
    jwt.verify(token, tokenKey as string);
    return true;
  } catch (err) {
    return false;
  }
}

export default (nsp: Namespace) => {
  nsp.on("connection", async (socket: Socket) => {
    const token = socket.handshake.auth.token;
    if (!token || !(await verifyToken(token))) {
      console.log("[scriptAgent] 连接失败，token无效");
      socket.disconnect();
      return;
    }
    const isolationKey = socket.handshake.auth.isolationKey;
    if (!isolationKey) {
      console.log("[scriptAgent] 连接失败，缺少 isolationKey");
      socket.disconnect();
      return;
    }

    console.log("[scriptAgent] 已连接:", socket.id);

    const resTool = new ResTool(socket, {
      projectId: socket.handshake.auth.projectId,
    });
    let abortController: AbortController | null = null;

    const thinkConfig: agent.AgentContext["thinkConfig"] = {
      think: false,
      thinlLevel: 0,
    };

    socket.on("chat", async (data: { content: string }) => {
      const { content } = data;
      abortController?.abort();
      abortController = new AbortController();
      const currentController = abortController;

      const msg = resTool.newMessage("assistant", "统筹");
      const ctx: agent.AgentContext = {
        socket,
        isolationKey,
        text: content,
        userMessageTime: new Date(msg.datetime).getTime() - 1,
        abortSignal: currentController.signal,
        resTool,
        msg,
        thinkConfig,
      };

      try {
        try {
          // 首轮对话前固化"初始状态"基线快照，支持回退到一切开始之前
          await ensureBaselineSnapshot(Number(resTool.data.projectId), isolationKey);
        } catch (baseErr: any) {
          console.error("[scriptAgent] 基线快照创建失败(不阻塞对话):", u.error(baseErr).message);
        }
        await agent.runDecisionAI(ctx);
      } catch (err: any) {
        if (err.name !== "AbortError" && !currentController.signal.aborted) {
          console.error("[scriptAgent] chat error:", u.error(err).message);
          msg.error(u.error(err).message)
        }
      } finally {
        // 无论成功/中止/超时，轮次结束后记录状态快照（中止时为已落库部分的实际状态）
        try {
          await captureSnapshot(Number(resTool.data.projectId), isolationKey, ctx.userMessageTime ?? Date.now());
        } catch (snapErr: any) {
          console.error("[scriptAgent] 状态快照创建失败:", u.error(snapErr).message);
        }
        if (abortController === currentController) {
          abortController = null;
        }
      }
    });

    // 回退到某条消息对应时刻的工作区状态
    socket.on(
      "rollback",
      async (data: { messageTime: number; mode: "keep" | "discard" }, callback?: (res: { ok: boolean; message?: string; restoredTo?: string }) => void) => {
        try {
          if (abortController) {
            callback?.({ ok: false, message: "生成进行中，请先停止后再回退" });
            return;
          }
          const mode = data?.mode === "discard" ? "discard" : "keep";
          if (typeof data?.messageTime !== "number") {
            callback?.({ ok: false, message: "参数错误：缺少消息时间" });
            return;
          }
          const result = await restoreSnapshot(Number(resTool.data.projectId), isolationKey, mode, data.messageTime);
          console.log(`[scriptAgent] 已回退状态: mode=${mode} restoredTo=${result.restoredTo}`);
          callback?.({ ok: true, ...result });
        } catch (err: any) {
          const message = u.error(err).message;
          console.error("[scriptAgent] 回退失败:", message);
          callback?.({ ok: false, message });
        }
      },
    );

    socket.on("updateThinkConfig", (data: { think: boolean; thinlLevel: 0 | 1 | 2 | 3 }) => {
      thinkConfig.think = data.think;
      thinkConfig.thinlLevel = data.thinlLevel;
      console.log("[scriptAgent] 更新思考配置:", thinkConfig);
    });

    socket.on("stop", () => {
      abortController?.abort();
      abortController = null;
    });
  });
  nsp.on("disconnect", (socket: Socket) => {
    console.log("[scriptAgent] 已断开连接:", socket.id);
  });
};
