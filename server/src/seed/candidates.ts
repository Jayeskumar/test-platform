/** Simulated candidates for the demo assessment. Their code is judged for real at seed time. */

type CodeAnswer = { language: string; code: string; startMin: number; finishMin: number; pasted?: boolean };
type ChoiceAnswer = { choice: string | string[] };

export interface DemoCandidate {
  name: string;
  email: string;
  submitMin: number;
  answers: Record<string, CodeAnswer | ChoiceAnswer>;
  events: { type: string; min: number; slug?: string; detail?: Record<string, unknown> }[];
}

const adaPairSum = `#include <bits/stdc++.h>
using namespace std;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    int n;
    long long target;
    cin >> n >> target;
    unordered_map<long long, long long> freq;
    freq.reserve(n * 2);
    long long pairs = 0;
    for (int i = 0; i < n; i++) {
        long long x;
        cin >> x;
        auto it = freq.find(target - x);
        if (it != freq.end()) pairs += it->second;
        freq[x]++;
    }
    cout << pairs << "\\n";
    return 0;
}
`;

const adaRateLimiter = `import java.io.*;
import java.util.*;

public class Main {
    public static void main(String[] args) throws IOException {
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in), 1 << 16);
        StringTokenizer header = new StringTokenizer(br.readLine());
        int n = Integer.parseInt(header.nextToken());
        int limit = Integer.parseInt(header.nextToken());
        long window = Long.parseLong(header.nextToken());
        Map<String, ArrayDeque<Long>> allowed = new HashMap<>();
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < n; i++) {
            StringTokenizer st = new StringTokenizer(br.readLine());
            long t = Long.parseLong(st.nextToken());
            ArrayDeque<Long> recent = allowed.computeIfAbsent(st.nextToken(), k -> new ArrayDeque<>());
            while (!recent.isEmpty() && recent.peekFirst() <= t - window) recent.pollFirst();
            if (recent.size() < limit) {
                recent.addLast(t);
                sb.append("ALLOW\\n");
            } else {
                sb.append("DENY\\n");
            }
        }
        System.out.print(sb);
    }
}
`;

const adaSql = `SELECT d.name AS department, e.name AS employee, e.salary
FROM employees e
JOIN departments d ON d.id = e.dept_id
WHERE (
  SELECT COUNT(DISTINCT e2.salary) FROM employees e2
  WHERE e2.dept_id = e.dept_id AND e2.salary > e.salary
) < 2
ORDER BY department, e.salary DESC, employee;`;

const linusPairSum = `n, t = map(int, input().split())
a = list(map(int, input().split()))
count = 0
for i in range(n):
    for j in range(i + 1, n):
        if a[i] + a[j] == t:
            count += 1
print(count)
`;

const linusRateLimiter = `package main

import (
	"bufio"
	"fmt"
	"os"
)

func main() {
	in := bufio.NewReader(os.Stdin)
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()
	var n, k int
	var w int64
	fmt.Fscan(in, &n, &k, &w)
	hist := map[string][]int64{}
	for i := 0; i < n; i++ {
		var t int64
		var u string
		fmt.Fscan(in, &t, &u)
		h := hist[u]
		for len(h) > 0 && h[0] <= t-w {
			h = h[1:]
		}
		if len(h) < k {
			h = append(h, t)
			fmt.Fprintln(out, "ALLOW")
		} else {
			fmt.Fprintln(out, "DENY")
		}
		hist[u] = h
	}
}
`;

const linusSql = `SELECT department, employee, salary FROM (
  SELECT d.name AS department, e.name AS employee, e.salary,
         RANK() OVER (PARTITION BY d.id ORDER BY e.salary DESC) AS r
  FROM employees e JOIN departments d ON e.dept_id = d.id
) ranked
WHERE r <= 2
ORDER BY department, salary DESC, employee;`;

// Ada's solution with identifiers renamed and reformatted: caught by token normalization.
const graceBPairSum = `#include <bits/stdc++.h>
using namespace std;
int main(){
  ios::sync_with_stdio(false); cin.tie(nullptr);
  int cnt; long long goal; cin >> cnt >> goal;
  unordered_map<long long,long long> seen; seen.reserve(cnt*2);
  long long answer = 0;
  for(int k = 0; k < cnt; k++){
    long long v; cin >> v;
    auto f = seen.find(goal - v);
    if(f != seen.end()) answer += f->second;
    seen[v]++;
  }
  cout << answer << "\\n";
  return 0;
}
`;

