/// <reference path="./types.d.ts" />
/// <reference path="./cses.d.ts" />

import protocol from './protocol.json'

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

const DEFAULT_SETTING = {
  timeOffset: 0
}

const STORAGE_KEY = 'configCache'
const PROTOCOL_VERSION = protocol.version

/**
 * 创建一个空的每日课程表结构
 * @returns {Day}
 */
function createEmptyDay() {
  return { pattern: -1, lessons: [] }
}

/**
 * 创建一个空的周课程表结构
 * @returns {Schedule}
 */
function createEmptySchedule() {
  return { mon: createEmptyDay(), tue: createEmptyDay(), wed: createEmptyDay(), thu: createEmptyDay(), fri: createEmptyDay(), sat: createEmptyDay(), sun: createEmptyDay() }
}

/**
 * 课程表引擎核心状态
 * @typedef {Object} EngineState
 * @property {{ timeOffset: number }} setting - 引擎设置
 * @property {boolean} inited - 是否已完成初始化
 * @property {Week|string} today - 今天是星期几
 * @property {Pattern[]} patterns - 时间模式列表
 * @property {Schedule[]} schedule - 所有课程表
 * @property {string} firstWeekMonday - 第一周周一的日期（YYYY-MM-DD）
 * @property {number} currentScheduleId - 当前使用的课程表索引
 * @property {{ date: string, override: string[] }} scheduleOverride - 当日课程临时覆盖配置
 * @property {any} _todayTimer - 日期更新定时器
 * @property {any} _activeTimer - 课程状态刷新定时器
 * @property {Array<() => void>} _listeners - 配置更新监听器
 */

/** @type {EngineState} */
const engine = {
  setting: { ...DEFAULT_SETTING },
  inited: false,
  today: '',
  patterns: [],
  schedule: [],
  firstWeekMonday: '',
  currentScheduleId: 0,
  scheduleOverride: { date: '1970-01-01', override: [] },

  _todayTimer: null,
  _activeTimer: null,
  _listeners: []
}

/**
 * 获取今天是星期几
 * @returns {Week}
 */
function getToday() {
  return WEEKDAYS[new Date().getDay()]
}

/**
 * 将日期格式化为 YYYY-MM-DD
 * @param {Date} [d]
 * @returns {string}
 */
function formatDate(d) {
  const date = d || new Date()
  return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0')
}

/**
 * 获取指定日期所在周的周一
 * @param {Date|string} date
 * @returns {Date}
 */
function getMonday(date) {
  const d = new Date(date)
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1)
  d.setDate(diff)
  d.setHours(0, 0, 0, 0)
  return d
}

/**
 * 计算两个日期之间相差的周数
 * @param {string} d1
 * @param {string} d2
 * @returns {number}
 */
function getWeekDiff(d1, d2) {
  const a = getMonday(new Date(d1))
  const b = getMonday(new Date(d2))
  return Math.round((a - b) / (7 * 24 * 60 * 60 * 1000))
}

/**
 * 获取当前时间加上偏移后的分钟数
 * @param {number} offset
 * @returns {number}
 */
function getMinutesNow(offset) {
  const now = new Date()
  return (now.getHours() * 60 + now.getMinutes()) + (offset / 60)
}

/**
 * 判断某节课的当前状态
 * @param {string} time - 课程时间范围，例如 "08:00-09:00"
 * @param {string|null} lastTime - 上一节课的时间范围
 * @param {number} timeOffset - 时间偏移量（秒）
 * @returns {0 | 1 | 2} 0:不是当前课程，1:当前为课间/下一节是该课程，2:是当前课程
 */
function isActiveTime(time, lastTime, timeOffset) {
  const nowTime = getMinutesNow(timeOffset)
  const rex = /^(\d{1,2})[：:](\d{1,2})[-~ ]+(\d{1,2})[：:](\d{1,2})$/
  const res = rex.exec(time)
  const resLast = lastTime ? rex.exec(lastTime) : null
  if (!res) return 0
  const start = parseInt(res[1]) * 60 + parseInt(res[2])
  const end = parseInt(res[3]) * 60 + parseInt(res[4])
  let flag = 0
  if (start < end) {
    flag = (nowTime >= start && nowTime < end) ? 2 : 0
  } else {
    flag = (nowTime >= start || nowTime < end) ? 2 : 0
  }
  if (flag === 0) {
    if (resLast) {
      if (time === lastTime) {
        if (nowTime < end) flag = 1
      } else {
        const lastEnd = parseInt(resLast[3]) * 60 + parseInt(resLast[4])
        if (nowTime >= lastEnd && nowTime < start) flag = 1
      }
    } else {
      // 没有上一节课时，当前时间早于本节课开始即视为"下一节"
      if (nowTime < start) flag = 1
    }
  }
  return flag
}

