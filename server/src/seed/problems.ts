/**
 * Built-in problem set. Hidden tests are generated with a seeded RNG and their
 * expected outputs are computed by running the reference solution in the judge.
 */

export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1));
  const pick = <T>(xs: T[]) => xs[Math.floor(next() * xs.length)];
  return { next, int, pick };
}

export interface SeedTest {
  input: string;
  expected?: string;
  sample?: boolean;
  weight?: number;
  explanation?: string;
}

export interface SeedQuestion {
  slug: string;
  type: 'coding' | 'sql' | 'mcq';
  title: string;
  difficulty: 'easy' | 'medium' | 'hard';
  tags: string[];
  visibility: 'public' | 'private';
  statement: string;
  data: Record<string, unknown>;
  tests: SeedTest[];
}

const lines = (...xs: (string | number | (string | number)[])[]) => xs.flat().join('\n') + '\n';

// ---------------------------------------------------------------- coding

const pairSum: SeedQuestion = (() => {
  const r = rng(11);
  const big = (n: number, range: number) => {
    const a = Array.from({ length: n }, () => r.int(-range, range));
    return lines(`${n} ${r.int(-range, range)}`, a.join(' '));
  };
  return {
    slug: 'pair-sum-count',
    type: 'coding',
    title: 'Pair Sum Count',
    difficulty: 'easy',
    tags: ['arrays', 'hashing'],
    visibility: 'public',
    statement: `Given an array of \`n\` integers and a target \`T\`, count the pairs of positions \`i < j\` such that \`a[i] + a[j] = T\`.

### Input
The first line contains \`n\` and \`T\`. The second line contains \`n\` integers \`a[1..n]\`.

### Output
Print the number of pairs.

### Constraints
- \`1 ≤ n ≤ 200 000\`
- \`-10^9 ≤ a[i], T ≤ 10^9\`

> The answer can exceed 32 bits — choose your integer type carefully.`,
    data: {
      limits: { timeMs: 1000, memoryMb: 256 },
      checker: { type: 'tokens' },
      reference: {
        language: 'python',
        code: `import sys
from collections import Counter

def main():
    data = sys.stdin.buffer.read().split()
    n, target = int(data[0]), int(data[1])
    seen = Counter()
    pairs = 0
    for x in map(int, data[2:2 + n]):
        pairs += seen[target - x]
        seen[x] += 1
    print(pairs)

main()
`,
      },
      complexity: {
        expected: 'O(n)',
        sizes: [20000, 40000, 80000, 160000, 320000, 640000],
        generator: `def generate(n):
    t = random.randint(-1000, 1000)
    return f"{n} {t}\\n" + " ".join(str(random.randint(-1000, 1000)) for _ in range(n))`,
      },
    },
    tests: [
      { input: lines('5 6', '1 5 3 3 2'), sample: true, explanation: 'Pairs (1,5) and (3,3) sum to 6.' },
      { input: lines('4 0', '0 0 0 0'), sample: true, explanation: 'Every one of the 6 pairs sums to 0.' },
      { input: lines('1 2', '1') },
      { input: lines('6 -2', '-1 -1 3 -5 0 -2') },
      { input: big(1000, 50) },
      { input: big(200000, 1000), weight: 2 },
      { input: lines('200000 0', Array(200000).fill(0).join(' ')), weight: 2 },
      { input: big(200000, 1_000_000_000), weight: 2 },
    ],
  };
})();

const brackets: SeedQuestion = (() => {
  const r = rng(12);
  const balanced = (n: number): string => {
    if (n === 0) return '';
    const pairs = ['()', '[]', '{}'];
    const p = r.pick(pairs);
    const inner = r.int(0, n - 1);
    return p[0] + balanced(inner) + p[1] + balanced(n - 1 - inner);
  };
  const qs: string[] = [];
  for (let i = 0; i < 300; i++) {
    let s = balanced(r.int(1, 30));
    if (r.next() < 0.5) {
      const k = r.int(0, s.length - 1);
      s = s.slice(0, k) + r.pick(['(', ')', ']', '{', '}']) + s.slice(k + 1);
    }
    qs.push(s);
  }
  return {
    slug: 'balanced-brackets',
    type: 'coding',
    title: 'Balanced Brackets',
    difficulty: 'easy',
    tags: ['stacks', 'strings'],
    visibility: 'public',
    statement: `A string of brackets \`()[]{}\` is *balanced* if every opening bracket is closed by the same type of bracket in the correct order.

For each of \`q\` strings, print \`YES\` if it is balanced and \`NO\` otherwise.

### Input
The first line contains \`q\`. Each of the next \`q\` lines contains a non-empty string of brackets.

### Output
\`q\` lines, each \`YES\` or \`NO\`.

### Constraints
- \`1 ≤ q ≤ 1000\`, each string has length \`≤ 100 000\`, total length \`≤ 10^6\``,
    data: {
      limits: { timeMs: 1000, memoryMb: 256 },
      checker: { type: 'exact' },
      reference: {
        language: 'python',
        code: `import sys

def ok(s):
    match = {')': '(', ']': '[', '}': '{'}
    st = []
    for c in s:
        if c in '([{':
            st.append(c)
        elif not st or st.pop() != match[c]:
            return False
    return not st

lines = sys.stdin.read().split()
q = int(lines[0])
print("\\n".join("YES" if ok(s) else "NO" for s in lines[1:1 + q]))
`,
      },
    },
    tests: [
      { input: lines(3, '{[()]}', '{[(])}', '(('), sample: true, explanation: 'Only the first string closes every bracket in the right order.' },
      { input: lines(2, ')', '()[]{}'), sample: true },
      { input: lines(qs.length, qs), weight: 2 },
      { input: lines(1, '('.repeat(50000) + ')'.repeat(50000)), weight: 2 },
      { input: lines(1, '('.repeat(50000) + ')'.repeat(49999) + ']'), weight: 2 },
    ],
  };
})();

