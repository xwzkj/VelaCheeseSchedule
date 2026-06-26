import defaultConfig from './config.json'

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
const WEEKDAY_MAP = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 7 }

const DEFAULT_SETTING = {
  startup: true,
  zoom: 1,
  heightFactor: 0.7,
  avoidCoverTitleBar: true,
  timeOffset: 0,
  drawDynamicProbability: true,
  drawPreventDuplicate: true,
  drawAutoNewRound: true,
  drawPreventCheating: true,
  drawSmallWindowEnabled: true,
  drawExcludeLeaveStudents: true,
  themeColor: '#ce9e04',
  password: '',
  passwordScope: ['editor-password'],
  AIapiKey: '',
  AIplayVoiceWhenLessonSwitch: true,
  widgetWordCardHistory: []
}

function createEmptyDay() {
  return { pattern: -1, lessons: [] }
}

function createEmptySchedule() {
  return { mon: createEmptyDay(), tue: createEmptyDay(), wed: createEmptyDay(), thu: createEmptyDay(), fri: createEmptyDay(), sat: createEmptyDay(), sun: createEmptyDay() }
}

const engine = {
  setting: { ...DEFAULT_SETTING, passwordScope: [...DEFAULT_SETTING.passwordScope], widgetWordCardHistory: [] },
  drawCandidates: [],
  inited: false,
  initedTime: 0,
  today: '',
  patterns: [],
  schedule: [],
  firstWeekMonday: '',
  currentScheduleId: 0,
  scheduleOverride: { date: '1970-01-01', override: [] },
  widgets: [],

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
  if (flag === 0 && resLast) {
    if (time === lastTime) {
      if (nowTime < end) flag = 1
    } else {
      const lastEnd = parseInt(resLast[3]) * 60 + parseInt(resLast[4])
      if (nowTime >= lastEnd && nowTime < start) flag = 1
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

function getLessonStatus(lessons) {
  for (let i = 0; i < lessons.length; i++) {
    if ((lessons[i].active || 0) === 2) return true
  }
  return false
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
        return '距离' + lessons[i].name + '\n还有' + remain + '分钟'
      }
    }
  }
  return '当前没有课程'
}

function refreshActiveState() {
  const todayLessons = getScheduleToday(engine.schedule, engine.currentScheduleId, engine.today, engine.scheduleOverride)
  for (let i = 0; i < todayLessons.length; i++) {
    if (todayLessons[i].isDivider) continue
    let lastIndex = 0
    for (let j = i - 1; j >= 0; j--) {
      if (!todayLessons[j].isDivider) {
        lastIndex = j
        break
      }
    }
    const scheduleDay = engine.schedule[engine.currentScheduleId]
    if (scheduleDay && scheduleDay[engine.today]) {
      scheduleDay[engine.today].lessons[i].active = isActiveTime(todayLessons[i].time, todayLessons[lastIndex] ? todayLessons[lastIndex].time : null, engine.setting.timeOffset)
    }
  }
}

function getCurrentScheduleId(firstWeekMonday, scheduleLength) {
  if (!firstWeekMonday) return 0
  const diff = getWeekDiff(new Date(), firstWeekMonday)
  const len = Math.max(scheduleLength, 1)
  return ((diff % len) + len) % len
}

function setScheduleCount(count) {
  while (engine.schedule.length > count) {
    engine.schedule.pop()
  }
  while (engine.schedule.length < count) {
    engine.schedule.push(createEmptySchedule())
  }
}

function setPatternToDay(patternId, scheduleId, day) {
  const targetSchedule = engine.schedule[scheduleId]
  if (!targetSchedule) return
  targetSchedule[day].pattern = patternId
  const p = engine.patterns[patternId]
  if (!p) return
  const courseNames = targetSchedule[day].lessons.filter(l => !l.isDivider).map(l => l.name)
  const lessons = []
  let courseIdx = 0
  for (let i = 0; i < p.data.length; i++) {
    const name = (!p.data[i].isDivider) ? (courseNames[courseIdx] || '空') : '空'
    if (!p.data[i].isDivider) courseIdx++
    lessons.push({
      name: name,
      time: p.data[i].time || '',
      isDivider: !!p.data[i].isDivider
    })
  }
  targetSchedule[day].lessons = lessons
}

function refreshPatternToDay() {
  for (let i = 0; i < engine.patterns.length; i++) {
    for (let j = 0; j < engine.schedule.length; j++) {
      for (const key of WEEKDAYS) {
        if (engine.schedule[j][key].pattern === i) {
          setPatternToDay(i, j, key)
        }
      }
    }
  }
}

