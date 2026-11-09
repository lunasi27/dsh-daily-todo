/**
 * dsh-daily-todo — 每日待办 · 宿主半。
 *
 * 这一半只负责三件事：
 *   1. 判断「今天是哪一天」（本机时区零点为界）；
 *   2. 跨日时把上一天整份清单归档，并把未完成项承接进新的一天；
 *   3. 把数据落到 $DSH_HOME/daily-todo/todos.json，并通过 /dsh-daily-todo/* 暴露给浏览器半。
 *
 * 浏览器半只负责画，不碰任何日期规则。
 */
import { randomBytes } from 'node:crypto'
import * as fs from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const name = 'dsh-daily-todo'
export const inject = ['webServer']

const ROUTE = '/dsh-daily-todo'
/** 2：条目增加了 cat（工作 / 生活），旧数据读入时补成 work。 */
const STORE_VERSION = 2
const CATEGORIES = Object.freeze(['work', 'life'])
/** 与用户确认过的口径：凌晨零点为一天的边界。 */
const DAY_START_HOUR = 0
const LIMITS = Object.freeze({
  text: 300,
  items: 300,
  archives: 240,
  archiveItems: 300,
  body: 64 * 1024,
})
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

// ---------------------------------------------------------------- 基础设施

function newId() {
  return randomBytes(6).toString('hex')
}

function resolveDshHome() {
  const raw = typeof process.env.DSH_HOME === 'string' ? process.env.DSH_HOME.trim() : ''
  return raw.length > 0 ? raw : join(homedir(), '.dsh')
}

function dayKey(ms) {
  const date = new Date(ms - DAY_START_HOUR * 3_600_000)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function badRequest(reason, message) {
  const error = new Error(message || reason)
  error.code = 'bad-request'
  error.reason = reason
  return error
}

// ---------------------------------------------------------------- 状态整形

function emptyState() {
  return { version: STORE_VERSION, list: null, archives: [] }
}

/** 分类只有两个固定值；未知值一律落到 work，保证旧数据与脏数据都能读。 */
function normalizeCategory(value) {
  return CATEGORIES.includes(value) ? value : 'work'
}

function normalizeItem(raw) {
  if (raw === null || typeof raw !== 'object') return null
  const text = typeof raw.text === 'string' ? raw.text.trim() : ''
  if (text.length === 0) return null
  const done = raw.done === true
  return {
    id: typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : newId(),
    text: text.slice(0, LIMITS.text),
    done,
    cat: normalizeCategory(raw.cat),
    createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now(),
    doneAt: done && Number.isFinite(raw.doneAt) ? raw.doneAt : null,
    carriedFrom: typeof raw.carriedFrom === 'string' && DAY_PATTERN.test(raw.carriedFrom) ? raw.carriedFrom : null,
  }
}

function normalizeItems(raw, limit) {
  if (!Array.isArray(raw)) return []
  const items = []
  for (const entry of raw) {
    const item = normalizeItem(entry)
    if (item) items.push(item)
    if (items.length >= limit) break
  }
  return items
}

/** 只信任结构，不信任内容：任何字段坏掉都退化成可用的空清单，而不是让整页崩掉。 */
function normalizeState(raw) {
  const state = emptyState()
  if (raw === null || typeof raw !== 'object') return state
  const list = raw.list
  if (
    list !== null && typeof list === 'object'
    && typeof list.day === 'string' && DAY_PATTERN.test(list.day)
  ) {
    state.list = { day: list.day, items: normalizeItems(list.items, LIMITS.items) }
  }
  if (Array.isArray(raw.archives)) {
    for (const entry of raw.archives) {
      if (entry === null || typeof entry !== 'object') continue
      if (typeof entry.day !== 'string' || !DAY_PATTERN.test(entry.day)) continue
      state.archives.push({
        id: typeof entry.id === 'string' && entry.id.length > 0 ? entry.id : newId(),
        day: entry.day,
        archivedAt: Number.isFinite(entry.archivedAt) ? entry.archivedAt : Date.now(),
        items: normalizeItems(entry.items, LIMITS.archiveItems),
      })
    }
    state.archives.sort((left, right) => right.archivedAt - left.archivedAt)
    if (state.archives.length > LIMITS.archives) state.archives.length = LIMITS.archives
  }
  return state
}

// ---------------------------------------------------------------- 跨日规则

/**
 * 把「已过去的那一天」冻结成归档快照，并让未完成项以新身份进入今天。
 *
 * - 归档快照保留当天全部条目（已完成 + 未完成），它是那一天的完整底账；
 * - 新的一天只承接未完成项，已完成项留在归档里；
 * - 只有日期向前走才触发；本机时钟往回拨时不动作，避免把清单反复吞掉。
 *
 * @returns {boolean} 是否真的滚动了（决定要不要落盘）
 */
function rollOver(state, now) {
  const today = dayKey(now)
  if (state.list === null) {
    state.list = { day: today, items: [] }
    return true
  }
  if (state.list.day >= today) return false

  const closed = state.list
  state.archives.unshift({
    id: newId(),
    day: closed.day,
    archivedAt: now,
    items: closed.items.map(item => ({ ...item })),
  })
  if (state.archives.length > LIMITS.archives) state.archives.length = LIMITS.archives

  const carried = []
  for (const item of closed.items) {
    if (item.done) continue
    carried.push({
      id: newId(),
      text: item.text.slice(0, LIMITS.text),
      done: false,
      cat: normalizeCategory(item.cat),
      createdAt: now,
      doneAt: null,
      carriedFrom: closed.day,
    })
    if (carried.length >= LIMITS.items) break
  }
  state.list = { day: today, items: carried }
  return true
}

// ---------------------------------------------------------------- 对外视图

function countDone(items) {
  let done = 0
  for (const item of items) if (item.done) done += 1
  return done
}

function toView(state) {
  const items = state.list.items
  return {
    today: state.list.day,
    items,
    stats: { total: items.length, done: countDone(items) },
    archives: state.archives.map(archive => ({
      id: archive.id,
      day: archive.day,
      archivedAt: archive.archivedAt,
      total: archive.items.length,
      done: countDone(archive.items),
    })),
  }
}

// ---------------------------------------------------------------- 存储

async function quarantine(file) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  await fs.rename(file, `${file}.corrupt-${stamp}.bak`)
}