const uniqueStreak: SeedQuestion = (() => {
  const r = rng(13);
  const rand = (n: number, alpha: string) => Array.from({ length: n }, () => alpha[r.int(0, alpha.length - 1)]).join('');
  return {
    slug: 'longest-unique-streak',
    type: 'coding',
    title: 'Longest Unique Streak',
    difficulty: 'medium',
    tags: ['strings', 'sliding-window', 'hashing'],
    visibility: 'public',
    statement: `Find the length of the longest contiguous substring of \`s\` in which no character repeats.

### Input
A single line with the string \`s\` (lowercase letters and digits).

### Output
The length of the longest substring without repeated characters.

### Constraints
- \`1 ≤ |s| ≤ 10^6\``,
    data: {
      limits: { timeMs: 1000, memoryMb: 256 },
      checker: { type: 'tokens' },
      reference: {
        language: 'python',
        code: `import sys
s = sys.stdin.readline().strip()
last = {}
best = start = 0
for i, c in enumerate(s):
    if last.get(c, -1) >= start:
        start = last[c] + 1
    last[c] = i
    best = max(best, i - start + 1)
print(best)
`,
      },
      complexity: {
        expected: 'O(n)',
        sizes: [50000, 100000, 200000, 400000, 800000],
        generator: `def generate(n):
    alpha = "abcdefghijklmnopqrstuvwxyz0123456789"
    return "".join(random.choice(alpha) for _ in range(n))`,
      },
    },
    tests: [
      { input: lines('abcabcbb'), sample: true, explanation: '"abc" has length 3.' },
      { input: lines('pwwkew'), sample: true, explanation: '"wke" has length 3; "pwke" is not contiguous.' },
      { input: lines('a') },
      { input: lines('abcdefghijklmnopqrstuvwxyz0123456789') },
      { input: lines('abba') },
      { input: lines(rand(1000, 'abcde')) },
      { input: lines(rand(1_000_000, 'abcdefghijklmnopqrstuvwxyz0123456789')), weight: 3 },
      { input: lines('z'.repeat(1_000_000)), weight: 2 },
    ],
  };
})();

const mergeIntervals: SeedQuestion = (() => {
  const r = rng(14);
  const gen = (n: number, span: number, len: number) => {
    const out: string[] = [];
    for (let i = 0; i < n; i++) {
      const l = r.int(0, span);
      out.push(`${l} ${l + r.int(0, len)}`);
    }
    return lines(n, out);
  };
  return {
    slug: 'merge-meeting-blocks',
    type: 'coding',
    title: 'Merge Meeting Blocks',
    difficulty: 'medium',
    tags: ['sorting', 'intervals'],
    visibility: 'public',
    statement: `A calendar holds \`n\` busy blocks \`[l, r]\` (inclusive, in minutes). Blocks that overlap **or touch** (\`r1 ≥ l2\`) should be shown as one block.

Print the merged blocks in increasing order of start time.

### Input
The first line contains \`n\`. Each of the next \`n\` lines contains \`l r\`.

### Output
One merged block \`l r\` per line, sorted by \`l\`.

### Constraints
- \`1 ≤ n ≤ 200 000\`, \`0 ≤ l ≤ r ≤ 10^9\``,
    data: {
      limits: { timeMs: 1500, memoryMb: 256 },
      checker: { type: 'exact' },
      reference: {
        language: 'python',
        code: `import sys
d = sys.stdin.buffer.read().split()
n = int(d[0])
iv = sorted((int(d[1 + 2 * i]), int(d[2 + 2 * i])) for i in range(n))
out = []
cl, cr = iv[0]
for l, r in iv[1:]:
    if l <= cr:
        cr = max(cr, r)
    else:
        out.append(f"{cl} {cr}")
        cl, cr = l, r
out.append(f"{cl} {cr}")
print("\\n".join(out))
`,
      },
      complexity: {
        expected: 'O(n log n)',
        sizes: [20000, 40000, 80000, 160000, 320000],
        generator: `def generate(n):
    rows = []
    for _ in range(n):
        l = random.randint(0, 10**9)
        rows.append(f"{l} {l + random.randint(0, 10000)}")
    return f"{n}\\n" + "\\n".join(rows)`,
      },
    },
    tests: [
      { input: lines(4, '1 3', '2 6', '8 10', '15 18'), sample: true, explanation: '[1,3] and [2,6] overlap and merge into [1,6].' },
      { input: lines(2, '1 4', '4 5'), sample: true, explanation: 'Touching blocks merge.' },
      { input: lines(1, '5 5') },
      { input: lines(3, '1 10', '2 3', '4 5') },
      { input: gen(1000, 10000, 50) },
      { input: gen(200000, 1_000_000_000, 10000), weight: 2 },
      { input: gen(200000, 1_000_000, 100), weight: 2 },
    ],
  };
})();

const gridPath: SeedQuestion = (() => {
  const r = rng(15);
  const grid = (R: number, C: number, wall: number) => {
    const g: string[][] = Array.from({ length: R }, () => Array.from({ length: C }, () => (r.next() < wall ? '#' : '.')));
    g[0][0] = 'S';
    g[R - 1][C - 1] = 'E';
    return lines(`${R} ${C}`, g.map((row) => row.join('')));
  };
  return {
    slug: 'warehouse-robot',
    type: 'coding',
    title: 'Warehouse Robot',
    difficulty: 'medium',
    tags: ['graphs', 'bfs', 'grids'],
    visibility: 'public',
    statement: `A robot moves on an \`R × C\` warehouse grid. Each move goes one cell up, down, left or right; it cannot enter shelves (\`#\`) or leave the grid.

Print the minimum number of moves from \`S\` to \`E\`, or \`-1\` if \`E\` is unreachable.

### Input
The first line contains \`R C\`, followed by \`R\` lines of \`C\` characters each (\`.\`, \`#\`, \`S\`, \`E\`). There is exactly one \`S\` and one \`E\`.

### Constraints
- \`1 ≤ R, C ≤ 1000\``,
    data: {
      limits: { timeMs: 2000, memoryMb: 256 },
      checker: { type: 'tokens' },
      reference: {
        language: 'python',
        code: `import sys
from collections import deque
def main():
    data = sys.stdin.buffer.read().split()
    R, C = int(data[0]), int(data[1])
    g = b"".join(data[2:2 + R])
    s = g.index(b"S"); e = g.index(b"E")
    dist = [-1] * (R * C)
    dist[s] = 0
    q = deque([s])
    while q:
        u = q.popleft()
        if u == e:
            break
        r, c = divmod(u, C)
        d = dist[u] + 1
        for v, ok in ((u - C, r > 0), (u + C, r < R - 1), (u - 1, c > 0), (u + 1, c < C - 1)):
            if ok and dist[v] < 0 and g[v] != 35:
                dist[v] = d
                q.append(v)
    print(dist[e])
main()
`,
      },
    },
    tests: [
      { input: lines('3 4', 'S.#.', '..#.', '...E'), sample: true, explanation: 'Go down twice, then right three times: 5 moves.' },
      { input: lines('2 2', 'S#', '#E'), sample: true, explanation: 'E is walled off.' },
      { input: lines('1 2', 'SE') },
      { input: grid(30, 30, 0.25) },
      { input: grid(200, 300, 0.3) },
      { input: grid(1000, 1000, 0.2), weight: 3 },
      { input: grid(1000, 1000, 0.45), weight: 2 },
    ],
  };
})();

