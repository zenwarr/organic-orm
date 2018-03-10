export function mapFromObject<V>(obj: { [name: string]: V }): Map<string, V> {
  let map = new Map<string, V>();
  for (let key of Object.keys(obj)) {
    map.set(key, obj[key]);
  }
  return map;
}

const WHITESPACE_CODES: number[] = ' \t\n\r\v\f\u00A0\u2028\u2029'.split('').map(x => x.charCodeAt(0));
export function isWhitespaceCode(ch: number): boolean {
  return WHITESPACE_CODES.indexOf(ch) >= 0;
}

export function isAlphaCode(ch: number): boolean {
  return (ch >= 'a'.charCodeAt(0) && ch <= 'z'.charCodeAt(0)) || (ch >= 'A'.charCodeAt(0) && ch <= 'Z'.charCodeAt(0));
}

export function isDigitCode(ch: number): boolean {
  return ch >= '0'.charCodeAt(0) && ch <= '9'.charCodeAt(0);
}

export function capitalize(input: string): string {
  if (input.length === 0) {
    return input;
  } else {
    return input.charAt(0).toUpperCase() + input.slice(1);
  }
}
