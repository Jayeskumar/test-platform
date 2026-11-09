/**
 * Progressive hints and editorials for the built-in problems (practice mode only).
 * Hints go from a nudge to the key idea; the editorial explains the approach,
 * its complexity and common pitfalls.
 */
export const EDITORIALS: Record<string, { hints: string[]; editorial: string }> = {
  'pair-sum-count': {
    hints: [
      'For each element `x`, which value would complete a pair with it?',
      'While scanning left to right, how many earlier elements equal `T - x`? Keep counts as you go.',
      'A hash map from value → occurrences so far gives each answer in O(1). Remember the count can exceed 32 bits.',
    ],
    editorial: `### Approach
Scan the array once, keeping a hash map \`seen\` from value to how many times it has appeared **so far**. For each \`x\`, every earlier element equal to \`T − x\` forms a pair \`(i, j)\` with \`i < j\`, so add \`seen[T − x]\` to the answer, then record \`x\`.

### Complexity
O(n) time, O(n) memory.

### Pitfalls
- Counting \`seen[T − x]\` **before** inserting \`x\` avoids pairing an element with itself when \`2x = T\`.
- With 200 000 equal values the answer is about 2·10¹⁰ — use 64-bit integers.
- The quadratic double loop passes the samples but times out on the large tests (and the complexity analyzer reports O(n²)).`,
  },
  'balanced-brackets': {
    hints: [
      'The most recently opened bracket must be the first one closed.',
      'A stack of open brackets models "most recent first".',
      'On a closer, the stack top must be the matching opener; at the end the stack must be empty.',
    ],
    editorial: `### Approach
Push every opening bracket. On a closing bracket, pop and check it matches; an empty stack or a mismatch means **NO**. After the scan, the string is balanced exactly when the stack is empty.

### Complexity
O(total length) time, O(depth) memory.

### Pitfalls
- \`"(("\` passes the per-character checks but leaves the stack non-empty.
- Avoid recursion: a string of 50 000 nested brackets overflows the call stack.`,
  },
  'land-plot-area': {
    hints: [
      'Split the polygon into triangles that share one point.',
      'The cross product of two vectors gives twice the signed area of the triangle they span.',
      'Shoelace formula: area = |Σ (xᵢ·yᵢ₊₁ − xᵢ₊₁·yᵢ)| / 2, with indices wrapping around.',
    ],
    editorial: `### Approach
Apply the **shoelace formula**: sum \`x[i]·y[i+1] − x[i+1]·y[i]\` over all edges (wrapping the last vertex to the first), take the absolute value and halve it. The sign depends on orientation, which is why the absolute value makes clockwise and counter-clockwise input equivalent.

### Complexity
O(n) time, O(1) extra memory.

### Pitfalls
- Forgetting the closing edge from the last vertex back to the first.
- Printing too few decimals: the checker accepts 10⁻⁶ error, so print at least 6–9 digits.`,
  },
  'count-islands': {
    hints: [
      'Each island is a connected component of land cells.',
      'Every time you meet unvisited land, explore its whole island and count one.',
      'Use an explicit stack or queue (not recursion) and mark cells as you push them.',
    ],
    editorial: `### Approach
Scan the grid. When you find a \`1\` that has not been visited, increment the counter and flood-fill its island with an explicit stack (or BFS queue), turning each visited cell into \`0\` so it is never counted again.

### Complexity
O(R·C) time; every cell is pushed at most once.

### Pitfalls
- Recursive DFS on a 1000×1000 all-land grid needs a million stack frames and crashes.
- Mark cells when you **push** them, not when you pop, or the same cell can be queued many times.`,
  },
  'longest-unique-streak': {
    hints: [
      'Consider a window [start, i] that never contains a repeated character.',
      'When s[i] already appears inside the window, where must the window start next?',
      'Store the last index of each character; move start to last[c] + 1 when that index is inside the window.',
    ],
    editorial: `### Approach
Sliding window. Keep \`last[c]\`, the last index where character \`c\` appeared, and the window start. For each \`i\`, if \`last[s[i]] ≥ start\`, jump \`start\` to \`last[s[i]] + 1\`. Update \`last\` and the best length \`i − start + 1\`.

### Complexity
O(n) time, O(alphabet) memory.

### Pitfalls
- Only jump forward: \`"abba"\` breaks solutions that set \`start = last[c] + 1\` unconditionally (it would move left at the final \`a\`).`,
  },
  'merge-meeting-blocks': {
    hints: [
      'If the blocks were sorted by start time, which ones could overlap?',
      'After sorting, a block overlaps the current merged block exactly when its start ≤ the current end.',
      'Extend the current end with max(end, r); otherwise output the current block and start a new one.',
    ],
    editorial: `### Approach
Sort by start time, then sweep while keeping the current merged block \`[cl, cr]\`. If the next block starts at or before \`cr\`, extend \`cr = max(cr, r)\`; otherwise emit \`[cl, cr]\` and start a new block.

### Complexity
O(n log n) for the sort, O(n) for the sweep.

### Pitfalls
- Touching blocks (\`r1 = l2\`) merge — use \`≤\`, not \`<\`.
- A long block can swallow several later ones: \`[1,10], [2,3], [4,5]\` → \`[1,10]\`. Take the **max** of the ends.`,
  },
  'warehouse-robot': {
    hints: [
      'All moves cost the same, so you want the fewest edges in an unweighted graph.',
      'Breadth-first search explores cells in order of distance from S.',
      'Store distances in a flat array of size R·C and stop as soon as E is dequeued.',
    ],
    editorial: `### Approach
Breadth-first search from \`S\` over passable cells. BFS visits cells in non-decreasing distance order, so the first time \`E\` is reached its distance is minimal. If BFS ends without reaching \`E\`, print \`-1\`.

### Complexity
O(R·C) time and memory.

### Pitfalls
- DFS finds *a* path, not the shortest one.
- Setting the distance when a cell is **enqueued** (not dequeued) prevents duplicates in the queue.`,
  },
  'change-making-ways': {
    hints: [
      'Order must not matter: {1,2} and {2,1} are the same way.',
      'Process one coin type at a time and count ways using only coins seen so far.',
      'ways[v] += ways[v − c] with the coin loop outside and the amount loop inside (ascending).',
    ],
    editorial: `### Approach
Unbounded knapsack counting. \`ways[0] = 1\`. For each coin \`c\` (outer loop), for \`v\` from \`c\` to \`A\` (inner loop, ascending), do \`ways[v] += ways[v − c]\` modulo 10⁹+7. Putting coins in the outer loop counts **combinations**; swapping the loops would count ordered sequences.

### Complexity
O(n·A) time, O(A) memory.

### Pitfalls
- Loop order (see above) — swapping it counts \`2+1\` and \`1+2\` separately.
- Take the modulus on every addition.`,
  },
  'build-order': {
    hints: [
      'A package can be built once everything it depends on is built.',
      'Track how many unbuilt prerequisites each package still has.',
      'Kahn\'s algorithm: repeatedly take a package with zero remaining prerequisites; if you get stuck before all n, there is a cycle.',
    ],
    editorial: `### Approach
Topological sort with **Kahn's algorithm**. Compute in-degrees, queue every package with in-degree 0, and repeatedly pop one, append it to the order and decrement its dependents' in-degrees. If fewer than \`n\` packages come out, the remaining ones lie on a cycle — print \`IMPOSSIBLE\`.

### Complexity
O(n + m) time and memory.

### Pitfalls
- Any valid order is accepted (a custom checker verifies every rule), so there is no need to sort the queue.
- Duplicate rules are allowed; counting them in the in-degree is fine as long as you decrement once per rule too.`,
  },
  'anagram-buckets': {
    hints: [
      'Two words are anagrams exactly when they have the same letters with the same counts.',
      'Give every word a canonical key that is identical for all its anagrams.',
      'Sorting the letters of a word is a convenient key; group words by it in a hash map.',
    ],
    editorial: `### Approach
Use the word's sorted letters as a key and append the word to that key's bucket in a hash map. Print each bucket with its words sorted. Buckets may come out in any order — the checker ignores line order.

### Complexity
O(n · k log k) for words of length up to k (or O(n·k) with a letter-count key).

### Pitfalls
- Words inside a bucket must be sorted alphabetically; only the **bucket** order is free.`,
  },
  'longest-rising-trend': {
    hints: [
      'A classic O(n²) DP exists — too slow for n = 200 000.',
      'For each length L, the smallest possible last value of a rising trend of length L is useful.',
      'Keep that array sorted ("tails") and binary-search where each new price goes.',
    ],
    editorial: `### Approach
Patience sorting. Maintain \`tails\`, where \`tails[L]\` is the smallest possible last price of a strictly rising trend of length \`L + 1\`. \`tails\` is always increasing. For each price \`x\`, find the first index with \`tails[i] ≥ x\` (lower bound): replace it, or append if none. The answer is \`len(tails)\`.

### Complexity
O(n log n) time, O(n) memory — the complexity analyzer expects exactly this.

### Pitfalls
- Use **lower** bound (\`≥ x\`) for strictly increasing trends; upper bound would allow equal prices.
- \`tails\` is not itself a valid trend — only its length is meaningful.`,
  },
  'delivery-routes': {
    hints: [
      'Travel times are positive and differ, so plain BFS is not enough.',
      'Always settle the hub with the smallest tentative distance next.',
      'Dijkstra with a binary heap; skip stale heap entries; distances need 64-bit integers.',
    ],
    editorial: `### Approach
**Dijkstra's algorithm** from hub 1 with a min-heap of \`(distance, hub)\`. Pop the closest hub; if the popped distance is larger than the recorded one the entry is stale — skip it. Otherwise relax every road. Unreached hubs print \`-1\`.

### Complexity
O((n + m) log n) time, O(n + m) memory.

### Pitfalls
- Roads are two-way: add both directions.
- A path can reach 10⁵ · 10⁹ = 10¹⁴ — overflow in 32-bit integers.
- Parallel roads between the same hubs are allowed; Dijkstra handles them naturally.`,
  },
  'running-median': {
    hints: [
      'Sorting after every insertion is O(n² log n).',
      'Split the values into a lower half and an upper half.',
      'A max-heap for the lower half and a min-heap for the upper half, kept within one element in size, expose the median at the top of the lower heap.',
    ],
    editorial: `### Approach
Two heaps: \`lo\` (max-heap) holds the smaller half, \`hi\` (min-heap) the larger half. Insert into \`lo\` if \`x ≤ max(lo)\`, else into \`hi\`; then rebalance so that \`|lo| = |hi|\` or \`|lo| = |hi| + 1\`. The lower median is always the top of \`lo\`.

### Complexity
O(log n) per value, O(n log n) overall.

### Pitfalls
- The problem asks for the **lower** median when the count is even — that is exactly \`lo\`'s top with this balancing rule.`,
  },
  'sliding-window-rate-limiter': {
    hints: [
      'Only a user\'s *allowed* requests in (t − w, t] matter.',
      'Times are non-decreasing, so old requests leave a user\'s window in order.',
      'Keep a queue of allowed timestamps per user; pop while front ≤ t − w; allow if size < k.',
    ],
    editorial: `### Approach
Per user, keep a deque of the timestamps of **allowed** requests. For a request at time \`t\`, pop from the front while the oldest timestamp \`≤ t − w\` (the window is half-open). Allow and push \`t\` if fewer than \`k\` remain; otherwise deny without pushing.

### Complexity
Amortized O(1) per request — each timestamp is pushed and popped at most once.

### Pitfalls
- Denied requests must **not** be recorded.
- The window is \`(t − w, t]\`: a request exactly \`w\` seconds old has expired.`,
  },
  'customers-without-orders': {
    hints: [
      'You need customers for whom no matching order row exists.',
      'An outer join keeps customers even when there is no match.',
      'LEFT JOIN orders and keep rows where the order side IS NULL — or use NOT EXISTS.',
    ],
    editorial: `### Approach
\`\`\`sql
SELECT c.name, c.city
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.id
WHERE o.id IS NULL
ORDER BY c.name;
\`\`\`
\`NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.id)\` is an equally good alternative.

### Pitfalls
- \`NOT IN (SELECT customer_id FROM orders)\` misbehaves if the subquery ever returns \`NULL\`.
- Row order matters for this question — don't forget \`ORDER BY\`.`,
  },
  'monthly-revenue-growth': {
    hints: [
      'First aggregate revenue per month: substr(created_at, 1, 7) gives YYYY-MM.',
      'You need each month next to the previous month that had orders.',
      'The window function LAG(revenue) OVER (ORDER BY month) returns the previous row\'s revenue.',
    ],
    editorial: `### Approach
Aggregate per month in a CTE, then compare with the previous row using \`LAG\`:
\`\`\`sql
WITH m AS (
  SELECT substr(created_at, 1, 7) AS month, SUM(amount) AS revenue
  FROM orders GROUP BY 1
)
SELECT month, ROUND(revenue, 2) AS revenue,
  ROUND((revenue - LAG(revenue) OVER (ORDER BY month)) * 100.0
        / LAG(revenue) OVER (ORDER BY month), 1) AS growth_pct
FROM m ORDER BY month;
\`\`\`

### Pitfalls
- "Previous month" means the previous month **with orders** (March can be skipped), which is exactly what \`LAG\` over the aggregated rows gives you.
- Multiply by \`100.0\` to force real division.`,
  },
  'top-earners-by-department': {
    hints: [
      'Ties must be included, so "top two rows" is not the same as "top two salaries".',
      'Rank salaries within each department.',
      'DENSE_RANK() OVER (PARTITION BY dept ORDER BY salary DESC) ≤ 2 keeps both tied rows and the next distinct salary.',
    ],
    editorial: `### Approach
\`\`\`sql
SELECT department, employee, salary FROM (
  SELECT d.name AS department, e.name AS employee, e.salary,
         DENSE_RANK() OVER (PARTITION BY e.dept_id ORDER BY e.salary DESC) AS rnk
  FROM employees e JOIN departments d ON d.id = e.dept_id
) WHERE rnk <= 2
ORDER BY department, salary DESC, employee;
\`\`\`

### Pitfalls
- \`RANK()\` skips numbers after ties (1, 1, 3), so the second *distinct* salary would be lost.
- A correlated subquery counting distinct higher salaries (\`< 2\`) is a valid window-free alternative.`,
  },
};