const coinWays: SeedQuestion = {
  slug: 'change-making-ways',
  type: 'coding',
  title: 'Change-Making Ways',
  difficulty: 'medium',
  tags: ['dynamic-programming'],
  visibility: 'public',
  statement: `A vending machine has \`n\` coin denominations (unlimited supply of each). In how many different ways can it pay exactly \`A\`? Two ways are the same if they use the same multiset of coins.

Print the answer modulo \`1 000 000 007\`.

### Input
The first line contains \`n A\`; the second line contains the \`n\` distinct denominations.

### Constraints
- \`1 ≤ n ≤ 100\`, \`0 ≤ A ≤ 100 000\`, \`1 ≤ coin ≤ 100 000\``,
  data: {
    limits: { timeMs: 2000, memoryMb: 256 },
    checker: { type: 'tokens' },
    reference: {
      language: 'python',
      code: `import sys
d = sys.stdin.read().split()
n, A = int(d[0]), int(d[1])
coins = list(map(int, d[2:2 + n]))
M = 10**9 + 7
ways = [0] * (A + 1)
ways[0] = 1
for c in coins:
    for v in range(c, A + 1):
        ways[v] = (ways[v] + ways[v - c]) % M
print(ways[A])
`,
    },
  },
  tests: [
    { input: lines('3 5', '1 2 5'), sample: true, explanation: '5, 2+2+1, 2+1+1+1, 1×5.' },
    { input: lines('1 3', '2'), sample: true },
    { input: lines('2 0', '3 7'), explanation: 'Paying 0 has exactly one way: no coins.' },
    { input: lines('4 100', '1 5 10 25') },
    { input: lines('10 10000', '1 2 5 10 20 50 100 200 500 1000'), weight: 2 },
    { input: lines('100 100000', Array.from({ length: 100 }, (_, i) => i * 7 + 3).join(' ')), weight: 3 },
  ],
};

const lis: SeedQuestion = (() => {
  const r = rng(16);
  const arr = (n: number, hi: number) => lines(n, Array.from({ length: n }, () => r.int(1, hi)).join(' '));
  return {
    slug: 'longest-rising-trend',
    type: 'coding',
    title: 'Longest Rising Trend',
    difficulty: 'hard',
    tags: ['dynamic-programming', 'binary-search'],
    visibility: 'public',
    statement: `A stock's daily prices are \`p[1..n]\`. A *rising trend* is a subsequence (not necessarily contiguous) of days with **strictly increasing** prices.

Print the length of the longest rising trend.

### Input
The first line contains \`n\`, the second line the \`n\` prices.

### Constraints
- \`1 ≤ n ≤ 200 000\`, \`1 ≤ p[i] ≤ 10^9\`

> A quadratic algorithm will not pass the large tests. The complexity analyzer expects **O(n log n)**.`,
    data: {
      limits: { timeMs: 1500, memoryMb: 256 },
      checker: { type: 'tokens' },
      reference: {
        language: 'python',
        code: `import sys
from bisect import bisect_left
d = sys.stdin.buffer.read().split()
n = int(d[0])
tails = []
for x in map(int, d[1:1 + n]):
    i = bisect_left(tails, x)
    if i == len(tails):
        tails.append(x)
    else:
        tails[i] = x
print(len(tails))
`,
      },
      knownSolutions: [
        {
          language: 'cpp',
          code: `#include <bits/stdc++.h>
using namespace std;
int main(){int n;scanf("%d",&n);vector<int>d;for(int i=0;i<n;i++){int x;scanf("%d",&x);auto it=lower_bound(d.begin(),d.end(),x);if(it==d.end())d.push_back(x);else *it=x;}printf("%d\\n",(int)d.size());}`,
        },
      ],
      complexity: {
        expected: 'O(n log n)',
        sizes: [10000, 20000, 40000, 80000, 160000],
        generator: `def generate(n):
    return f"{n}\\n" + " ".join(str(random.randint(1, 10**9)) for _ in range(n))`,
      },
    },
    tests: [
      { input: lines(8, '10 9 2 5 3 7 101 18'), sample: true, explanation: 'One longest trend is 2, 3, 7, 101.' },
      { input: lines(5, '7 7 7 7 7'), sample: true, explanation: 'Prices must strictly increase.' },
      { input: lines(1, '42') },
      { input: lines(6, '1 2 3 4 5 6') },
      { input: arr(2000, 1000) },
      { input: arr(200000, 1_000_000_000), weight: 3 },
      { input: lines(200000, Array.from({ length: 200000 }, (_, i) => i + 1).join(' ')), weight: 2 },
    ],
  };
})();

