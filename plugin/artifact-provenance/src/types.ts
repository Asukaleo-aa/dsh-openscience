/**
 * Artifact provenance —— 文件写入记录的折叠函数
 *
 * 从会话日志（SessionEvent[]）折叠出每个文件最后一次被写入的记录
 * （artifact provenance 投影）。纯函数、无状态：同一份日志总是折叠出
 * 同一份 manifest，可恢复 / fork / 压缩后原样重放。
 *
 * 写入证据来自 `tool/result` 事件的 `data.meta`（工具私有展示负载，核心
 * 不解析）：`dsh-tool-fs` 的 write/edit 工具在 meta 里携带
 * `{ diffs: [{ path, oldText, newText }] }`，`path` 即被写入的文件。
 */

import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { JsonValue, SessionEvent } from '@deepseek-ai/dsh-session'

/** 一个文件最近一次写入的记录（seq/time 来自写入它的 tool/result 事件）。 */
export interface ArtifactRecord {
  /** 写入事件在会话日志中的单调序号。 */
  readonly seq: number
  /** 写入事件的 Unix 毫秒时间戳。 */
  readonly time: number
}

/**
 * 折叠会话日志为文件写入 manifest：`path → ArtifactRecord`，最后写入胜出。
 *
 * 对每个 `tool/result` 事件，从 `data.meta` 提取 `diffs[].path` 并记为该
 * 文件的最新写入；同一事件内多个 diff 各自记录。非法 meta（不是对象、
 * `diffs` 不是数组、元素没有字符串 `path`）静默忽略，不抛异常。
 *
 * @param events - 会话日志（按 seq 升序）。
 * @returns 每个被写过文件的最后写入记录；日志为空或没有写入证据时为空 Map。
 */
export function foldArtifactManifest(events: readonly SessionEvent[]): Map<string, ArtifactRecord> {
  const manifest = new Map<string, ArtifactRecord>()
  // callId → 写文件工具的 file_path（从 tool/call 的 arguments 解析）。
  const calls = new Map<string, string>()
  for (const event of events) {
    if (event.type === 'tool/call') {
      const filePath = writeFilePath(event.data.name, event.data.arguments)
      if (filePath !== undefined) calls.set(event.data.callId, filePath)
      continue
    }
    if (event.type !== 'tool/result') continue
    // 失败的工具调用不产生写入记录。
    if (event.data.error) continue
    // 覆盖写入：meta.diffs 带 path（write 工具仅在前值非空时产出 diff）。
    for (const path of diffPaths(event.data.meta)) {
      manifest.set(path, { seq: event.seq, time: event.time })
    }
    // 新建文件兜底：write 的 create（前值为 null）不产出 diff，改从 tool/call 的 file_path 提取。
    const filePath = calls.get(event.data.message.source.callId)
    if (filePath !== undefined) {
      manifest.set(filePath, { seq: event.seq, time: event.time })
    }
  }
  return manifest
}

/** 从 tool/result 的 meta 里提取被写入的文件路径；格式不符的元素直接跳过。 */
function diffPaths(meta: JsonValue | undefined): string[] {
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) return []
  const diffs = meta.diffs
  if (!Array.isArray(diffs)) return []
  const paths: string[] = []
  for (const diff of diffs) {
    if (typeof diff !== 'object' || diff === null || Array.isArray(diff)) continue
    const path = diff.path
    if (typeof path === 'string') paths.push(path)
  }
  return paths
}

/** 从 tool/call 的 name + arguments 提取写文件工具的 file_path；非写工具或解析失败返回 undefined。 */
function writeFilePath(name: string, argumentsJson: string): string | undefined {
  if (!/^(write|edit|str_replace)/.test(name)) return undefined
  try {
    const args = JSON.parse(argumentsJson) as Record<string, unknown>
    return typeof args.file_path === 'string' ? args.file_path : undefined
  } catch {
    return undefined
  }
}

/** workspace 级 provenance 文件路径（跨 session 持久）。 */
export function workspaceProvenancePath(workspaceRoot: string): string {
  return join(workspaceRoot, '.dsh', 'provenance.json')
}

/** 读 workspace 的跨 session manifest（.dsh/provenance.json）；文件缺失或损坏返回空 Map。 */
export function readWorkspaceManifest(workspaceRoot: string): Map<string, ArtifactRecord> {
  const manifest = new Map<string, ArtifactRecord>()
  try {
    const data = JSON.parse(readFileSync(workspaceProvenancePath(workspaceRoot), 'utf8')) as unknown
    if (typeof data !== 'object' || data === null || Array.isArray(data)) return manifest
    for (const [p, rec] of Object.entries(data)) {
      if (typeof rec !== 'object' || rec === null || Array.isArray(rec)) continue
      const r = rec as { seq?: unknown; time?: unknown }
      if (typeof r.seq === 'number' && typeof r.time === 'number') manifest.set(p, { seq: r.seq, time: r.time })
    }
  } catch {
    // 文件不存在或损坏：返回空 manifest
  }
  return manifest
}

/** 把 session manifest 合并进 workspace 文件（time 大者胜出，跨 session 的 seq 不可比），供跨 session 查询。 */
export function mergeWorkspaceManifest(workspaceRoot: string, manifest: Map<string, ArtifactRecord>): void {
  const existing = readWorkspaceManifest(workspaceRoot)
  for (const [p, rec] of manifest) {
    const old = existing.get(p)
    if (old === undefined || rec.time > old.time) existing.set(p, rec)
  }
  try {
    mkdirSync(join(workspaceRoot, '.dsh'), { recursive: true })
  } catch {
    // 目录已存在
  }
  writeFileSync(workspaceProvenancePath(workspaceRoot), JSON.stringify(Object.fromEntries(existing), null, 2))
}

/** 递归扫描目录，收集每个文件的 mtime（相对路径 → Unix 毫秒）。目录缺失或读失败时静默跳过。 */
export function scanDirMtimes(root: string, out: Map<string, number>, prefix = ''): void {
  let entries: string[]
  try {
    entries = readdirSync(root)
  } catch {
    return
  }
  for (const name of entries) {
    const full = join(root, name)
    const rel = prefix === '' ? name : `${prefix}/${name}`
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) {
      scanDirMtimes(full, out, rel)
    } else {
      out.set(rel, st.mtimeMs)
    }
  }
}
