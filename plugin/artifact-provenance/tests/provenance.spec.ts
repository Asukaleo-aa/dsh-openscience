import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { foldArtifactManifest, mergeWorkspaceManifest, readWorkspaceManifest, scanDirMtimes, type ArtifactRecord } from '../src/types.ts'

/** 构造一条 tool/call 事件（写工具调用）。 */
function toolCallEvent(seq: number, time: number, callId: string, name: string, argumentsJson: string): SessionEvent {
  return {
    type: 'tool/call',
    seq,
    time,
    data: { turn: 0, step: 0, callId, name, arguments: argumentsJson },
  } as unknown as SessionEvent
}

/** 构造一条 tool/result 事件；callId 缺省为不匹配任何 tool/call 的占位。 */
function toolResultEvent(
  seq: number,
  time: number,
  meta: unknown,
  callId = 'no-match',
  error?: { name: string; code: string },
): SessionEvent {
  const data: Record<string, unknown> = {
    message: { role: 'user', content: [], source: { kind: 'tool', callId } },
    meta,
  }
  if (error !== undefined) data.error = error
  return { type: 'tool/result', seq, time, data } as unknown as SessionEvent
}

describe('foldArtifactManifest', () => {
  it('空日志折叠为空 manifest', () => {
    expect(foldArtifactManifest([])).toEqual(new Map<string, ArtifactRecord>())
  })

  it('一个 tool/result 带 meta.diffs（两个文件）记录两个文件', () => {
    const events = [toolResultEvent(3, 1234, {
      diffs: [
        { path: 'a.txt', oldText: null, newText: 'x' },
        { path: 'b.txt', oldText: 'y', newText: 'z' },
      ],
    })]
    const manifest = foldArtifactManifest(events)
    expect(manifest.size).toBe(2)
    expect(manifest.get('a.txt')).toEqual({ seq: 3, time: 1234 })
    expect(manifest.get('b.txt')).toEqual({ seq: 3, time: 1234 })
  })

  it('两个 tool/result 写同一文件时最后写入胜出', () => {
    const events = [
      toolResultEvent(1, 1000, { diffs: [{ path: 'a.txt', newText: 'first' }] }),
      toolResultEvent(2, 2000, { diffs: [{ path: 'a.txt', newText: 'second' }] }),
    ]
    const manifest = foldArtifactManifest(events)
    expect(manifest.size).toBe(1)
    expect(manifest.get('a.txt')).toEqual({ seq: 2, time: 2000 })
  })

  it('不同文件分别保留各自的最后写入', () => {
    const events = [
      toolResultEvent(1, 1000, { diffs: [{ path: 'a.txt', newText: '1' }] }),
      toolResultEvent(2, 2000, { diffs: [{ path: 'b.txt', newText: '2' }] }),
      toolResultEvent(3, 3000, { diffs: [{ path: 'a.txt', newText: '3' }] }),
    ]
    const manifest = foldArtifactManifest(events)
    expect(manifest.get('a.txt')).toEqual({ seq: 3, time: 3000 })
    expect(manifest.get('b.txt')).toEqual({ seq: 2, time: 2000 })
  })

  it('tool/result 无 meta 时忽略', () => {
    expect(foldArtifactManifest([toolResultEvent(1, 1000, undefined)])).toEqual(new Map())
    expect(foldArtifactManifest([toolResultEvent(1, 1000, null)])).toEqual(new Map())
  })

  it('meta 不是对象时忽略', () => {
    expect(foldArtifactManifest([toolResultEvent(1, 1000, 'not-an-object')])).toEqual(new Map())
    expect(foldArtifactManifest([toolResultEvent(1, 1000, [1, 2, 3])])).toEqual(new Map())
  })

  it('meta.diffs 不是数组时忽略', () => {
    expect(foldArtifactManifest([toolResultEvent(1, 1000, { diffs: 'nope' })])).toEqual(new Map())
    expect(foldArtifactManifest([toolResultEvent(1, 1000, { diffs: { path: 'a.txt' } })])).toEqual(new Map())
    expect(foldArtifactManifest([toolResultEvent(1, 1000, {})])).toEqual(new Map())
  })

  it('diff 元素无 path 或 path 非字符串时忽略该元素，不崩溃', () => {
    expect(foldArtifactManifest([toolResultEvent(1, 1000, { diffs: [{ oldText: 'x' }] })])).toEqual(new Map())
    expect(foldArtifactManifest([toolResultEvent(1, 1000, { diffs: [{ path: 42 }, null, 'str', []] })])).toEqual(new Map())
  })

  it('混合 diff：无 path 的元素被跳过，合法元素仍记录', () => {
    const manifest = foldArtifactManifest([toolResultEvent(1, 1000, {
      diffs: [
        { path: 'a.txt', newText: 'x' },
        { oldText: 'bad' },
        { path: 'b.txt', newText: 'y' },
      ],
    })])
    expect(manifest.size).toBe(2)
    expect(manifest.get('a.txt')).toEqual({ seq: 1, time: 1000 })
    expect(manifest.get('b.txt')).toEqual({ seq: 1, time: 1000 })
  })

  it('忽略非 tool/result 事件', () => {
    const events = [
      toolResultEvent(2, 2000, { diffs: [{ path: 'a.txt', newText: 'x' }] }),
      { type: 'turn/start', seq: 1, time: 500, data: { turn: 0 } } as unknown as SessionEvent,
      {
        type: 'assistant/message',
        seq: 3,
        time: 2500,
        data: { turn: 0, step: 0, message: { role: 'assistant', content: [] } },
      } as unknown as SessionEvent,
    ]
    const manifest = foldArtifactManifest(events)
    expect(manifest.size).toBe(1)
    expect(manifest.get('a.txt')).toEqual({ seq: 2, time: 2000 })
  })

  it('新建文件（write create，无 diffs）从 tool/call 的 file_path 兜底记录', () => {
    const events = [
      toolCallEvent(1, 1000, 'c1', 'write', JSON.stringify({ file_path: '/tmp/new.txt', content: 'x' })),
      toolResultEvent(2, 2000, {}, 'c1'),
    ]
    const manifest = foldArtifactManifest(events)
    expect(manifest.get('/tmp/new.txt')).toEqual({ seq: 2, time: 2000 })
  })

  it('失败的工具调用（tool/result 带 error）不记录', () => {
    const events = [
      toolCallEvent(1, 1000, 'c1', 'write', JSON.stringify({ file_path: '/tmp/fail.txt', content: 'x' })),
      toolResultEvent(2, 2000, {}, 'c1', { name: 'E', code: 'denied' }),
    ]
    expect(foldArtifactManifest(events)).toEqual(new Map())
  })

  it('非写工具（read）不记录', () => {
    const events = [
      toolCallEvent(1, 1000, 'c1', 'read', JSON.stringify({ path: '/tmp/a.txt' })),
      toolResultEvent(2, 2000, {}, 'c1'),
    ]
    expect(foldArtifactManifest(events)).toEqual(new Map())
  })
})