const dijkstra: SeedQuestion = (() => {
  const r = rng(17);
  const graph = (n: number, m: number, wmax: number) => {
    const e: string[] = [];
    for (let i = 2; i <= n; i++) if (r.next() < 0.9) e.push(`${r.int(1, i - 1)} ${i} ${r.int(1, wmax)}`);
    while (e.length < m) e.push(`${r.int(1, n)} ${r.int(1, n)} ${r.int(1, wmax)}`);
    return lines(`${n} ${e.length}`, e);
  };
  return {
    slug: 'delivery-routes',
    type: 'coding',
    title: 'Delivery Routes',
    difficulty: 'hard',
    tags: ['graphs', 'shortest-paths', 'heaps'],
    visibility: 'public',
    statement: `A courier network has \`n\` hubs and \`m\` **two-way** roads with travel times. The depot is hub \`1\`.

For every hub, print the minimum travel time from the depot, or \`-1\` if it cannot be reached.

### Input
The first line contains \`n m\`. Each of the next \`m\` lines contains \`u v w\`: a road between \`u\` and \`v\` taking \`w\` minutes.

### Output
\`n\` space-separated integers.

### Constraints
- \`1 ≤ n ≤ 100 000\`, \`0 ≤ m ≤ 200 000\`, \`1 ≤ w ≤ 10^9\` (distances may exceed 32 bits)`,
    data: {
      limits: { timeMs: 2000, memoryMb: 256 },
      checker: { type: 'tokens' },
      reference: {
        language: 'python',
        code: `import sys, heapq
def main():
    d = sys.stdin.buffer.read().split()
    n, m = int(d[0]), int(d[1])
    adj = [[] for _ in range(n + 1)]
    for i in range(m):
        u, v, w = int(d[2 + 3 * i]), int(d[3 + 3 * i]), int(d[4 + 3 * i])
        adj[u].append((v, w)); adj[v].append((u, w))
    INF = float("inf")
    dist = [INF] * (n + 1)
    dist[1] = 0
    pq = [(0, 1)]
    while pq:
        du, u = heapq.heappop(pq)
        if du > dist[u]:
            continue
        for v, w in adj[u]:
            nd = du + w
            if nd < dist[v]:
                dist[v] = nd
                heapq.heappush(pq, (nd, v))
    print(" ".join(str(x) if x != INF else "-1" for x in dist[1:]))
main()
`,
      },
    },
    tests: [
      { input: lines('4 4', '1 2 5', '1 3 2', '3 2 1', '2 4 10'), sample: true, explanation: 'Hub 2 is fastest via hub 3: 2 + 1 = 3.' },
      { input: lines('3 1', '1 2 7'), sample: true, explanation: 'Hub 3 is unreachable.' },
      { input: lines('1 0') },
      { input: lines('2 2', '1 2 1000000000', '1 2 999999999') },
      { input: graph(200, 600, 100) },
      { input: graph(100000, 200000, 1_000_000_000), weight: 3 },
      { input: graph(100000, 120000, 10), weight: 2 },
    ],
  };
})();

const islands: SeedQuestion = (() => {
  const r = rng(18);
  const grid = (R: number, C: number, p: number) =>
    lines(`${R} ${C}`, Array.from({ length: R }, () => Array.from({ length: C }, () => (r.next() < p ? '1' : '0')).join('')));
  return {
    slug: 'count-islands',
    type: 'coding',
    title: 'Count the Islands',
    difficulty: 'easy',
    tags: ['graphs', 'grids', 'dfs'],
    visibility: 'public',
    statement: `A satellite map is an \`R × C\` grid of \`1\` (land) and \`0\` (water). An island is a group of land cells connected horizontally or vertically.

Print the number of islands.

### Input
\`R C\` followed by \`R\` lines of \`C\` digits.

### Constraints
- \`1 ≤ R, C ≤ 1000\`

> Recursive flood fill can overflow the stack on large islands — consider an explicit stack or BFS.`,
    data: {
      limits: { timeMs: 2000, memoryMb: 256 },
      checker: { type: 'tokens' },
      reference: {
        language: 'python',
        code: `import sys
def main():
    d = sys.stdin.buffer.read().split()
    R, C = int(d[0]), int(d[1])
    g = bytearray(b"".join(d[2:2 + R]))
    count = 0
    for s in range(R * C):
        if g[s] != 49:
            continue
        count += 1
        g[s] = 48
        st = [s]
        while st:
            u = st.pop()
            r, c = divmod(u, C)
            if r > 0 and g[u - C] == 49: g[u - C] = 48; st.append(u - C)
            if r < R - 1 and g[u + C] == 49: g[u + C] = 48; st.append(u + C)
            if c > 0 and g[u - 1] == 49: g[u - 1] = 48; st.append(u - 1)
            if c < C - 1 and g[u + 1] == 49: g[u + 1] = 48; st.append(u + 1)
    print(count)
main()
`,
      },
    },
    tests: [
      { input: lines('4 5', '11000', '11000', '00100', '00011'), sample: true, explanation: 'Three separate islands.' },
      { input: lines('1 1', '0'), sample: true },
      { input: grid(20, 20, 0.4) },
      { input: grid(300, 300, 0.5) },
      { input: grid(1000, 1000, 0.45), weight: 2 },
      { input: lines('1000 1000', Array(1000).fill('1'.repeat(1000))), weight: 2 },
    ],
  };
})();

