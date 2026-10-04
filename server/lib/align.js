// Word-level LCS alignment between a quoted text (q) and a source span (s).
// Returns matched pairs plus diff operations restricted to the matched span of s.

export function lcsPairs(q, s) {
  const n = q.length, m = s.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = q[i] === s[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const pairs = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (q[i] === s[j]) { pairs.push([i, j]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return pairs;
}

// ops: { type: 'equal' | 'replace' | 'added' | 'missing', said: [...], source: [...] }
// 'added'   = words in the quote that are not in the source
// 'missing' = words of the source (inside the quoted span) left out of the quote
export function diffOps(qOrig, sOrig, pairs) {
  const ops = [];
  const push = (type, said, source) => {
    if (!said.length && !source.length) return;
    const last = ops[ops.length - 1];
    if (type === 'equal' && last?.type === 'equal') { last.said.push(...said); last.source.push(...source); return; }
    ops.push({ type, said, source });
  };
  const gap = (qa, qb, sa, sb) => {
    const said = qOrig.slice(qa, qb), source = sOrig.slice(sa, sb);
    if (said.length && source.length) push('replace', said, source);
    else if (said.length) push('added', said, []);
    else if (source.length) push('missing', [], source);
  };
  if (!pairs.length) return [{ type: 'added', said: qOrig.slice(), source: [] }];

  gap(0, pairs[0][0], 0, pairs[0][1]); // leading gap (source side may hold the misquoted words)
  for (let k = 0; k < pairs.length; k++) {
    const [qi, si] = pairs[k];
    push('equal', [qOrig[qi]], [sOrig[si]]);
    const next = pairs[k + 1];
    if (next) gap(qi + 1, next[0], si + 1, next[1]);
    else gap(qi + 1, qOrig.length, si + 1, sOrig.length); // trailing gap
  }
  return ops;
}
