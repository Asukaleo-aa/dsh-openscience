/**
 * Artifact provenance 投影 —— DeepSeek Harness 插件
 *
 * `ctx.provenance`：纯折叠投影服务，把会话日志折叠成文件写入记录
 * （path → 最后写入的 seq/time）。不监听事件、不持有状态、不依赖其他服务：
 * manifest 按需从 `session.events` 折叠，可恢复 / fork / 压缩后原样重放。
 *
 * 写入证据：`tool/result` 事件的 `data.meta.diffs[].path`
 * （`dsh-tool-fs` 的 write/edit 工具写入时附带的负载）。
 *
 * @module @deepseek-ai/dsh-artifact-provenance
 */

import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { foldArtifactManifest, mergeWorkspaceManifest, readWorkspaceManifest, scanDirMtimes, type ArtifactRecord } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    provenance: ArtifactProvenance
  }
}

/** `ctx.provenance`：artifact provenance 投影服务，按需折叠、最后写入胜出。 */
export class ArtifactProvenance extends Service {
  static inject = ['tools']

  /** bash 调用开始时间（callId → epoch ms），用于关联 bash 执行窗口内的产物。 */
  private readonly bashCalls = new Map<string, number>()

  constructor(ctx: Context) {
    super(ctx, 'provenance')

    // ── 跨 session 持久化：tool/result 后把 manifest 合并进 workspace 文件 ──
    ctx.on('session/event', (session, event) => {
      if (event.type === 'tool/call' && event.data.name === 'bash') {
        this.bashCalls.set(event.data.callId, event.time)
        return
      }
      if (event.type !== 'tool/result' || event.data.error) return
      const root = session.header.cwd ?? process.cwd()
      mergeWorkspaceManifest(root, foldArtifactManifest(session.events))
      // bash 产物：扫描 output/ 目录，把 bash 执行窗口内生成的文件也记入 provenance
      const callId = event.data.message.source.callId
      const startTime = this.bashCalls.get(callId)
      if (startTime !== undefined) {
        this.bashCalls.delete(callId)
        this.scanBashArtifacts(root, startTime, event.time, event.seq)
      }
    })

    // ── provenance_last_write：模型可查询某文件最后一次写入的 seq/time ──
    ctx.tools.register(defineTool({
      name: 'provenance_last_write',
      description:
        '查询某个文件在本会话中最后一次被写入的会话序号(seq)和 Unix 时间戳(time)。'
        + '用于溯源判断：例如判断一个产出图片是否比生成它的脚本更新。',
      parameters: {
        path: {
          type: 'string',
          required: true,
          description: '要查询的文件路径',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            found: { type: 'boolean', required: true },
            path: { type: 'string', required: true },
            seq: { type: 'number' },
            time: { type: 'number' },
          },
        },
        render: (_args, value) => [{
          type: 'text',
          text: value.found
            ? `文件 ${value.path} 最后写入：seq=${value.seq}, time=${value.time}`
            : `文件 ${value.path} 在本会话中未被写入过`,
        }],
      },
      execute: async (args, exec) => {
        const agent = exec.agent
        if (agent === undefined) throw new Error('provenance_last_write requires a calling agent')
        const record = this.lastWrite(agent.session, args.path)
        if (record === undefined) return { found: false, path: args.path }
        return { found: true, path: args.path, seq: record.seq, time: record.time }
      },
    }))
  }

  /**
   * 折叠出该会话每个文件最后一次写入的记录。
   * @param session - 目标会话。
   * @returns `path → { seq, time }` 的 manifest，最后写入胜出。
   */
  manifest(session: Session): Map<string, ArtifactRecord> {
    return foldArtifactManifest(session.events)
  }

  /**
   * 查询某个文件的最后写入记录。
   * @param session - 目标会话。
   * @param path - 文件路径。
   * @returns 该文件的最后写入记录；会话内从未写过该路径时返回 `undefined`。
   */
  lastWrite(session: Session, path: string): ArtifactRecord | undefined {
    const local = this.manifest(session).get(path)
    if (local !== undefined) return local
    const root = session.header.cwd ?? process.cwd()
    return readWorkspaceManifest(root).get(path)
  }

  /** 扫描 output/ 目录，把 bash 执行窗口内生成/修改的文件记入 workspace provenance。 */
  private scanBashArtifacts(root: string, startTime: number, endTime: number, seq: number): void {
    const mtimes = new Map<string, number>()
    scanDirMtimes(join(root, 'output'), mtimes)
    const changed = new Map<string, ArtifactRecord>()
    const windowStart = startTime - 2000
    const windowEnd = endTime + 2000
    for (const [rel, mtime] of mtimes) {
      if (mtime >= windowStart && mtime <= windowEnd) {
        changed.set(`output/${rel}`, { seq, time: endTime })
      }
    }
    if (changed.size > 0) mergeWorkspaceManifest(root, changed)
  }
}

export default ArtifactProvenance