/**
 * 获取今日课程列表，并应用临时覆盖
 * @param {Schedule[]} schedule
 * @param {number} scheduleId
 * @param {Week} today
 * @param {{ date: string, override: string[] }} override
 * @returns {Lesson[]}
 */
function getScheduleToday(schedule, scheduleId, today, override) {
  const daySchedule = schedule[scheduleId]
  if (!daySchedule || !daySchedule[today]) return []
  if (override.date === formatDate()) {
    return daySchedule[today].lessons.map((lesson, i) => {
      const l = { ...lesson }
      if (override.override && override.override[i]) {
        l.name = override.override[i]
      }
      return l
    })
  }
  return daySchedule[today].lessons
}

/**
 * 获取倒计时文本
 * @param {Lesson[]} lessons
 * @param {number} timeOffset
 * @returns {string}
 */
function getCountdownText(lessons, timeOffset) {
  const nowTime = getMinutesNow(timeOffset)
  const rex = /^(\d{1,2})[：:](\d{1,2})[-~ ]+(\d{1,2})[：:](\d{1,2})$/
  for (let i = 0; i < lessons.length; i++) {
    const active = lessons[i].active || 0
    if (active === 2) {
      const m = rex.exec(lessons[i].time)
      if (m) {
        const end = parseInt(m[3]) * 60 + parseInt(m[4])
        let remain = end - nowTime
        if (remain < 0) remain += 1440
        if (remain <= 0) return ''
        return lessons[i].name + '\n还剩' + remain + '分钟'
      }
    }
  }
  for (let i = 0; i < lessons.length; i++) {
    const active = lessons[i].active || 0
    if (active === 1) {
      const m = rex.exec(lessons[i].time)
      if (m) {
        const start = parseInt(m[1]) * 60 + parseInt(m[2])
        let remain = start - nowTime
        if (remain < 0) remain += 1440
        if (remain <= 0) return ''
        return '课间休息\n还剩' + remain + '分钟'
      }
    }
  }
  return '当前没有课程'
}

/**
 * 刷新今日课程的高亮状态
 * @returns {void}
 */
function refreshActiveState() {
  const todayLessons = getScheduleToday(engine.schedule, engine.currentScheduleId, engine.today, engine.scheduleOverride)
  const scheduleDay = engine.schedule[engine.currentScheduleId]
  if (!scheduleDay || !scheduleDay[engine.today]) return
  // 前向追踪上一节非分隔课程，避免第 0 项为分隔符时误用其时间作为"上一节课"
  let lastLessonIdx = -1
  for (let i = 0; i < todayLessons.length; i++) {
    if (todayLessons[i].isDivider) continue
    const lastTime = lastLessonIdx >= 0 ? todayLessons[lastLessonIdx].time : null
    scheduleDay[engine.today].lessons[i].active = isActiveTime(todayLessons[i].time, lastTime, engine.setting.timeOffset)
    lastLessonIdx = i
  }
}

/**
 * 根据第一周周一日期计算当前应使用的课程表索引
 * @param {string} firstWeekMonday
 * @param {number} scheduleLength
 * @returns {number}
 */
function getCurrentScheduleId(firstWeekMonday, scheduleLength) {
  if (!firstWeekMonday) return 0
  const diff = getWeekDiff(new Date(), firstWeekMonday)
  const len = Math.max(scheduleLength, 1)
  return ((diff % len) + len) % len
}

/**
 * 将 CSES 格式数据转换为引擎内部配置
 * @param {CSES} cses
 * @returns {{ version: number, setting: { timeOffset: number }, patterns: Pattern[], schedule: Schedule[], scheduleOverride: { date: string, override: string[] }, firstWeekMonday: string } | null}
 */