const runningMedian: SeedQuestion = (() => {
  const r = rng(19);
  const arr = (n: number) => lines(n, Array.from({ length: n }, () => r.int(-1_000_000, 1_000_000)));
  return {
    slug: 'running-median',
    type: 'coding',
    title: 'Live Latency Median',
    difficulty: 'hard',
    tags: ['heaps', 'data-structures'],
    visibility: 'public',
    statement: `A monitoring service receives request latencies one at a time. After each new value, report the **median** of all values received so far. For an even count, report the *lower* of the two middle values.

### Input
\`n\`, followed by \`n\` integers, one per line.

### Output
\`n\` lines: the median after each value.

### Constraints
- \`1 ≤ n ≤ 200 000\`, \`|value| ≤ 10^6\``,
    data: {
      limits: { timeMs: 1500, memoryMb: 256 },
      checker: { type: 'tokens' },
      reference: {
        language: 'python',
        code: `import sys, heapq
d = sys.stdin.buffer.read().split()
n = int(d[0])
lo, hi = [], []  # lo: max-heap (negated), hi: min-heap
out = []
for x in map(int, d[1:1 + n]):
    if lo and x > -lo[0]:
        heapq.heappush(hi, x)
    else:
        heapq.heappush(lo, -x)
    if len(lo) > len(hi) + 1:
        heapq.heappush(hi, -heapq.heappop(lo))
    elif len(hi) > len(lo):
        heapq.heappush(lo, -heapq.heappop(hi))
    out.append(-lo[0])
print("\\n".join(map(str, out)))
`,
      },
      complexity: {
        expected: 'O(n log n)',
        sizes: [10000, 20000, 40000, 80000, 160000],
        generator: `def generate(n):
    return f"{n}\\n" + "\\n".join(str(random.randint(-10**6, 10**6)) for _ in range(n))`,
      },
    },
    tests: [
      { input: lines(5, 5, 15, 1, 3, 8), sample: true, explanation: 'Medians of [5], [5,15], [1,5,15], [1,3,5,15], [1,3,5,8,15].' },
      { input: lines(1, -4), sample: true },
      { input: lines(4, 2, 2, 2, 2) },
      { input: arr(1000) },
      { input: arr(200000), weight: 3 },
      { input: lines(200000, Array.from({ length: 200000 }, (_, i) => 200000 - i)), weight: 2 },
    ],
  };
})();

const polygonArea: SeedQuestion = (() => {
  const r = rng(20);
  const regular = (n: number, R: number) =>
    lines(n, Array.from({ length: n }, (_, i) => `${(R * Math.cos((2 * Math.PI * i) / n)).toFixed(6)} ${(R * Math.sin((2 * Math.PI * i) / n)).toFixed(6)}`));
  const star = (n: number) => {
    const pts = Array.from({ length: n }, (_, i) => {
      const a = (2 * Math.PI * i) / n;
      const rad = r.int(100, 10000) / 10;
      return `${(rad * Math.cos(a)).toFixed(3)} ${(rad * Math.sin(a)).toFixed(3)}`;
    });
    return lines(n, pts);
  };
  return {
    slug: 'land-plot-area',
    type: 'coding',
    title: 'Land Plot Area',
    difficulty: 'easy',
    tags: ['math', 'geometry'],
    visibility: 'public',
    statement: `A surveyor walks around a land plot and records its \`n\` corners in order (clockwise or counter-clockwise). The boundary does not cross itself.

Print the plot's area. Answers within an absolute or relative error of \`10^-6\` are accepted.

### Input
\`n\`, then \`n\` lines with real coordinates \`x y\`.

### Constraints
- \`3 ≤ n ≤ 100 000\`, \`|x|, |y| ≤ 10^4\``,
    data: {
      limits: { timeMs: 1000, memoryMb: 256 },
      checker: { type: 'float', tolerance: 1e-6 },
      reference: {
        language: 'python',
        code: `import sys
d = sys.stdin.read().split()
n = int(d[0])
xs = [float(d[1 + 2 * i]) for i in range(n)]
ys = [float(d[2 + 2 * i]) for i in range(n)]
s = 0.0
for i in range(n):
    j = (i + 1) % n
    s += xs[i] * ys[j] - xs[j] * ys[i]
print(f"{abs(s) / 2:.6f}")
`,
      },
    },
    tests: [
      { input: lines(4, '0 0', '4 0', '4 3', '0 3'), sample: true, explanation: 'A 4 × 3 rectangle.' },
      { input: lines(3, '0 0', '1 0', '0 1'), sample: true },
      { input: lines(4, '0 0', '0 3', '4 3', '4 0'), explanation: 'Clockwise order gives the same area.' },
      { input: lines(5, '0 0', '2 0', '2 2', '1 1', '0 2') },
      { input: regular(1000, 5000) },
      { input: star(100000), weight: 2 },
    ],
  };
})();

const topoOrder: SeedQuestion = (() => {
  const r = rng(21);
  const dag = (n: number, m: number, cyclic: boolean) => {
    const perm = Array.from({ length: n }, (_, i) => i + 1).sort(() => r.next() - 0.5);
    const e: string[] = [];
    for (let k = 0; k < m; k++) {
      let i = r.int(0, n - 2);
      let j = r.int(i + 1, n - 1);
      e.push(`${perm[i]} ${perm[j]}`);
    }
    if (cyclic) e.push(`${perm[n - 1]} ${perm[0]}`, `${perm[0]} ${perm[Math.floor(n / 2)]}`);
    return lines(`${n} ${e.length}`, e);
  };
  return {
    slug: 'build-order',
    type: 'coding',
    title: 'Build Order',
    difficulty: 'medium',
    tags: ['graphs', 'topological-sort'],
    visibility: 'public',
    statement: `A build system has \`n\` packages and \`m\` dependency rules \`a b\` meaning *package \`a\` must be built before package \`b\`*.

Print **any** valid build order as \`n\` space-separated package numbers, or \`IMPOSSIBLE\` if the rules contain a cycle.

### Input
\`n m\`, then \`m\` lines \`a b\`.

### Constraints
- \`1 ≤ n ≤ 100 000\`, \`0 ≤ m ≤ 200 000\`

> Many orders can be correct — this question uses a custom checker that verifies your order against every rule.`,
    data: {
      limits: { timeMs: 2000, memoryMb: 256 },
      checker: {
        type: 'custom',
        code: `def check(input_text, expected, output):
    data = input_text.split()
    n, m = int(data[0]), int(data[1])
    out = output.split()
    if expected.strip() == "IMPOSSIBLE":
        return (out == ["IMPOSSIBLE"], "the rules contain a cycle")
    if out == ["IMPOSSIBLE"]:
        return (False, "a valid order exists")
    if len(out) != n:
        return (False, f"expected {n} packages, got {len(out)}")
    try:
        order = [int(x) for x in out]
    except ValueError:
        return (False, "output must contain integers")
    if sorted(order) != list(range(1, n + 1)):
        return (False, "output is not a permutation of 1..n")
    pos = [0] * (n + 1)
    for i, p in enumerate(order):
        pos[p] = i
    for k in range(m):
        a, b = int(data[2 + 2 * k]), int(data[3 + 2 * k])
        if pos[a] > pos[b]:
            return (False, f"package {a} must come before {b}")
    return True`,
      },
      reference: {
        language: 'python',
        code: `import sys
from collections import deque
d = sys.stdin.buffer.read().split()
n, m = int(d[0]), int(d[1])
adj = [[] for _ in range(n + 1)]
indeg = [0] * (n + 1)
for i in range(m):
    a, b = int(d[2 + 2 * i]), int(d[3 + 2 * i])
    adj[a].append(b); indeg[b] += 1
q = deque(i for i in range(1, n + 1) if indeg[i] == 0)
order = []
while q:
    u = q.popleft(); order.append(u)
    for v in adj[u]:
        indeg[v] -= 1
        if indeg[v] == 0:
            q.append(v)
print(" ".join(map(str, order)) if len(order) == n else "IMPOSSIBLE")
`,
      },
    },
    tests: [
      { input: lines('4 3', '1 2', '1 3', '3 4'), sample: true, explanation: '1 2 3 4 and 1 3 2 4 (and more) are all valid.' },
      { input: lines('3 3', '1 2', '2 3', '3 1'), sample: true, explanation: 'The rules form a cycle.' },
      { input: lines('1 0') },
      { input: lines('2 1', '2 1') },
      { input: dag(500, 2000, false) },
      { input: dag(500, 2000, true) },
      { input: dag(100000, 200000, false), weight: 2 },
      { input: dag(100000, 199998, true), weight: 2 },
    ],
  };
})();