function csesStringify(cses) {
  let out = ''
  out += 'version: ' + cses.version + '\n'
  out += 'subjects:\n'
  for (const s of cses.subjects) {
    out += '  - name: "' + s.name + '"\n'
    out += '    simplified_name: "' + s.simplified_name + '"\n'
    out += '    room: "' + (s.room || '') + '"\n'
    out += '    teacher: "' + (s.teacher || '') + '"\n'
  }
  out += 'schedules:\n'
  for (const sch of cses.schedules) {
    out += '  - name: "' + sch.name + '"\n'
    out += '    enable_day: ' + sch.enable_day + '\n'
    if (sch.weeks) out += '    weeks: ' + sch.weeks + '\n'
    out += '    classes:\n'
    for (const cls of sch.classes) {
      out += '      - subject: "' + cls.subject + '"\n'
      out += '        start_time: "' + cls.start_time + '"\n'
      out += '        end_time: "' + cls.end_time + '"\n'
    }
  }
  return out
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

function exportToCSES() {
  const cses = { version: 1, subjects: [], schedules: [] }
  for (let i = 0; i < Math.min(engine.schedule.length, 2); i++) {
    for (const key of WEEKDAYS) {
      const daySchedule = engine.schedule[i][key]
      const csesClasses = []
      for (const lesson of daySchedule.lessons) {
        if (!cses.subjects.find(item => item.name === lesson.name)) {
          cses.subjects.push({ name: lesson.name, simplified_name: lesson.name.substring(0, 1), room: '', teacher: '' })
        }
        const reg = /^(\d{1,2})[：:](\d{1,2})[-~ ]+(\d{1,2})[：:](\d{1,2})$/
        const time = reg.exec(lesson.time)
        if (time && !lesson.isDivider) {
          csesClasses.push({
            subject: lesson.name,
            start_time: time[1].padStart(2, '0') + ':' + time[2].padStart(2, '0') + ':00',
            end_time: time[3].padStart(2, '0') + ':' + time[4].padStart(2, '0') + ':00'
          })
        }
      }
      const entry = {
        name: '第' + (i + 1) + '周 周' + WEEKDAY_MAP[key],
        enable_day: WEEKDAY_MAP[key],
        classes: csesClasses
      }
      if (engine.schedule.length > 1) {
        entry.weeks = i === 0 ? 'odd' : 'even'
      }
      cses.schedules.push(entry)
    }
  }
  return csesStringify(cses)
}

function importFromCSES(csesStr) {
  try {
    const cses = csesParse(csesStr)
    if (!cses || cses.version !== 1) {
      return { success: false, message: '不支持的配置版本' }
    }
    engine.patterns = []
    setScheduleCount(0)
    const hasEven = cses.schedules.some(item => item.weeks === 'even')
    setScheduleCount(hasEven ? 2 : 1)
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
      let patternIdx = engine.patterns.findIndex(p => JSON.stringify(p.data) === JSON.stringify(newPattern))
      if (patternIdx === -1) {
        engine.patterns.push({ name: '时间表' + (engine.patterns.length + 1), data: newPattern })
        patternIdx = engine.patterns.length - 1
      }
      const day = { pattern: patternIdx, lessons: lessons }
      if (scheduleEntry.weeks === 'all') {
        for (let j = 0; j < engine.schedule.length; j++) {
          engine.schedule[j][WEEKDAYS[dayIdx]] = day
        }
      } else {
        const scheduleIdx = scheduleEntry.weeks === 'even' ? 1 : 0
        if (engine.schedule[scheduleIdx]) {
          engine.schedule[scheduleIdx][WEEKDAYS[dayIdx]] = day
        }
      }
    }
    while (engine.patterns.length < 7) {
      engine.patterns.push({ name: '空时间表' + (engine.patterns.length + 1), data: [] })
    }
    return { success: true, message: '导入成功' }
  } catch (e) {
    return { success: false, message: '导入失败' }
  }
}

function setFirstWeek(currentWeekNumber) {
  const thisMonday = getMonday(new Date())
  thisMonday.setDate(thisMonday.getDate() - currentWeekNumber * 7)
  engine.firstWeekMonday = formatDate(thisMonday)
  engine.currentScheduleId = getCurrentScheduleId(engine.firstWeekMonday, engine.schedule.length)
}

function init() {
  try {
    const d = defaultConfig
    if (d) {
      if (d.patterns) engine.patterns = d.patterns
      if (d.schedule) {
        engine.schedule = d.schedule.length ? d.schedule : [d.schedule]
      }
      if (d.scheduleOverride && d.scheduleOverride.date === formatDate()) {
        engine.scheduleOverride = d.scheduleOverride
      }
      if (d.widgets) engine.widgets = d.widgets
      if (d.firstWeekMonday) engine.firstWeekMonday = d.firstWeekMonday
      if (d.drawCandidates) engine.drawCandidates = d.drawCandidates
      if (d.setting) {
        for (const key in d.setting) {
          if (key in engine.setting) {
            engine.setting[key] = d.setting[key]
          }
        }
      }
    }
  } catch (e) {}
  if (!engine.patterns || engine.patterns.length === 0) {
    engine.patterns = []
    for (let i = 0; i < 7; i++) {
      engine.patterns.push({ name: '时间表' + (i + 1), data: [] })
    }
  }
  if (engine.schedule.length === 0) {
    setScheduleCount(1)
  }
  engine.today = getToday()
  engine.currentScheduleId = getCurrentScheduleId(engine.firstWeekMonday, engine.schedule.length)
  refreshActiveState()
  engine.inited = true
  engine.initedTime = Date.now()
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
  setScheduleCount,
  setFirstWeek,
  setPatternToDay,
  refreshPatternToDay,
  exportToCSES,
  importFromCSES,
  getCurrentScheduleId,
  isActiveTime,
  refreshActiveState,
  getScheduleToday,
  getLessonStatus,
  getCountdownText,
  startTimers,
  stopTimers,
  onUpdate,
  WEEKDAYS,
  WEEKDAY_MAP
}