function createStore(file) {
  let state = null
  let chain = Promise.resolve()

  const serialize = operation => {
    const run = chain.then(operation)
    chain = run.then(() => undefined, () => undefined)
    return run
  }

  async function load() {
    if (state) return state
    try {
      state = normalizeState(JSON.parse(await fs.readFile(file, 'utf8')))
    } catch (error) {
      if (error && error.code !== 'ENOENT') await quarantine(file).catch(() => {})
      state = normalizeState(null)
    }
    return state
  }

  async function save() {
    await fs.mkdir(dirname(file), { recursive: true })
    const temp = `${file}.${process.pid}.${Date.now()}.tmp`
    await fs.writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
    await fs.rename(temp, file)
  }

  /**
   * 所有读写都从这里进：先补完跨日规则，再执行操作，最后决定是否落盘。
   * operation 返回 true 表示改了东西；读操作返回 false。
   */
  function withState(operation) {
    return serialize(async () => {
      const current = await load()
      const rolled = rollOver(current, Date.now())
      const changed = operation(current, Date.now())
      if (rolled || changed === true) await save()
      return current
    })
  }

  return {
    read: () => withState(() => false),
    mutate: body => withState((current, now) => {
      if (body === null || typeof body !== 'object') throw badRequest('bad-body')
      const operation = MUTATIONS[body.op]
      if (typeof operation !== 'function') throw badRequest('unknown-op', `未知操作: ${String(body.op)}`)
      return operation(current, now, body)
    }),
  }
}

// ---------------------------------------------------------------- 写操作

function readText(value) {
  if (typeof value !== 'string') throw badRequest('bad-text', '任务内容必须是文本')
  const text = value.trim()
  if (text.length === 0) throw badRequest('empty-text', '任务内容不能为空')
  return text.slice(0, LIMITS.text)
}

function requireItem(state, id) {
  const item = state.list.items.find(entry => entry.id === id)
  if (!item) throw badRequest('not-found', '任务不存在，可能刚被删除')
  return item
}