const anagrams: SeedQuestion = (() => {
  const r = rng(22);
  const words = (n: number) => {
    const bases = Array.from({ length: Math.max(1, Math.floor(n / 4)) }, () =>
      Array.from({ length: r.int(3, 8) }, () => 'abcdefghij'[r.int(0, 9)]).join(''));
    const out = new Set<string>();
    while (out.size < n) {
      const b = r.pick(bases).split('').sort(() => r.next() - 0.5).join('');
      out.add(b);
    }
    return lines(out.size, [...out]);
  };
  return {
    slug: 'anagram-buckets',
    type: 'coding',
    title: 'Anagram Buckets',
    difficulty: 'medium',
    tags: ['hashing', 'strings', 'sorting'],
    visibility: 'public',
    statement: `Group \`n\` distinct lowercase words into buckets of anagrams (words using exactly the same letters).

Print one bucket per line with its words sorted alphabetically and separated by single spaces. Buckets may be printed **in any order**.

### Input
\`n\`, followed by \`n\` words.

### Constraints
- \`1 ≤ n ≤ 100 000\`, each word has length \`1..20\``,
    data: {
      limits: { timeMs: 1500, memoryMb: 256 },
      checker: { type: 'unordered' },
      reference: {
        language: 'python',
        code: `import sys
from collections import defaultdict
d = sys.stdin.read().split()
n = int(d[0])
groups = defaultdict(list)
for w in d[1:1 + n]:
    groups["".join(sorted(w))].append(w)
print("\\n".join(" ".join(sorted(g)) for g in groups.values()))
`,
      },
    },
    tests: [
      { input: lines(6, 'listen', 'silent', 'enlist', 'google', 'gogole', 'cat'), sample: true, explanation: 'Any bucket order is accepted.' },
      { input: lines(1, 'a'), sample: true },
      { input: words(50) },
      { input: words(2000) },
      { input: words(100000), weight: 3 },
    ],
  };
})();

const rateLimiter: SeedQuestion = (() => {
  const r = rng(23);
  const gen = (n: number, users: number, k: number, w: number, gap: number) => {
    let t = 0;
    const out: string[] = [];
    for (let i = 0; i < n; i++) {
      t += r.int(0, gap);
      out.push(`${t} u${r.int(1, users)}`);
    }
    return lines(`${n} ${k} ${w}`, out);
  };
  return {
    slug: 'sliding-window-rate-limiter',
    type: 'coding',
    title: 'Sliding Window Rate Limiter',
    difficulty: 'medium',
    tags: ['queues', 'hashing', 'system-design'],
    visibility: 'private',
    statement: `You are implementing an API gateway's rate limiter. Each user may make at most \`k\` **allowed** requests in any window of \`w\` seconds.

A request from user \`u\` at time \`t\` is allowed if fewer than \`k\` of \`u\`'s previously **allowed** requests happened in \`(t - w, t]\`. Denied requests do not count toward the limit.

Requests arrive in non-decreasing time order. For each request print \`ALLOW\` or \`DENY\`.

### Input
\`n k w\`, then \`n\` lines \`t user\` (user ids are alphanumeric strings).

### Constraints
- \`1 ≤ n ≤ 200 000\`, \`1 ≤ k ≤ 1000\`, \`1 ≤ w ≤ 10^9\`, \`0 ≤ t ≤ 10^12\``,
    data: {
      limits: { timeMs: 1500, memoryMb: 256 },
      checker: { type: 'exact' },
      reference: {
        language: 'python',
        code: `import sys
from collections import defaultdict, deque

def main():
    data = sys.stdin.buffer.read().split()
    n, k, w = int(data[0]), int(data[1]), int(data[2])
    history = defaultdict(deque)
    out = []
    for i in range(n):
        t = int(data[3 + 2 * i])
        user = data[4 + 2 * i]
        window = history[user]
        while window and window[0] <= t - w:
            window.popleft()
        if len(window) < k:
            window.append(t)
            out.append("ALLOW")
        else:
            out.append("DENY")
    sys.stdout.write("\\n".join(out) + "\\n")

main()
`,
      },
      complexity: {
        expected: 'O(n)',
        sizes: [20000, 40000, 80000, 160000, 320000],
        generator: `def generate(n):
    t = 0
    rows = []
    for _ in range(n):
        t += random.randint(0, 3)
        rows.append(f"{t} u{random.randint(1, 50)}")
    return f"{n} 5 10\\n" + "\\n".join(rows)`,
      },
    },
    tests: [
      { input: lines('6 2 10', '1 alice', '2 alice', '3 alice', '5 bob', '11 alice', '12 alice'), sample: true, explanation: "alice's 3rd request is denied; at t=11 the request from t=1 has left the window (11-10 = 1 is excluded)." },
      { input: lines('3 1 5', '0 x', '5 x', '9 x'), sample: true },
      { input: lines('4 3 1', '7 a', '7 a', '7 a', '7 a') },
      { input: gen(200, 3, 2, 10, 3) },
      { input: gen(5000, 20, 5, 100, 10) },
      { input: gen(200000, 1000, 10, 1000, 2), weight: 3 },
      { input: gen(200000, 1, 1000, 1_000_000_000, 5000), weight: 2 },
    ],
  };
})();

