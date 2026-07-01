export function createDebouncer(fn, delayMs) {
  let timer = null

  return {
    trigger(...args) {
      if (timer) {
        clearTimeout(timer)
      }
      timer = setTimeout(() => {
        timer = null
        fn(...args)
      }, delayMs)
    },
    cancel() {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
    }
  }
}
