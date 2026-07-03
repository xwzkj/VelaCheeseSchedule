const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

const DEFAULT_SETTING = {
  timeOffset: 0
}

const STORAGE_KEY = 'configCache'

function createEmptyDay() {
  return { pattern: -1, lessons: [] }
}

function createEmptySchedule() {
  return { mon: createEmptyDay(), tue: createEmptyDay(), wed: createEmptyDay(), thu: createEmptyDay(), fri: createEmptyDay(), sat: createEmptyDay(), sun: createEmptyDay() }
}

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

function getToday() {
  return WEEKDAYS[new Date().getDay()]
}

function formatDate(d) {
  const date = d || new Date()
  return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0')
}

function getMonday(date) {
  const d = new Date(date)
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1)
  d.setDate(diff)
  d.setHours(0, 0, 0, 0)
  return d
}

function getWeekDiff(d1, d2) {
  const a = getMonday(new Date(d1))
  const b = getMonday(new Date(d2))
  return Math.round((a - b) / (7 * 24 * 60 * 60 * 1000))
}

function getMinutesNow(offset) {
  const now = new Date()
  return (now.getHours() * 60 + now.getMinutes()) + (offset / 60)
}

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

function getCurrentScheduleId(firstWeekMonday, scheduleLength) {
  if (!firstWeekMonday) return 0
  const diff = getWeekDiff(new Date(), firstWeekMonday)
  const len = Math.max(scheduleLength, 1)
  return ((diff % len) + len) % len
}