// ---------------------------------------------------------------- SQL

const shopSchema = `CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT NOT NULL, city TEXT NOT NULL);
CREATE TABLE orders (id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL REFERENCES customers(id), amount REAL NOT NULL, created_at TEXT NOT NULL);`;

function shopData(seed: number, nc: number, no: number) {
  const r = rng(seed);
  const names = ['Avery', 'Blake', 'Casey', 'Devon', 'Emery', 'Finley', 'Harper', 'Jordan', 'Kai', 'Logan', 'Morgan', 'Parker', 'Quinn', 'Reese', 'Rowan', 'Sage', 'Taylor', 'Wren'];
  const cities = ['Austin', 'Berlin', 'Chennai', 'Lagos', 'Lima', 'Osaka', 'Oslo', 'Toronto'];
  const cs = Array.from({ length: nc }, (_, i) => `(${i + 1}, '${names[i % names.length]}${i >= names.length ? ' ' + (Math.floor(i / names.length) + 1) : ''}', '${r.pick(cities)}')`);
  const os = Array.from({ length: no }, (_, i) => {
    const m = r.int(1, 12);
    const d = r.int(1, 28);
    return `(${i + 1}, ${r.int(1, Math.max(1, Math.floor(nc * 0.7)))}, ${(r.int(500, 50000) / 100).toFixed(2)}, '2025-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}')`;
  });
  return `INSERT INTO customers VALUES ${cs.join(', ')};\n${os.length ? `INSERT INTO orders VALUES ${os.join(', ')};` : ''}`;
}

const customersWithoutOrders: SeedQuestion = {
  slug: 'customers-without-orders',
  type: 'sql',
  title: 'Customers Without Orders',
  difficulty: 'easy',
  tags: ['sql', 'joins'],
  visibility: 'public',
  statement: `The marketing team wants to re-engage customers who have **never** placed an order.

Return the \`name\` and \`city\` of every such customer, ordered by \`name\`.

Tables:
- \`customers(id, name, city)\`
- \`orders(id, customer_id, amount, created_at)\``,
  data: {
    schema: shopSchema,
    ordered: true,
    solution: `SELECT c.name, c.city FROM customers c LEFT JOIN orders o ON o.customer_id = c.id WHERE o.id IS NULL ORDER BY c.name`,
  },
  tests: [
    {
      input: `INSERT INTO customers VALUES (1,'Ana','Lima'),(2,'Bo','Oslo'),(3,'Cy','Osaka');\nINSERT INTO orders VALUES (1,1,20.0,'2025-01-02'),(2,1,5.5,'2025-02-01');`,
      sample: true,
    },
    { input: shopData(31, 40, 60) },
    { input: shopData(32, 300, 1500), weight: 2 },
    { input: `INSERT INTO customers VALUES (1,'Zed','Oslo'),(2,'Amy','Lima');`, explanation: 'No orders at all.' },
  ],
};

const revenueGrowth: SeedQuestion = {
  slug: 'monthly-revenue-growth',
  type: 'sql',
  title: 'Monthly Revenue Growth',
  difficulty: 'hard',
  tags: ['sql', 'window-functions', 'aggregation'],
  visibility: 'public',
  statement: `Finance needs month-over-month growth. For each month (\`YYYY-MM\`) that has at least one order, return:

| column | meaning |
|---|---|
| \`month\` | \`YYYY-MM\` |
| \`revenue\` | total order amount that month, rounded to 2 decimals |
| \`growth_pct\` | percentage change vs. the **previous month with orders**, rounded to 1 decimal; \`NULL\` for the first month |

Order by \`month\`.

Tables: \`orders(id, customer_id, amount, created_at)\` where \`created_at\` is \`YYYY-MM-DD\`.`,
  data: {
    schema: shopSchema,
    ordered: true,
    solution: `WITH m AS (
  SELECT substr(created_at, 1, 7) AS month, SUM(amount) AS revenue FROM orders GROUP BY 1
)
SELECT month, ROUND(revenue, 2) AS revenue,
  ROUND((revenue - LAG(revenue) OVER (ORDER BY month)) * 100.0 / LAG(revenue) OVER (ORDER BY month), 1) AS growth_pct
FROM m ORDER BY month`,
  },
  tests: [
    {
      input: `INSERT INTO customers VALUES (1,'Ana','Lima');\nINSERT INTO orders VALUES (1,1,100,'2025-01-05'),(2,1,50,'2025-01-20'),(3,1,300,'2025-02-11'),(4,1,150,'2025-04-01');`,
      sample: true,
      explanation: 'Jan = 150, Feb = 300 (+100%), Apr = 150 (−50% vs Feb; March had no orders).',
    },
    { input: shopData(33, 30, 200) },
    { input: shopData(34, 100, 3000), weight: 2 },
  ],
};

const hrSchema = `CREATE TABLE departments (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE employees (id INTEGER PRIMARY KEY, name TEXT NOT NULL, dept_id INTEGER NOT NULL REFERENCES departments(id), salary INTEGER NOT NULL);`;

function hrData(seed: number, ne: number) {
  const r = rng(seed);
  const depts = ['Engineering', 'Design', 'Sales', 'Support', 'Finance'];
  const first = ['Ari', 'Bea', 'Cal', 'Dee', 'Eli', 'Fay', 'Gus', 'Hal', 'Ivy', 'Jo', 'Kit', 'Lou', 'Max', 'Nia', 'Oz', 'Pia'];
  const es = Array.from({ length: ne }, (_, i) => `(${i + 1}, '${first[i % first.length]} ${String.fromCharCode(65 + (i % 26))}${i}', ${r.int(1, depts.length)}, ${r.int(40, 200) * 1000})`);
  return `INSERT INTO departments VALUES ${depts.map((d, i) => `(${i + 1}, '${d}')`).join(', ')};\nINSERT INTO employees VALUES ${es.join(', ')};`;
}