function csesToConfig(cses) {
  try {
    if (!cses || cses.version !== 1 || !Array.isArray(cses.subjects) || !Array.isArray(cses.schedules)) {
      return null
    }
    const patterns = []
    const schedule = []
    const hasEven = cses.schedules.some(item => item.weeks === 'even')
    const targetCount = hasEven ? 2 : 1
    while (schedule.length < targetCount) {
      schedule.push(createEmptySchedule())
    }
    const CSES_DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
    for (const scheduleEntry of cses.schedules) {
      const dayIdx = scheduleEntry.enable_day - 1
      if (dayIdx < 0 || dayIdx > 6) continue
      const dayKey = CSES_DAY_KEYS[dayIdx]
      const reg = /(\d{1,2}:\d{1,2})/
      const lessons = scheduleEntry.classes.map(item => {
        const subject = cses.subjects.find(s => s.name === item.subject)
        return {
          name: item.subject,
          time: (reg.exec(item.start_time)?.[1] || '') + '-' + (reg.exec(item.end_time)?.[1] || ''),
          isDivider: false,
          room: subject?.room,
          teacher: subject?.teacher
        }
      })
      const newPattern = lessons.map(item => ({ isDivider: false, time: item.time }))
      let patternIdx = patterns.findIndex(p => JSON.stringify(p.data) === JSON.stringify(newPattern))
      if (patternIdx === -1) {
        patterns.push({ name: '时间表' + (patterns.length + 1), data: newPattern })
        patternIdx = patterns.length - 1
      }
      const day = { pattern: patternIdx, lessons: lessons }
      if (scheduleEntry.weeks === 'all') {
        for (let j = 0; j < schedule.length; j++) {
          schedule[j][dayKey] = day
        }
      } else {
        const scheduleIdx = scheduleEntry.weeks === 'even' ? 1 : 0
        if (schedule[scheduleIdx]) {
          schedule[scheduleIdx][dayKey] = day
        }
      }
    }
    while (patterns.length < 7) {
      patterns.push({ name: '空时间表' + (patterns.length + 1), data: [] })
    }
    return {
      version: 1,
      setting: { ...DEFAULT_SETTING },
      patterns: patterns,
      schedule: schedule,
      scheduleOverride: { date: '1970-01-01', override: [] },
      firstWeekMonday: ''
    }
  } catch (e) {
    return null
  }
}

/**
 * 根据当前周数设置第一周周一的日期
 * @param {number} currentWeekNumber
 * @returns {void}
 */
function setFirstWeek(currentWeekNumber) {
  const thisMonday = getMonday(new Date())
  thisMonday.setDate(thisMonday.getDate() - currentWeekNumber * 7)
  engine.firstWeekMonday = formatDate(thisMonday)
  engine.currentScheduleId = getCurrentScheduleId(engine.firstWeekMonday, engine.schedule.length)
}

/**
 * 将配置对象应用到引擎状态
 * @param {any} d
 * @returns {boolean}
 */
function applyConfigObject(d) {
  if (!d) return false
  try {
    if (d.patterns) engine.patterns = d.patterns
    if (d.schedule) {
      engine.schedule = d.schedule.length ? d.schedule : [d.schedule]
    }
    if (d.scheduleOverride && d.scheduleOverride.date === formatDate()) {
      engine.scheduleOverride = d.scheduleOverride
    }
    if (d.firstWeekMonday) engine.firstWeekMonday = d.firstWeekMonday
    if (d.setting) {
      for (const key in d.setting) {
        if (key in engine.setting) {
          engine.setting[key] = d.setting[key]
        }
      }
    }
  } catch (e) {
    return false
  }
  return true
}

/**
 * 解析并应用配置字符串
 * @param {string} str
 * @param {any} storage
 * @returns {Promise<{ success: boolean, reason?: string }>}
 */
function applyConfigString(str, storage) {
  return new Promise((resolve) => {
    if (!str || typeof str !== 'string') {
      resolve({ success: false, reason: '消息内容为空' })
      return
    }
    let wrapper
    try {
      wrapper = JSON.parse(str)
    } catch (e) {
      resolve({ success: false, reason: '消息不是有效的JSON' })
      return
    }
    if (!wrapper || typeof wrapper !== 'object') {
      resolve({ success: false, reason: '消息格式错误' })
      return
    }
    if (wrapper.version !== PROTOCOL_VERSION) {
      resolve({ success: false, reason: '通讯协议版本不匹配' })
      return
    }
    if (!wrapper.type) {
      resolve({ success: false, reason: '消息格式错误' })
      return
    }
    let configStr = ''
    if (wrapper.type === 'CSES') {
      let csesData = wrapper.data
      if (typeof csesData === 'string') {
        try {
          csesData = JSON.parse(csesData)
        } catch (e) {
          resolve({ success: false, reason: 'CSES数据未被转换成有效的JSON' })
          return
        }
      }
      if (!csesData || typeof csesData !== 'object') {
        resolve({ success: false, reason: 'CSES数据格式错误' })
        return
      }
      const config = csesToConfig(csesData)
      if (!config) {
        resolve({ success: false, reason: 'CSES数据转换失败' })
        return
      }
      configStr = JSON.stringify(config)
    } else if (wrapper.type === 'config') {
      if (typeof wrapper.data !== 'string') {
        resolve({ success: false, reason: '配置数据格式错误' })
        return
      }
      configStr = wrapper.data
    } else {
      resolve({ success: false, reason: '不支持的消息类型' })
      return
    }
    let obj
    try {
      obj = JSON.parse(configStr)
    } catch (e) {
      resolve({ success: false, reason: '配置内容解析失败' })
      return
    }
    if (!applyConfigObject(obj)) {
      resolve({ success: false, reason: '配置内容应用失败' })
      return
    }
    engine.today = getToday()
    engine.currentScheduleId = getCurrentScheduleId(engine.firstWeekMonday, engine.schedule.length)
    refreshActiveState()
    notifyListeners()

    if (!storage) {
      resolve({ success: true })
      return
    }

    try {
      storage.set({
        key: STORAGE_KEY,
        value: configStr,
        success: function() {
          notifyListeners()
          resolve({ success: true })
        },
        fail: function(data, code) {
          console.error('scheduleEngine: storage.set failed', data, code)
          resolve({ success: false, reason: '本地存储失败' })
        }
      })
    } catch (e) {
      console.error('scheduleEngine: storage.set exception', e)
      resolve({ success: false, reason: '本地存储异常' })
    }
  })
}

