/**
 * Remove every trailing '/' from a string.
 *
 * Same result as `value.replace(/\/+$/, '')`, but runs in linear time. The
 * regex form backtracks on input with many '/' that are not at the end, which
 * matters when the value comes from a request header or tool argument.
 */
export function stripTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47 /* '/' */) {
    end--;
  }
  return end === value.length ? value : value.slice(0, end);
}
