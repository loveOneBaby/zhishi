// 把改写流式输出(改写思路 + ---JSON--- + 结构化 JSON)解析成可"逐字"展示的片段。
// 模型先输出自然语言的“改写思路”,再输出 JSON;这里在 JSON 还没闭合时也能增量提取标题/正文,
// 实现“写一点出来一点”的实时预览。

export type LivePiece = { kind: 'title' | 'summary' | 'content'; text: string };

export interface LiveRewriteView {
  plan: string;
  pieces: LivePiece[];
}

function unescapeJsonString(s: string): string {
  return s
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '  ')
    .replace(/\\r/g, '')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\')
    .replace(/\\\//g, '/');
}

export function parseLiveRewrite(raw: string): LiveRewriteView {
  const trimmed = raw ?? '';
  // 切出 plan / json 两段
  let plan = '';
  let json = '';
  const marker = trimmed.indexOf('---JSON---');
  if (marker >= 0) {
    plan = trimmed.slice(0, marker).trim();
    json = trimmed.slice(marker + '---JSON---'.length);
  } else {
    const brace = trimmed.indexOf('{');
    if (brace >= 0) {
      plan = trimmed.slice(0, brace).trim();
      json = trimmed.slice(brace);
    } else {
      plan = trimmed.trim();
      json = '';
    }
  }

  const pieces: LivePiece[] = [];
  if (json) {
    // 已闭合的 "key":"value"
    const re = /"(title|summary|content)"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
    let m: RegExpExecArray | null;
    let lastIndex = 0;
    while ((m = re.exec(json)) !== null) {
      pieces.push({ kind: m[1] as LivePiece['kind'], text: unescapeJsonString(m[2]) });
      lastIndex = re.lastIndex;
    }
    // 末尾正在生成、还没闭合的那个值
    const tail = json.slice(lastIndex);
    const tailMatch = /"(title|summary|content)"\s*:\s*"((?:[^"\\]|\\.)*)$/.exec(tail);
    if (tailMatch && tailMatch[2]) {
      pieces.push({ kind: tailMatch[1] as LivePiece['kind'], text: unescapeJsonString(tailMatch[2]) });
    }
  }

  // 去掉 JSON 顶层 title 之外的第一个 summary 之前重复(保持顺序即可,这里不去重)
  return { plan, pieces };
}