/**
 * 初始化引擎
 * @param {any} storage
 * @returns {Promise<void>}
 */
function init(storage) {
  return new Promise((resolve) => {
    if (engine.inited) {
      resolve()
      return
    }

    engine.today = getToday()
    engine.currentScheduleId = getCurrentScheduleId(engine.firstWeekMonday, engine.schedule.length)
    refreshActiveState()
    engine.inited = true

    if (!storage) {
      resolve()
      return
    }

    try {
      storage.get({
        key: STORAGE_KEY,
        success: (data) => {
          if (data) {
            try {
              const obj = JSON.parse(data)
              if (applyConfigObject(obj)) {
                engine.today = getToday()
                engine.currentScheduleId = getCurrentScheduleId(engine.firstWeekMonday, engine.schedule.length)
                refreshActiveState()
                notifyListeners()
              }
            } catch (e) {
              console.error('scheduleEngine: parse cached config failed', e)
            }
          }
          resolve()
        },
        fail: function(data, code) {
          console.error('scheduleEngine: storage.get failed', data, code)
          resolve()
        }
      })
    } catch (e) {
      console.error('scheduleEngine: storage.get exception', e)
      resolve()
    }
  })
}

/**
 * 获取当前引擎配置对象
 * @returns {{ version: number, setting: { timeOffset: number }, patterns: Pattern[], schedule: Schedule[], scheduleOverride: { date: string, override: string[] }, firstWeekMonday: string }}
 */
function getConfigObject() {
  return {
    version: 1,
    setting: engine.setting,
    patterns: engine.patterns,
    schedule: engine.schedule,
    scheduleOverride: engine.scheduleOverride,
    firstWeekMonday: engine.firstWeekMonday
  }
}

/**
 * 保存当前配置到本地存储
 * @param {any} storage
 * @returns {Promise<boolean>}
 */
function save(storage) {
  return new Promise((resolve) => {
    notifyListeners()
    if (!storage) {
      resolve(true)
      return
    }
    const configStr = JSON.stringify(getConfigObject())
    // console.log(JSON.parse(configStr))
    try {
      storage.set({
        key: STORAGE_KEY,
        value: configStr,
        success: function() {
          resolve(true)
        },
        fail: function(data, code) {
          console.error('scheduleEngine: storage.set failed', data, code)
          resolve(false)
        }
      })
    } catch (e) {
      console.error('scheduleEngine: storage.set exception', e)
      resolve(false)
    }
  })
}

/**
 * 通知所有更新监听器
 * @returns {void}
 */
function notifyListeners() {
  for (const fn of engine._listeners) {
    try { fn() } catch (e) {}
  }
}

/**
 * 注册配置更新监听器
 * @param {() => void} fn
 * @returns {() => void} 取消监听的函数
 */
function onUpdate(fn) {
  engine._listeners.push(fn)
  return function () {
    const idx = engine._listeners.indexOf(fn)
    if (idx !== -1) engine._listeners.splice(idx, 1)
  }
}

/**
 * 启动日期与课程状态定时刷新
 * @returns {void}
 */
function startTimers() {
  engine.today = getToday()
  refreshActiveState()
  if (engine._todayTimer) clearInterval(engine._todayTimer)
  if (engine._activeTimer) clearInterval(engine._activeTimer)
  engine._todayTimer = setInterval(() => {
    engine.today = getToday()
    engine.currentScheduleId = getCurrentScheduleId(engine.firstWeekMonday, engine.schedule.length)
  }, 300000)
  engine._activeTimer = setInterval(refreshActiveState, 500)
}

/**
 * 停止所有定时器
 * @returns {void}
 */
function stopTimers() {
  if (engine._todayTimer) {
    clearInterval(engine._todayTimer)
    engine._todayTimer = null
  }
  if (engine._activeTimer) {
    clearInterval(engine._activeTimer)
    engine._activeTimer = null
  }
}

export {
  engine,
  init,
  save,
  setFirstWeek,
  csesToConfig,
  getScheduleToday,
  getCountdownText,
  startTimers,
  stopTimers,
  onUpdate,
  applyConfigString,
  STORAGE_KEY
}
