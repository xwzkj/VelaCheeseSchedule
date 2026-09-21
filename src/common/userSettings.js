const VIBRATION_STORAGE_KEY = 'vibrateWhenLessonSwitch'
const VIBRATION_MODE_STORAGE_KEY = 'vibrationReminderMode'
const DEFAULT_VIBRATION_MODE = 'standard'

const VIBRATION_MODE_OPTIONS = [
  {
    id: 'gentle',
    title: '轻柔',
    description: '长震一次，减少打扰'
  },
  {
    id: 'standard',
    title: '标准',
    description: '短-长-短，容易辨识'
  },
  {
    id: 'strong',
    title: '强提醒',
    description: '连续两次长震，更不易错过'
  }
]

const VIBRATION_PATTERNS = {
  gentle: [
    { mode: 'long', pause: 0 }
  ],
  // 间隔留出完整的系统振动时长，避免连续调用互相覆盖。
  standard: [
    { mode: 'short', pause: 300 },
    { mode: 'long', pause: 500 },
    { mode: 'short', pause: 0 }
  ],
  strong: [
    { mode: 'long', pause: 400 },
    { mode: 'long', pause: 0 }
  ]
}

const vibrationListeners = []
const vibrationModeListeners = []

function notifyVibrationListeners(enabled) {
  for (let i = 0; i < vibrationListeners.length; i++) {
    try {
      vibrationListeners[i](enabled)
    } catch (e) {
      console.error('userSettings: listener failed', e)
    }
  }
}

function notifyVibrationModeListeners(mode) {
  for (let i = 0; i < vibrationModeListeners.length; i++) {
    try {
      vibrationModeListeners[i](mode)
    } catch (e) {
      console.error('userSettings: mode listener failed', e)
    }
  }
}

/**
 * 监听震动开关变化
 * @param {(enabled: boolean) => void} listener
 * @returns {() => void} 取消监听函数
 */
function onVibrationChange(listener) {
  if (typeof listener !== 'function') return () => {}
  vibrationListeners.push(listener)
  return () => {
    const idx = vibrationListeners.indexOf(listener)
    if (idx >= 0) vibrationListeners.splice(idx, 1)
  }
}

/**
 * 监听震动模式变化
 * @param {(mode: string) => void} listener
 * @returns {() => void} 取消监听函数
 */
function onVibrationModeChange(listener) {
  if (typeof listener !== 'function') return () => {}
  vibrationModeListeners.push(listener)
  return () => {
    const idx = vibrationModeListeners.indexOf(listener)
    if (idx >= 0) vibrationModeListeners.splice(idx, 1)
  }
}

function parseBoolean(value) {
  if (typeof value === 'boolean') return value
  if (typeof value !== 'string') return false
  const normalized = value.trim().toLowerCase()
  return normalized === 'true' || normalized === '1'
}

function normalizeVibrationMode(value) {
  for (let i = 0; i < VIBRATION_MODE_OPTIONS.length; i++) {
    if (VIBRATION_MODE_OPTIONS[i].id === value) return value
  }
  return DEFAULT_VIBRATION_MODE
}

function getVibrationPattern(mode) {
  return VIBRATION_PATTERNS[normalizeVibrationMode(mode)]
}

/**
 * 读取上下课振动偏好。该偏好独立于课程表配置保存。
 * @param {any} storage
 * @returns {Promise<boolean>}
 */
function getVibrationEnabled(storage) {
  return new Promise((resolve) => {
    if (!storage || typeof storage.get !== 'function') {
      resolve(false)
      return
    }
    try {
      storage.get({
        key: VIBRATION_STORAGE_KEY,
        success: (data) => resolve(parseBoolean(data)),
        fail: (data, code) => {
          console.error('userSettings: storage.get failed', data, code)
          resolve(false)
        }
      })
    } catch (e) {
      console.error('userSettings: storage.get exception', e)
      resolve(false)
    }
  })
}

/**
 * 保存上下课振动偏好。
 * @param {any} storage
 * @param {boolean} enabled
 * @returns {Promise<boolean>}
 */
function setVibrationEnabled(storage, enabled) {
  return new Promise((resolve) => {
    if (!storage || typeof storage.set !== 'function') {
      resolve(false)
      return
    }
    try {
      storage.set({
        key: VIBRATION_STORAGE_KEY,
        value: enabled ? 'true' : 'false',
        success: () => {
          notifyVibrationListeners(enabled)
          resolve(true)
        },
        fail: (data, code) => {
          console.error('userSettings: storage.set failed', data, code)
          resolve(false)
        }
      })
    } catch (e) {
      console.error('userSettings: storage.set exception', e)
      resolve(false)
    }
  })
}

/**
 * 读取上下课振动模式。
 * @param {any} storage
 * @returns {Promise<string>}
 */
function getVibrationMode(storage) {
  return new Promise((resolve) => {
    if (!storage || typeof storage.get !== 'function') {
      resolve(DEFAULT_VIBRATION_MODE)
      return
    }
    try {
      storage.get({
        key: VIBRATION_MODE_STORAGE_KEY,
        success: (data) => resolve(normalizeVibrationMode(data)),
        fail: (data, code) => {
          console.error('userSettings: vibration mode get failed', data, code)
          resolve(DEFAULT_VIBRATION_MODE)
        }
      })
    } catch (e) {
      console.error('userSettings: vibration mode get exception', e)
      resolve(DEFAULT_VIBRATION_MODE)
    }
  })
}

/**
 * 保存上下课振动模式。
 * @param {any} storage
 * @param {string} mode
 * @returns {Promise<boolean>}
 */
function setVibrationMode(storage, mode) {
  const normalizedMode = normalizeVibrationMode(mode)
  return new Promise((resolve) => {
    if (!storage || typeof storage.set !== 'function') {
      resolve(false)
      return
    }
    try {
      storage.set({
        key: VIBRATION_MODE_STORAGE_KEY,
        value: normalizedMode,
        success: () => {
          notifyVibrationModeListeners(normalizedMode)
          resolve(true)
        },
        fail: (data, code) => {
          console.error('userSettings: vibration mode set failed', data, code)
          resolve(false)
        }
      })
    } catch (e) {
      console.error('userSettings: vibration mode set exception', e)
      resolve(false)
    }
  })
}

export {
  VIBRATION_STORAGE_KEY,
  VIBRATION_MODE_STORAGE_KEY,
  DEFAULT_VIBRATION_MODE,
  VIBRATION_MODE_OPTIONS,
  getVibrationPattern,
  getVibrationEnabled,
  setVibrationEnabled,
  onVibrationChange,
  getVibrationMode,
  setVibrationMode,
  onVibrationModeChange,
  normalizeVibrationMode
}