const MUTATIONS = Object.freeze({
  add(state, now, body) {
    const text = readText(body.text)
    if (state.list.items.length >= LIMITS.items) throw badRequest('list-full', '今天的清单已经满了')
    state.list.items.push({
      id: newId(),
      text,
      done: false,
      cat: normalizeCategory(body.cat),
      createdAt: now,
      doneAt: null,
      carriedFrom: null,
    })
    return true
  },
  toggle(state, now, body) {
    const item = requireItem(state, body.id)
    item.done = !item.done
    item.doneAt = item.done ? now : null
    return true
  },
  edit(state, now, body) {
    const item = requireItem(state, body.id)
    item.text = readText(body.text)
    return true
  },
  delete(state, _now, body) {
    const index = state.list.items.findIndex(entry => entry.id === body.id)
    if (index < 0) throw badRequest('not-found', '任务不存在，可能刚被删除')
    state.list.items.splice(index, 1)
    return true
  },
  /**
   * 换分类。清单是扁平数组、分组靠过滤得出，所以「挪到目标组末尾」= 从原位置摘出来再追加到数组尾部。
   * 完成状态、创建时间、承接来源都保持不变。
   */
  move(state, _now, body) {
    const item = requireItem(state, body.id)
    const cat = normalizeCategory(body.cat)
    if (normalizeCategory(item.cat) === cat) return false
    item.cat = cat
    const index = state.list.items.indexOf(item)
    state.list.items.splice(index, 1)
    state.list.items.push(item)
    return true
  },
})

// ---------------------------------------------------------------- HTTP

function sendJson(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8')
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(body.length),
    'cache-control': 'no-store',
  })
  res.end(body)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', chunk => {
      size += chunk.length
      if (size > LIMITS.body) {
        reject(badRequest('body-too-large', '请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function createHandler(store) {
  return async function handle(req, res) {
    const method = String(req.method || 'GET').toUpperCase()
    try {
      const url = new URL(String(req.url || '/'), 'http://localhost')
      if (!url.pathname.startsWith(ROUTE)) {
        sendJson(res, 404, { ok: false, error: { code: 'not-found' } })
        return
      }
      const tail = url.pathname.slice(ROUTE.length)

      if (tail === '/state') {
        if (method !== 'GET') {
          sendJson(res, 405, { ok: false, error: { code: 'method-not-allowed' } })
          return
        }
        const state = await store.read()
        sendJson(res, 200, { ok: true, data: toView(state) })
        return
      }

      if (tail === '/mutate') {
        if (method !== 'POST') {
          sendJson(res, 405, { ok: false, error: { code: 'method-not-allowed' } })
          return
        }
        const raw = await readBody(req)
        let body
        try {
          body = JSON.parse(raw)
        } catch {
          throw badRequest('bad-json', '请求体不是合法 JSON')
        }
        const state = await store.mutate(body)
        sendJson(res, 200, { ok: true, data: toView(state) })
        return
      }

      if (tail === '/archive') {
        if (method !== 'GET') {
          sendJson(res, 405, { ok: false, error: { code: 'method-not-allowed' } })
          return
        }
        const id = url.searchParams.get('id') || ''
        const state = await store.read()
        const archive = state.archives.find(entry => entry.id === id)
        if (!archive) {
          sendJson(res, 404, { ok: false, error: { code: 'not-found', message: '这份归档不存在' } })
          return
        }
        sendJson(res, 200, {
          ok: true,
          data: {
            id: archive.id,
            day: archive.day,
            archivedAt: archive.archivedAt,
            items: archive.items,
          },
        })
        return
      }

      sendJson(res, 404, { ok: false, error: { code: 'not-found' } })
    } catch (error) {
      if (error && error.code === 'bad-request') {
        sendJson(res, 400, {
          ok: false,
          error: { code: error.reason || 'bad-request', message: error.message },
        })
        return
      }
      sendJson(res, 500, {
        ok: false,
        error: { code: 'internal-error', message: String((error && error.message) || error) },
      })
    }
  }
}

// ---------------------------------------------------------------- 插件入口

export function apply(ctx) {
  const file = join(resolveDshHome(), 'daily-todo', 'todos.json')
  const store = createStore(file)
  const handle = createHandler(store)
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: ROUTE,
    handler: handle,
  }))
}
