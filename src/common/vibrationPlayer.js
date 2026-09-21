// 播放状态放在普通 JS 闭包内，不依赖页面 ViewModel 的数据代理。
function createVibrationPlayer(vibrator) {
  let timer = null
  let currentRun = null

  function stop(source) {
    if (source && (!currentRun || currentRun.source !== source)) return
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    currentRun = null
  }

  function playNext(run) {
    if (currentRun !== run) return false
    const pulse = run.pattern[run.index]
    try {
      vibrator.vibrate({ mode: pulse.mode })
    } catch (e) {
      stop()
      console.error('vibrationPlayer: vibrate failed', e)
      if (run.onError) run.onError()
      return false
    }
    run.index += 1
    if (run.index < run.pattern.length) {
      timer = setTimeout(() => {
        if (currentRun !== run) return
        timer = null
        playNext(run)
      }, pulse.pause)
    } else {
      currentRun = null
    }
    return true
  }

  function play(pattern, source, onError) {
    stop()
    const run = { pattern, source, onError, index: 0 }
    currentRun = run
    return playNext(run)
  }

  return {
    play,
    stop,
    isPlaying() {
      return currentRun !== null
    }
  }
}

export { createVibrationPlayer }
