// 终端列宽估算：终端光标定位需要"列数"而不是 JS 字符串长度。
//
// 为什么不用依赖：项目规则禁止为一个小功能引入新依赖；输入框 caret 只需要
// 常见情况的估算（ASCII 1 列、CJK/emoji 2 列、组合字符 0 列）。
// 局限：不做完整的 East Asian Width 表；误差只影响 IME 候选框的横向偏移，
// 不会造成乱码或数据错误。

/** 估算一段文本在终端中占用的列数。 */
export function displayWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    const codePoint = char.codePointAt(0);
    if (codePoint === undefined) {
      continue;
    }

    // 组合附加符号不占列宽（例如 e + U+0301）。
    if (codePoint >= 0x0300 && codePoint <= 0x036f) {
      continue;
    }

    width += isWideCodePoint(codePoint) ? 2 : 1;
  }

  return width;
}

/** 粗略判断码点是否为双列字符（CJK、假名、韩文、全角标点、常见 emoji）。 */
function isWideCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x1100 && codePoint <= 0x115f) ||
    (codePoint >= 0x2e80 && codePoint <= 0x303e) ||
    (codePoint >= 0x3041 && codePoint <= 0x33ff) ||
    (codePoint >= 0x3400 && codePoint <= 0x4dbf) ||
    (codePoint >= 0x4e00 && codePoint <= 0x9fff) ||
    (codePoint >= 0xa000 && codePoint <= 0xa4cf) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe4f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    (codePoint >= 0x1f300 && codePoint <= 0x1f64f) ||
    (codePoint >= 0x1f900 && codePoint <= 0x1f9ff) ||
    (codePoint >= 0x20000 && codePoint <= 0x3fffd)
  );
}
