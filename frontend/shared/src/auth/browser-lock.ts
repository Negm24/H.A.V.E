import { ApiError } from '../api/http'

export function browserSessionLock(name: string) {
  return <T>(work: () => Promise<T>): Promise<T> => {
    // Fail closed rather than risk replaying a rotating cookie across tabs.
    if (!navigator.locks) return Promise.reject(new ApiError('Use a current browser on localhost or HTTPS.', 0))
    return navigator.locks.request(name, work)
  }
}