function csesParse(str) {
  const lines = str.split('\n').filter(l => l.trim())
  const result = { version: 1, subjects: [], schedules: [] }
  let currentSection = ''
  let currentSubject = null
  let currentSchedule = null
  let currentClass = null
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('version:')) {
      result.version = parseInt(trimmed.split(':')[1].trim())
    } else if (trimmed === 'subjects:') {
      currentSection = 'subjects'
    } else if (trimmed === 'schedules:') {
      currentSection = 'schedules'
    } else if (currentSection === 'subjects' && trimmed.startsWith('- name:')) {
      if (currentSubject) result.subjects.push(currentSubject)
      currentSubject = { name: '', simplified_name: '', room: '', teacher: '' }
      currentSubject.name = trimmed.split(':')[1].trim().replace(/"/g, '')
    } else if (currentSection === 'subjects' && currentSubject) {
      if (trimmed.startsWith('simplified_name:')) currentSubject.simplified_name = trimmed.split(':')[1].trim().replace(/"/g, '')
      else if (trimmed.startsWith('room:')) currentSubject.room = trimmed.split(':')[1].trim().replace(/"/g, '')
      else if (trimmed.startsWith('teacher:')) currentSubject.teacher = trimmed.split(':')[1].trim().replace(/"/g, '')
    } else if (currentSection === 'schedules' && trimmed.startsWith('- name:')) {
      if (currentSchedule) {
        if (currentClass) { currentSchedule.classes.push(currentClass); currentClass = null }
        result.schedules.push(currentSchedule)
      }
      currentSchedule = { name: '', enable_day: 1, classes: [], weeks: null }
      currentSchedule.name = trimmed.split(':')[1].trim().replace(/"/g, '')
    } else if (currentSection === 'schedules' && currentSchedule) {
      if (trimmed.startsWith('enable_day:')) {
        currentSchedule.enable_day = parseInt(trimmed.split(':')[1].trim())
      } else if (trimmed.startsWith('weeks:')) {
        currentSchedule.weeks = trimmed.split(':')[1].trim()
      } else if (trimmed.startsWith('- subject:')) {
        if (currentClass) currentSchedule.classes.push(currentClass)
        currentClass = { subject: '', start_time: '', end_time: '' }
        currentClass.subject = trimmed.split(':')[1].trim().replace(/"/g, '')
      } else if (currentClass) {
        if (trimmed.startsWith('start_time:')) currentClass.start_time = trimmed.split(':')[1].trim().replace(/"/g, '')
        else if (trimmed.startsWith('end_time:')) currentClass.end_time = trimmed.split(':')[1].trim().replace(/"/g, '')
      }
    }
  }
  if (currentSubject) result.subjects.push(currentSubject)
  if (currentSchedule) {
    if (currentClass) currentSchedule.classes.push(currentClass)
    result.schedules.push(currentSchedule)
  }
  return result
}

function csesToConfig(csesStr) {
  try {
    const cses = csesParse(csesStr)
    if (!cses || cses.version !== 1) {
      return null
    }
    const patterns = []
    const schedule = []
    const hasEven = cses.schedules.some(item => item.weeks === 'even')
    const targetCount = hasEven ? 2 : 1
    while (schedule.length < targetCount) {
      schedule.push(createEmptySchedule())
    }
    for (const scheduleEntry of cses.schedules) {
      const dayIdx = scheduleEntry.enable_day - 1
      if (dayIdx < 0 || dayIdx > 6) continue
      const reg = /(\d{1,2}:\d{1,2})/
      const lessons = scheduleEntry.classes.map(item => ({
        name: item.subject,
        time: (reg.exec(item.start_time)?.[1] || '') + '-' + (reg.exec(item.end_time)?.[1] || ''),
        isDivider: false
      }))
      const newPattern = lessons.map(item => ({ isDivider: false, time: item.time }))
      let patternIdx = patterns.findIndex(p => JSON.stringify(p.data) === JSON.stringify(newPattern))
      if (patternIdx === -1) {
        patterns.push({ name: '时间表' + (patterns.length + 1), data: newPattern })
        patternIdx = patterns.length - 1
      }
      const day = { pattern: patternIdx, lessons: lessons }
      if (scheduleEntry.weeks === 'all') {
        for (let j = 0; j < schedule.length; j++) {
          schedule[j][WEEKDAYS[dayIdx]] = day
        }
      } else {
        const scheduleIdx = scheduleEntry.weeks === 'even' ? 1 : 0
        if (schedule[scheduleIdx]) {
          schedule[scheduleIdx][WEEKDAYS[dayIdx]] = day
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

function setFirstWeek(currentWeekNumber) {
  const thisMonday = getMonday(new Date())
  thisMonday.setDate(thisMonday.getDate() - currentWeekNumber * 7)
  engine.firstWeekMonday = formatDate(thisMonday)
  engine.currentScheduleId = getCurrentScheduleId(engine.firstWeekMonday, engine.schedule.length)
}

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

function applyConfigString(str, storage) {
  if (!str || typeof str !== 'string') return false
  let wrapper
  try {
    wrapper = JSON.parse(str)
  } catch (e) {
    return false
  }
  if (!wrapper || wrapper.version !== 1 || typeof wrapper.data !== 'string') return false
  let configStr = ''
  if (wrapper.type === 'CSES') {
    const config = csesToConfig(wrapper.data)
    if (!config) return false
    configStr = JSON.stringify(config)
  } else if (wrapper.type === 'config') {
    configStr = wrapper.data
  } else {
    return false
  }
  let obj
  try {
    obj = JSON.parse(configStr)
  } catch (e) {
    return false
  }
  if (!applyConfigObject(obj)) return false
  engine.today = getToday()
  engine.currentScheduleId = getCurrentScheduleId(engine.firstWeekMonday, engine.schedule.length)
  refreshActiveState()

  if (storage) {
    try {
      storage.set({
        key: STORAGE_KEY,
        value: configStr,
        success: function() {
          notifyListeners()
        },
        fail: function(data, code) {
          console.error('scheduleEngine: storage.set failed', data, code)
          notifyListeners()
        }
      })
    } catch (e) {
      console.error('scheduleEngine: storage.set exception', e)
      notifyListeners()
    }
  } else {
    notifyListeners()
  }
  return true
}

function init(storage) {
  engine.today = getToday()
  engine.currentScheduleId = getCurrentScheduleId(engine.firstWeekMonday, engine.schedule.length)
  refreshActiveState()
  engine.inited = true
  if (storage) {
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
        },
        fail: function(data, code) {
          console.error('scheduleEngine: storage.get failed', data, code)
        }
      })
    } catch (e) {
      console.error('scheduleEngine: storage.get exception', e)
    }
  }
}

function save() {
  notifyListeners()
  return Promise.resolve(true)
}

function notifyListeners() {
  for (const fn of engine._listeners) {
    try { fn() } catch (e) {}
  }
}

function onUpdate(fn) {
  engine._listeners.push(fn)
  return function () {
    const idx = engine._listeners.indexOf(fn)
    if (idx !== -1) engine._listeners.splice(idx, 1)
  }
}

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