describe('workspace provenance 持久化', () => {
  it('merge 后能 read 回同一 manifest', () => {
    const dir = mkdtempSync(join(tmpdir(), 'prov-'))
    try {
      mergeWorkspaceManifest(dir, new Map([
        ['a.txt', { seq: 1, time: 1000 }],
        ['b.txt', { seq: 2, time: 2000 }],
      ]))
      const read = readWorkspaceManifest(dir)
      expect(read.get('a.txt')).toEqual({ seq: 1, time: 1000 })
      expect(read.get('b.txt')).toEqual({ seq: 2, time: 2000 })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('merge 两次时 time 大者胜出（跨 session 的 seq 不可比）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'prov-'))
    try {
      mergeWorkspaceManifest(dir, new Map([['a.txt', { seq: 100, time: 5000 }]]))
      mergeWorkspaceManifest(dir, new Map([['a.txt', { seq: 1, time: 6000 }]]))
      expect(readWorkspaceManifest(dir).get('a.txt')).toEqual({ seq: 1, time: 6000 })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('文件损坏时 read 返回空，不抛异常', () => {
    const dir = mkdtempSync(join(tmpdir(), 'prov-'))
    try {
      mkdirSync(join(dir, '.dsh'), { recursive: true })
      writeFileSync(join(dir, '.dsh', 'provenance.json'), 'not valid json')
      expect(readWorkspaceManifest(dir)).toEqual(new Map())
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('scanDirMtimes', () => {
  it('扫描目录返回文件 mtime，递归子目录', () => {
    const dir = mkdtempSync(join(tmpdir(), 'scan-'))
    try {
      writeFileSync(join(dir, 'a.txt'), 'x')
      mkdirSync(join(dir, 'sub'))
      writeFileSync(join(dir, 'sub', 'b.txt'), 'y')
      const out = new Map<string, number>()
      scanDirMtimes(dir, out)
      expect(out.has('a.txt')).toBe(true)
      expect(out.has('sub/b.txt')).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('缺失目录返回空，不抛异常', () => {
    const out = new Map<string, number>()
    scanDirMtimes('/nonexistent/dir/xyz', out)
    expect(out.size).toBe(0)
  })
})
