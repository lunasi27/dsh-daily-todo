/**
 * dsh-daily-todo — 每日待办 · 浏览器半。
 *
 * 两处注册：
 *   - sidebar.panellist：左侧图标栏里的一枚清单图标（id = daily-todo）；
 *   - main（key = daily-todo）：中央主区里的整页。
 *
 * 页面按「工作 / 生活」两段展示；日期规则与分类校验都在宿主半，这里只负责画。
 */
window.__ModuleLoader__.load({
  id: 'dsh-daily-todo',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useRef, useState } = React

    const API = '/dsh-daily-todo'
    const NS = 'daily-todo'
    const PANEL_ID = 'daily-todo'
    /** 固定在侧栏与页头显示的中文名，不随 Harness 界面语言切换。 */
    const PANEL_NAME = '每日待办'
    const CATS = ['work', 'life']
    const LAST_CAT_KEY = 'dsh-daily-todo:last-category'

    // ------------------------------------------------------------ 文案

    const DICTS = {
      'zh-CN': {
        tabToday: '今天',
        tabArchive: '归档',
        addPlaceholder: '添加一条{cat}待办，回车保存',
        catGroupLabel: '新条目归到哪一类',
        catWork: '工作',
        catLife: '生活',
        progress: '{done} / {total} 已完成',
        emptyWork: '工作这边还空着。',
        emptyLife: '生活这边还空着。',
        emptyArchiveTitle: '还没有归档。',
        emptyArchiveHint: '每天零点，当天的清单会自动归档；没做完的会带进新的一天。',
        carried: '承接',
        moveLabel: '挪到「{other}」',
        deleteLabel: '删除这条待办',
        toggleLabel: '切换完成状态',
        editLabel: '点击可修改内容',
        archiveStats: '完成 {done} / {total}',
        archiveAt: '{time} 归档',
        archiveLoading: '正在读取这份归档…',
        loading: '正在读取今天的清单…',
        loadFailed: '读取清单失败，请刷新页面重试。',
        saveFailed: '保存失败：{message}',
        allDone: '今天的都做完了。',
      },
      en: {
        tabToday: 'Today',
        tabArchive: 'Archive',
        addPlaceholder: 'Add a {cat} task, press Enter to save',
        catGroupLabel: 'Category for new tasks',
        catWork: 'Work',
        catLife: 'Life',
        progress: '{done} of {total} done',
        emptyWork: 'Nothing in Work yet.',
        emptyLife: 'Nothing in Life yet.',
        emptyArchiveTitle: 'No archives yet.',
        emptyArchiveHint: 'Every day at midnight the list is archived; unfinished tasks move to the new day.',
        carried: 'Carried',
        moveLabel: 'Move to {other}',
        deleteLabel: 'Delete this task',
        toggleLabel: 'Toggle completion',
        editLabel: 'Click to edit',
        archiveStats: '{done} of {total} done',
        archiveAt: 'archived {time}',
        archiveLoading: 'Loading this archive…',
        loading: 'Loading today’s list…',
        loadFailed: 'Could not load the list. Refresh the page and retry.',
        saveFailed: 'Could not save: {message}',
        allDone: 'Everything on today’s list is done.',
      },
    }

    let translate = key => key
    let getLocaleId = () => 'zh-CN'

    function pick(locale) {
      return String(locale || '').toLowerCase().startsWith('zh') ? DICTS['zh-CN'] : DICTS.en
    }

    function bindTranslate(ctx) {
      const locale = ctx.locale
      if (!locale) {
        translate = key => DICTS['zh-CN'][key] ?? key
        return
      }
      try {
        for (const [id, dict] of Object.entries(DICTS)) {
          try { locale.register(NS, id, dict) } catch { /* 该 locale 由宿主决定，注册不上就退回内置字典 */ }
        }
        const bound = locale.bind(NS)
        getLocaleId = () => {
          try {
            const snapshot = locale.getLocale()
            if (snapshot && typeof snapshot.id === 'string') return snapshot.id
          } catch { /* 读不到就用后备 */ }
          return 'zh-CN'
        }
        translate = key => {
          try {
            const value = bound(key)
            if (typeof value === 'string' && value !== key) return value
          } catch { /* 绑定失效时退回内置字典 */ }
          const fallback = pick(getLocaleId())[key] ?? DICTS['zh-CN'][key]
          return fallback ?? key
        }
      } catch {
        translate = key => DICTS['zh-CN'][key] ?? key
      }
    }

    function t(key) {
      return translate(key)
    }

    function fill(text, values) {
      let out = text
      for (const [name, value] of Object.entries(values)) out = out.split(`{${name}}`).join(String(value))
      return out
    }

    // ------------------------------------------------------------ 分类

    function catKey(cat) {
      return cat === 'life' ? 'catLife' : 'catWork'
    }

    function otherCat(cat) {
      return cat === 'life' ? 'work' : 'life'
    }

    function itemCat(item) {
      return item && item.cat === 'life' ? 'life' : 'work'
    }

    function countDone(items) {
      let done = 0
      for (const item of items) if (item.done) done += 1
      return done
    }

    function readLastCat() {
      try {
        return window.localStorage.getItem(LAST_CAT_KEY) === 'life' ? 'life' : 'work'
      } catch {
        return 'work'
      }
    }

    function writeLastCat(cat) {
      try { window.localStorage.setItem(LAST_CAT_KEY, cat) } catch { /* 存不了就只在本页有效 */ }
    }

    // ------------------------------------------------------------ 日期显示

    function isZh() {
      return String(getLocaleId()).toLowerCase().startsWith('zh')
    }

    function parseDay(day) {
      const parts = String(day).split('-')
      if (parts.length !== 3) return null
      const date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]))
      return Number.isNaN(date.getTime()) ? null : date
    }

    function formatDay(day) {
      const date = parseDay(day)
      if (!date) return String(day)
      try {
        return date.toLocaleDateString(isZh() ? 'zh-CN' : 'en-US', {
          month: 'long',
          day: 'numeric',
          weekday: 'long',
        })
      } catch {
        return String(day)
      }
    }

    function shortDay(day) {
      return String(day).slice(5)
    }

    function formatTime(ms) {
      try {
        return new Date(ms).toLocaleTimeString(isZh() ? 'zh-CN' : 'en-US', {
          hour: '2-digit',
          minute: '2-digit',
        })
      } catch {
        return ''
      }
    }

    // ------------------------------------------------------------ 请求

    async function request(path, body) {
      const init = body === undefined
        ? { headers: { accept: 'application/json' } }
        : {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify(body),
          }
      const response = await fetch(API + path, init)
      let payload = null
      try { payload = await response.json() } catch { payload = null }
      if (!response.ok || payload === null || payload.ok !== true) {
        const message = payload && payload.error && payload.error.message
        throw new Error(message || `HTTP ${response.status}`)
      }
      return payload.data
    }

    // ------------------------------------------------------------ 图标

    function TodoIcon(ownerProps) {
      const size = ownerProps && Number.isFinite(ownerProps.size) ? ownerProps.size : 20
      const glyph = 'M6.3 6.7l1.5 1.5 2.7-2.8'
      const glyph2 = 'M6.3 11.7l1.5 1.5 2.7-2.8'
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 20 20',
          fill: 'none',
          'aria-hidden': 'true',
          focusable: 'false',
          style: { display: 'block' },
        },
        h('rect', {
          x: 2.85,
          y: 2.35,
          width: 14.3,
          height: 15.3,
          rx: 3.1,
          stroke: 'currentColor',
          strokeWidth: 1.5,
          opacity: ownerProps && ownerProps.active ? 1 : 0.92,
        }),
        h('path', { d: glyph, stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }),
        h('path', { d: glyph2, stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }),
        h('path', { d: 'M12 7.5h1.95M12 12.5h1.95', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' }),
      )
    }

    // ------------------------------------------------------------ 样式

    const STYLES = [
      '.dtd-page{display:flex;flex-direction:column;box-sizing:border-box;height:100%;min-height:100%;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:15px;line-height:1.6}',
      '.dtd-page *{box-sizing:border-box}',
      '.dtd-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:26px 32px 14px}',
      '.dtd-title{margin:0;font-size:20px;font-weight:600;letter-spacing:.2px}',
      '.dtd-meta{margin:5px 0 0;font-size:13px;color:var(--dsw-alias-label-secondary)}',
      '.dtd-tabs{display:flex;gap:2px;padding:3px;border-radius:10px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 7%,transparent)}',
      '.dtd-tab{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13.5px;padding:5px 13px;border-radius:8px;cursor:pointer;white-space:nowrap}',
      '.dtd-tab[aria-selected="true"]{background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);box-shadow:0 1px 2px color-mix(in srgb,var(--dsw-alias-label-primary) 18%,transparent)}',
      '.dtd-tab:focus-visible,.dtd-add-input:focus-visible,.dtd-cat-btn:focus-visible,.dtd-row-text:focus-visible,.dtd-archive-head:focus-visible,.dtd-move:focus-visible,.dtd-delete:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}',
      '.dtd-track{margin:0 32px;height:3px;border-radius:99px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 11%,transparent);overflow:hidden}',
      '.dtd-fill{display:block;height:100%;border-radius:99px;background:var(--dsw-alias-brand-primary);transition:width .22s ease}',
      '.dtd-body{flex:1;min-height:0;overflow-y:auto;padding:18px 32px 44px}',
      '.dtd-inner{max-width:760px;margin:0 auto}',
      '.dtd-add{display:flex;align-items:center;gap:10px;margin:0 auto 16px}',
      '.dtd-add-cat{display:flex;gap:2px;padding:3px;border-radius:9px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 7%,transparent);flex:0 0 auto}',
      '.dtd-cat-btn{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13.5px;padding:4px 11px;border-radius:7px;cursor:pointer;white-space:nowrap}',
      '.dtd-cat-btn[aria-pressed="true"]{background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);box-shadow:0 1px 2px color-mix(in srgb,var(--dsw-alias-label-primary) 18%,transparent)}',
      '.dtd-add-input{flex:1;min-width:0;height:40px;padding:0 14px;border-radius:10px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);color:inherit;font:inherit;outline:none}',
      '.dtd-add-input::placeholder{color:var(--dsw-alias-label-secondary);opacity:.85}',
      '.dtd-add-input:focus{border-color:var(--dsw-alias-brand-primary)}',
      '.dtd-groups{display:flex;flex-direction:column;gap:12px}',
      '.dtd-group{background:color-mix(in srgb,var(--dsw-alias-label-primary) 3.5%,transparent);border-radius:12px;padding:10px 12px 12px}',
      '.dtd-group-head{display:flex;align-items:center;gap:8px;padding:0 4px 6px}',
      '.dtd-dot{flex:0 0 auto;width:7px;height:7px;border-radius:99px}',
      '.dtd-dot[data-cat="work"]{background:var(--dsw-alias-brand-primary)}',
      '.dtd-dot[data-cat="life"]{background:var(--dsw-alias-state-success-primary)}',
      '.dtd-group-name{font-size:14px;font-weight:600;letter-spacing:.2px}',
      '.dtd-group-count{font-size:13px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}',
      '.dtd-group-empty{margin:2px 4px 4px;font-size:13.5px;color:var(--dsw-alias-label-secondary);opacity:.8}',
      '.dtd-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column}',
      '.dtd-row{display:flex;align-items:flex-start;gap:10px;padding:10px;border-radius:9px}',
      '.dtd-row:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 6%,transparent)}',
      '.dtd-check{flex:0 0 auto;width:17px;height:17px;margin:4px 0 0;accent-color:var(--dsw-alias-brand-primary);cursor:pointer}',
      '.dtd-row-text{flex:1;min-width:0;display:flex;align-items:baseline;gap:8px;text-align:left;background:none;border:0;padding:0;font:inherit;color:inherit;cursor:text;overflow-wrap:anywhere}',
      '.dtd-row-done{color:var(--dsw-alias-label-secondary);opacity:.6}',
      '.dtd-row-done .dtd-row-label{text-decoration:line-through;text-decoration-thickness:1.5px}',
      '.dtd-edit{flex:1;min-width:0;height:30px;padding:0 8px;border-radius:7px;border:1px solid var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-base);color:inherit;font:inherit;outline:none}',
      '.dtd-move,.dtd-delete{flex:0 0 auto;width:26px;height:26px;display:flex;align-items:center;justify-content:center;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:15px;line-height:1;cursor:pointer;opacity:0;transition:opacity .12s}',
      '.dtd-delete{font-size:17px}',
      '.dtd-row:hover .dtd-move,.dtd-row:hover .dtd-delete,.dtd-move:focus-visible,.dtd-delete:focus-visible{opacity:1}',
      '.dtd-move:hover{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 14%,transparent);color:var(--dsw-alias-brand-primary)}',
      '.dtd-delete:hover{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 14%,transparent);color:var(--dsw-alias-state-error-primary)}',
      '.dtd-tag{flex:0 0 auto;font-size:11.5px;line-height:1.7;padding:0 6px;border-radius:99px;color:var(--dsw-alias-label-secondary);background:color-mix(in srgb,var(--dsw-alias-label-primary) 9%,transparent)}',
      '.dtd-empty{margin:6px 0 0;font-size:14px;color:var(--dsw-alias-label-secondary)}',
      '.dtd-empty-hint{margin:6px 0 0;font-size:13.5px;color:var(--dsw-alias-label-secondary);opacity:.85}',
      '.dtd-error{margin:14px 0 0;font-size:13.5px;color:var(--dsw-alias-state-error-primary)}',
      '.dtd-archive-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}',
      '.dtd-archive-item{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;overflow:hidden}',
      '.dtd-archive-head{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;padding:11px 14px;border:0;background:transparent;font:inherit;color:inherit;cursor:pointer;text-align:left}',
      '.dtd-archive-head:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 4%,transparent)}',
      '.dtd-archive-day{font-weight:500}',
      '.dtd-archive-stats{font-size:13px;color:var(--dsw-alias-label-secondary)}',
      '.dtd-archive-groups{padding:2px 14px 12px;border-top:1px solid var(--dsw-alias-border-l1)}',
      '.dtd-archive-group{padding-top:8px}',
      '.dtd-archive-group-head{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;padding:2px 0 4px}',
      '.dtd-archive-body{list-style:none;margin:0;padding:0}',
      '.dtd-archive-row{display:flex;gap:8px;align-items:baseline;padding:4px 0;font-size:14px}',
      '.dtd-archive-mark{flex:0 0 auto;width:17px;color:var(--dsw-alias-label-secondary)}',
      '.dtd-archive-done{color:var(--dsw-alias-label-secondary);text-decoration:line-through}',
      '.dtd-archive-note{padding:8px 0 2px;font-size:13px;color:var(--dsw-alias-label-secondary)}',
    ].join('\n')

    // ------------------------------------------------------------ 主页面

    function TodoPage() {
      const [snapshot, setSnapshot] = useState(null)
      const [error, setError] = useState('')
      const [draft, setDraft] = useState('')
      const [activeCat, setActiveCat] = useState(readLastCat)
      const [tab, setTab] = useState('today')
      const [editing, setEditing] = useState(null)
      const [detail, setDetail] = useState(null)
      const [detailLoading, setDetailLoading] = useState(false)
      const skipBlur = useRef(false)
      const editingRef = useRef(null)
      editingRef.current = editing

      const refresh = useCallback(async () => {
        try {
          setSnapshot(await request('/state'))
          setError('')
        } catch {
          setError(t('loadFailed'))
        }
      }, [])

      useEffect(() => {
        refresh()
        const timer = window.setInterval(refresh, 60_000)
        const onFocus = () => { refresh() }
        window.addEventListener('focus', onFocus)
        document.addEventListener('visibilitychange', onFocus)
        return () => {
          window.clearInterval(timer)
          window.removeEventListener('focus', onFocus)
          document.removeEventListener('visibilitychange', onFocus)
        }
      }, [refresh])

      const mutate = useCallback(async (op, extra) => {
        try {
          const next = await request('/mutate', { op, ...extra })
          setSnapshot(next)
          setError('')
          return next
        } catch (cause) {
          const message = cause && cause.message ? cause.message : String(cause)
          setError(fill(t('saveFailed'), { message }))
          return null
        }
      }, [])

      function chooseCat(cat) {
        setActiveCat(cat)
        writeLastCat(cat)
      }

      const items = snapshot ? snapshot.items : []
      const stats = snapshot ? snapshot.stats : { total: 0, done: 0 }
      const percent = stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0
      const archives = snapshot ? snapshot.archives : []

      function submit(event) {
        event.preventDefault()
        const text = draft.trim()
        if (text.length === 0) return
        setDraft('')
        mutate('add', { text, cat: activeCat })
      }

      function beginEdit(item) {
        skipBlur.current = false
        setEditing({ id: item.id, text: item.text })
      }

      function saveEdit(item, text) {
        skipBlur.current = true
        setEditing(null)
        const next = String(text || '').trim()
        if (next.length === 0 || next === item.text) return
        mutate('edit', { id: item.id, text: next })
      }

      function onEditKey(event) {
        if (event.key === 'Enter') {
          event.preventDefault()
          const current = editingRef.current
          if (current) saveEdit({ id: current.id, text: current.text }, current.text)
        } else if (event.key === 'Escape') {
          event.preventDefault()
          skipBlur.current = true
          setEditing(null)
        }
      }

      function onEditBlur(item) {
        if (skipBlur.current) {
          skipBlur.current = false
          return
        }
        const current = editingRef.current
        if (!current || current.id !== item.id) return
        saveEdit({ id: item.id, text: item.text }, current.text)
      }

      async function openArchive(id) {
        if (detail && detail.id === id) {
          setDetail(null)
          return
        }
        setDetailLoading(true)
        setDetail({ id })
        try {
          const archive = await request(`/archive?id=${encodeURIComponent(id)}`)
          setDetail(archive)
        } catch {
          setDetail({ id, failed: true, items: [] })
        } finally {
          setDetailLoading(false)
        }
      }

      function row(item) {
        const isEditing = editing !== null && editing.id === item.id
        const cat = itemCat(item)
        const target = otherCat(cat)
        const moveLabel = fill(t('moveLabel'), { other: t(catKey(target)) })
        return h(
          'li',
          { key: item.id, className: `dtd-row${item.done ? ' dtd-row-done' : ''}` },
          h('input', {
            className: 'dtd-check',
            type: 'checkbox',
            checked: item.done,
            'aria-label': `${t('toggleLabel')}: ${item.text}`,
            onChange: () => mutate('toggle', { id: item.id }),
          }),
          isEditing
            ? h('input', {
                className: 'dtd-edit',
                value: editing.text,
                autoFocus: true,
                'aria-label': t('editLabel'),
                onChange: event => setEditing({ id: item.id, text: event.target.value }),
                onKeyDown: onEditKey,
                onBlur: () => onEditBlur(item),
              })
            : h(
                'button',
                {
                  type: 'button',
                  className: 'dtd-row-text',
                  title: t('editLabel'),
                  onClick: () => beginEdit(item),
                },
                h('span', { className: 'dtd-row-label' }, item.text),
                item.carriedFrom
                  ? h('span', { className: 'dtd-tag' }, `${t('carried')} ${shortDay(item.carriedFrom)}`)
                  : null,
              ),
          h(
            'button',
            {
              type: 'button',
              className: 'dtd-move',
              title: moveLabel,
              'aria-label': moveLabel,
              onClick: () => mutate('move', { id: item.id, cat: target }),
            },
            '↔',
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'dtd-delete',
              title: t('deleteLabel'),
              'aria-label': t('deleteLabel'),
              onClick: () => mutate('delete', { id: item.id }),
            },
            '×',
          ),
        )
      }

      function groupSection(cat, list) {
        const done = countDone(list)
        return h(
          'section',
          { key: cat, className: 'dtd-group', 'aria-label': t(catKey(cat)) },
          h(
            'div',
            { className: 'dtd-group-head' },
            h('span', { className: 'dtd-dot', 'data-cat': cat, 'aria-hidden': 'true' }),
            h('span', { className: 'dtd-group-name' }, t(catKey(cat))),
            h('span', { className: 'dtd-group-count' }, `${done} / ${list.length}`),
          ),
          list.length > 0
            ? h('ul', { className: 'dtd-list' }, list.map(row))
            : h('p', { className: 'dtd-group-empty' }, t(cat === 'life' ? 'emptyLife' : 'emptyWork')),
        )
      }

      const header = h(
        'header',
        { className: 'dtd-head' },
        h(
          'div',
          null,
          h('h1', { className: 'dtd-title' }, PANEL_NAME),
          h(
            'p',
            { className: 'dtd-meta' },
            snapshot ? formatDay(snapshot.today) : '',
            snapshot ? ` · ${fill(t('progress'), { done: stats.done, total: stats.total })}` : '',
          ),
        ),
        h(
          'div',
          { className: 'dtd-tabs', role: 'tablist' },
          h(
            'button',
            {
              type: 'button',
              role: 'tab',
              className: 'dtd-tab',
              'aria-selected': tab === 'today',
              onClick: () => setTab('today'),
            },
            t('tabToday'),
          ),
          h(
            'button',
            {
              type: 'button',
              role: 'tab',
              className: 'dtd-tab',
              'aria-selected': tab === 'archive',
              onClick: () => setTab('archive'),
            },
            archives.length > 0 ? `${t('tabArchive')} ${archives.length}` : t('tabArchive'),
          ),
        ),
      )

      const progress = h(
        'div',
        { className: 'dtd-track', role: 'presentation' },
        h('span', { className: 'dtd-fill', style: { width: `${percent}%` } }),
      )

      const addBar = h(
        'form',
        { className: 'dtd-add', onSubmit: submit },
        h(
          'div',
          { className: 'dtd-add-cat', role: 'group', 'aria-label': t('catGroupLabel') },
          CATS.map(cat =>
            h(
              'button',
              {
                key: cat,
                type: 'button',
                className: 'dtd-cat-btn',
                'aria-pressed': activeCat === cat,
                onClick: () => chooseCat(cat),
              },
              t(catKey(cat)),
            ),
          ),
        ),
        h('input', {
          className: 'dtd-add-input',
          value: draft,
          placeholder: fill(t('addPlaceholder'), { cat: t(catKey(activeCat)) }),
          'aria-label': fill(t('addPlaceholder'), { cat: t(catKey(activeCat)) }),
          onChange: event => setDraft(event.target.value),
        }),
      )

      const todayBody = h(
        'div',
        { className: 'dtd-body' },
        h(
          'div',
          { className: 'dtd-inner' },
          addBar,
          h('div', { className: 'dtd-groups' }, CATS.map(cat => groupSection(cat, items.filter(item => itemCat(item) === cat)))),
          items.length > 0 && stats.done === stats.total
            ? h('p', { className: 'dtd-empty-hint' }, t('allDone'))
            : null,
          error ? h('p', { className: 'dtd-error' }, error) : null,
        ),
      )

      function archiveGroups(entries) {
        return CATS.map(cat => {
          const list = entries.filter(entry => itemCat(entry) === cat)
          if (list.length === 0) return null
          return h(
            'div',
            { key: cat, className: 'dtd-archive-group' },
            h(
              'div',
              { className: 'dtd-archive-group-head' },
              h('span', { className: 'dtd-dot', 'data-cat': cat, 'aria-hidden': 'true' }),
              h('span', null, t(catKey(cat))),
              h('span', { className: 'dtd-archive-stats' }, `${countDone(list)} / ${list.length}`),
            ),
            h(
              'ul',
              { className: 'dtd-archive-body' },
              list.map(entry =>
                h(
                  'li',
                  { key: entry.id, className: `dtd-archive-row${entry.done ? ' dtd-archive-done' : ''}` },
                  h('span', { className: 'dtd-archive-mark' }, entry.done ? '☑' : '☐'),
                  h('span', null, entry.text),
                ),
              ),
            ),
          )
        }).filter(Boolean)
      }

      function archiveSection(entry) {
        const isOpen = detail !== null && detail.id === entry.id
        return h(
          'li',
          { key: entry.id, className: 'dtd-archive-item' },
          h(
            'button',
            {
              type: 'button',
              className: 'dtd-archive-head',
              'aria-expanded': isOpen,
              onClick: () => openArchive(entry.id),
            },
            h('span', { className: 'dtd-archive-day' }, formatDay(entry.day)),
            h(
              'span',
              { className: 'dtd-archive-stats' },
              `${fill(t('archiveStats'), { done: entry.done, total: entry.total })} · ${fill(t('archiveAt'), { time: formatTime(entry.archivedAt) })}`,
            ),
          ),
          isOpen
            ? h(
                'div',
                { className: 'dtd-archive-groups' },
                detailLoading
                  ? h('p', { className: 'dtd-archive-note' }, t('archiveLoading'))
                  : null,
                detail && detail.id === entry.id && Array.isArray(detail.items) && !detailLoading
                  ? archiveGroups(detail.items)
                  : null,
              )
            : null,
        )
      }

      const archiveBody = h(
        'div',
        { className: 'dtd-body' },
        h(
          'div',
          { className: 'dtd-inner' },
          archives.length > 0
            ? h('ul', { className: 'dtd-archive-list' }, archives.map(archiveSection))
            : h(
                'div',
                null,
                h('p', { className: 'dtd-empty' }, t('emptyArchiveTitle')),
                h('p', { className: 'dtd-empty-hint' }, t('emptyArchiveHint')),
              ),
        ),
      )

      return h(
        'div',
        { className: 'dtd-page' },
        h('style', null, STYLES),
        header,
        progress,
        snapshot === null
          ? h('div', { className: 'dtd-body' },
              h('div', { className: 'dtd-inner' },
                h('p', { className: 'dtd-empty' }, error || t('loading')),
              ))
          : tab === 'today' ? todayBody : archiveBody,
      )
    }

    // ------------------------------------------------------------ 插件入口

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        bindTranslate(ctx)
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: 20,
          label: PANEL_NAME,
        }, TodoIcon))
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
        }, TodoPage))
      },
    }
  },
})