// The reference solution with variables renamed: caught by the reference comparison.
const graceRateLimiter = `import sys
from collections import defaultdict, deque

def main():
    tokens = sys.stdin.buffer.read().split()
    total, cap, span = int(tokens[0]), int(tokens[1]), int(tokens[2])
    logs = defaultdict(deque)
    res = []
    for idx in range(total):
        ts = int(tokens[3 + 2 * idx])
        who = tokens[4 + 2 * idx]
        q = logs[who]
        while q and q[0] <= ts - span:
            q.popleft()
        if len(q) < cap:
            q.append(ts)
            res.append("ALLOW")
        else:
            res.append("DENY")
    sys.stdout.write("\\n".join(res) + "\\n")

main()
`;

export const DEMO_CANDIDATES: DemoCandidate[] = [
  {
    name: 'Ada Lovelace',
    email: 'ada.l@example.com',
    submitMin: 52,
    answers: {
      'pair-sum-count': { language: 'cpp', code: adaPairSum, startMin: 2, finishMin: 14 },
      'sliding-window-rate-limiter': { language: 'java', code: adaRateLimiter, startMin: 15, finishMin: 38 },
      'top-earners-by-department': { language: 'sql', code: adaSql, startMin: 39, finishMin: 47 },
      'where-vs-having': { choice: 'b' },
      'mutable-default-argument': { choice: 'b' },
      'idempotent-http-methods': { choice: ['a', 'c', 'd'] },
    },
    events: [
      { type: 'tab_hidden', min: 30 },
      { type: 'tab_visible', min: 30.5 },
      { type: 'paste', min: 22, slug: 'sliding-window-rate-limiter', detail: { chars: 18 } },
    ],
  },
  {
    name: 'Linus Torvalds',
    email: 'linus.t@example.com',
    submitMin: 68,
    answers: {
      'pair-sum-count': { language: 'python', code: linusPairSum, startMin: 3, finishMin: 9 },
      'sliding-window-rate-limiter': { language: 'go', code: linusRateLimiter, startMin: 10, finishMin: 41 },
      'top-earners-by-department': { language: 'sql', code: linusSql, startMin: 42, finishMin: 60 },
      'where-vs-having': { choice: 'b' },
      'mutable-default-argument': { choice: 'a' },
      'idempotent-http-methods': { choice: ['a', 'b', 'c', 'd'] },
    },
    events: [
      { type: 'tab_hidden', min: 20 },
      { type: 'tab_hidden', min: 33 },
      { type: 'tab_hidden', min: 50 },
      { type: 'paste', min: 45, slug: 'top-earners-by-department', detail: { chars: 42 } },
    ],
  },
  {
    name: 'Grace Hopper',
    email: 'grace.h@example.com',
    submitMin: 31,
    answers: {
      'pair-sum-count': { language: 'cpp', code: graceBPairSum, startMin: 4, finishMin: 5, pasted: true },
      'sliding-window-rate-limiter': { language: 'python', code: graceRateLimiter, startMin: 12, finishMin: 13, pasted: true },
      'top-earners-by-department': { language: 'sql', code: adaSql.replaceAll('e2', 'x'), startMin: 20, finishMin: 22, pasted: true },
      'where-vs-having': { choice: 'b' },
      'mutable-default-argument': { choice: 'b' },
      'idempotent-http-methods': { choice: ['a', 'c', 'd'] },
    },
    events: [
      ...[3, 6, 8, 11, 14, 17, 19, 23, 26].map((min) => ({ type: 'tab_hidden', min })),
      { type: 'fullscreen_exit', min: 3 },
      { type: 'fullscreen_exit', min: 11 },
      { type: 'paste', min: 4.9, slug: 'pair-sum-count', detail: { chars: 468 } },
      { type: 'paste', min: 12.9, slug: 'sliding-window-rate-limiter', detail: { chars: 640 } },
      { type: 'paste', min: 21.5, slug: 'top-earners-by-department', detail: { chars: 260 } },
    ],
  },
];