const topEarners: SeedQuestion = {
  slug: 'top-earners-by-department',
  type: 'sql',
  title: 'Top Earners by Department',
  difficulty: 'medium',
  tags: ['sql', 'window-functions'],
  visibility: 'private',
  statement: `For the compensation review, list the employees earning one of the **top two distinct salaries** in their department (ties included).

Return \`department\`, \`employee\`, \`salary\` ordered by \`department\`, then \`salary\` descending, then \`employee\`.

Tables:
- \`departments(id, name)\`
- \`employees(id, name, dept_id, salary)\``,
  data: {
    schema: hrSchema,
    ordered: true,
    solution: `SELECT department, employee, salary FROM (
  SELECT d.name AS department, e.name AS employee, e.salary,
         DENSE_RANK() OVER (PARTITION BY e.dept_id ORDER BY e.salary DESC) AS rnk
  FROM employees e JOIN departments d ON d.id = e.dept_id
) WHERE rnk <= 2 ORDER BY department, salary DESC, employee`,
  },
  tests: [
    {
      input: `INSERT INTO departments VALUES (1,'Eng'),(2,'Ops');\nINSERT INTO employees VALUES (1,'Ann',1,150000),(2,'Ben',1,120000),(3,'Cat',1,150000),(4,'Dan',1,90000),(5,'Eve',2,70000);`,
      sample: true,
      explanation: 'Ann and Cat tie for the top Eng salary; Ben has the second distinct salary.',
    },
    { input: hrData(41, 60) },
    { input: hrData(42, 800), weight: 2 },
  ],
};

// ---------------------------------------------------------------- MCQ

const mcq = (
  slug: string, title: string, difficulty: SeedQuestion['difficulty'], tags: string[], statement: string,
  options: string[], correct: number[], explanation: string, visibility: SeedQuestion['visibility'] = 'public',
): SeedQuestion => ({
  slug, type: 'mcq', title, difficulty, tags, visibility, statement, tests: [],
  data: {
    options: options.map((text, i) => ({ id: String.fromCharCode(97 + i), text })),
    correct: correct.map((i) => String.fromCharCode(97 + i)),
    multiple: correct.length > 1,
    explanation,
  },
});

const mcqs: SeedQuestion[] = [
  mcq('where-vs-having', 'WHERE vs HAVING', 'easy', ['sql'],
    'In a query with `GROUP BY`, what is the difference between `WHERE` and `HAVING`?',
    ['They are interchangeable', '`WHERE` filters rows before grouping; `HAVING` filters groups after aggregation', '`HAVING` filters rows before grouping; `WHERE` filters groups after aggregation', '`HAVING` can only be used with `ORDER BY`'],
    [1], '`WHERE` runs before aggregation so it cannot reference aggregates such as `COUNT(*)`; `HAVING` filters the aggregated groups.'),
  mcq('closure-in-loop', 'Closures in a Loop', 'medium', ['javascript'],
    'What does this print?\n\n```js\nfor (var i = 0; i < 3; i++) {\n  setTimeout(() => console.log(i), 0);\n}\n```',
    ['`0 1 2`', '`3 3 3`', '`undefined` three times', '`0 0 0`'],
    [1], '`var` is function-scoped, so all three callbacks share one `i`, which is 3 by the time they run. `let` would create a new binding per iteration.'),
  mcq('mutable-default-argument', 'Mutable Default Argument', 'medium', ['python'],
    'What is printed?\n\n```python\ndef add(x, acc=[]):\n    acc.append(x)\n    return acc\n\nadd(1)\nprint(add(2))\n```',
    ['`[2]`', '`[1, 2]`', '`[1]`', 'A `TypeError`'],
    [1], 'Default values are evaluated once, when the function is defined, so every call without `acc` shares the same list.'),
  mcq('idempotent-http-methods', 'Idempotent HTTP Methods', 'easy', ['http', 'system-design'],
    'Which HTTP methods are **idempotent** by specification? (Select all that apply.)',
    ['`GET`', '`POST`', '`PUT`', '`DELETE`'],
    [0, 2, 3], 'Repeating `GET`, `PUT` or `DELETE` leaves the server in the same state as doing it once. `POST` is not idempotent.'),
  mcq('binary-search-complexity', 'Binary Search Cost', 'easy', ['algorithms', 'complexity'],
    'What is the worst-case time complexity of binary search on a sorted array of `n` elements?',
    ['`O(1)`', '`O(log n)`', '`O(n)`', '`O(n log n)`'],
    [1], 'Each comparison halves the remaining range.'),
  mcq('cap-partition', 'Partitions and Consistency', 'hard', ['system-design', 'distributed-systems'],
    'During a network partition, a replicated database keeps accepting writes on both sides and reconciles later. Which property did it give up?',
    ['Availability', 'Partition tolerance', 'Strong (linearizable) consistency', 'Durability'],
    [2], 'Staying available on both sides of a partition means reads can observe divergent states, so linearizable consistency is sacrificed (an AP choice under CAP).'),
  mcq('stable-sort', 'Stable Sorting', 'medium', ['algorithms', 'sorting'],
    'Which of these sorting algorithms are **stable** in their standard form? (Select all that apply.)',
    ['Merge sort', 'Quicksort (Lomuto partition)', 'Insertion sort', 'Heapsort'],
    [0, 2], 'Merge sort and insertion sort never move equal elements past each other; textbook quicksort and heapsort can.'),
];

export const PROBLEMS: SeedQuestion[] = [
  pairSum, brackets, polygonArea, islands, uniqueStreak, mergeIntervals, gridPath, coinWays, topoOrder, anagrams,
  lis, dijkstra, runningMedian, rateLimiter, customersWithoutOrders, revenueGrowth, topEarners, ...mcqs,
];
