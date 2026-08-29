const VIBRATION_STORAGE_KEY = 'vibrateWhenLessonSwitch'

function parseBoolean(value) {
  if (typeof value === 'boolean') return value
  if (typeof value !== 'string') return false
  const normalized = value.trim().toLowerCase()
  return normalized === 'true' || normalized === '1'
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
        success: () => resolve(true),
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

export {
  VIBRATION_STORAGE_KEY,
  getVibrationEnabled,
  setVibrationEnabled
}
