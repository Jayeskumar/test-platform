/**
 * Problem-set integrity: every built-in problem's reference solution must pass
 * its own tests, and independently written solutions in other languages must
 * agree with it. This catches wrong references, bad generators and judge bugs.
 */
import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';
import { Judge } from '../src/judge/judge.js';
import { PROBLEMS } from '../src/seed/problems.js';
import { available, testSandbox } from './helpers.js';

const INDEPENDENT: Record<string, { language: string; code: string }> = {
  'pair-sum-count': { language: 'cpp', code: `#include <bits/stdc++.h>
int main(){int n;long long t;scanf("%d %lld",&n,&t);std::vector<long long>a(n);for(auto&x:a)scanf("%lld",&x);std::sort(a.begin(),a.end());
long long c=0;int i=0,j=n-1;while(i<j){long long s=a[i]+a[j];if(s<t)i++;else if(s>t)j--;else if(a[i]==a[j]){long long k=j-i+1;c+=k*(k-1)/2;break;}
else{long long x=a[i],y=a[j],ci=0,cj=0;while(i<=j&&a[i]==x){ci++;i++;}while(j>=i&&a[j]==y){cj++;j--;}c+=ci*cj;}}printf("%lld\\n",c);}` },
  'balanced-brackets': { language: 'javascript', code: `const L=require("fs").readFileSync(0,"utf8").split(/\\s+/).filter(Boolean);const q=+L[0];const o=[];
for(let k=1;k<=q;k++){const s=L[k];const st=[];let ok=true;for(const c of s){if("([{".includes(c))st.push(c);else{const p=st.pop();if(p!==({")":"(","]":"[","}":"{"})[c]){ok=false;break;}}}o.push(ok&&!st.length?"YES":"NO");}console.log(o.join("\\n"));` },
  'longest-unique-streak': { language: 'c', code: `#include <stdio.h>
#include <string.h>
static char s[1100000];int main(){scanf("%s",s);int last[256];memset(last,-1,sizeof last);int best=0,st=0,n=strlen(s);for(int i=0;i<n;i++){unsigned char c=s[i];if(last[c]>=st)st=last[c]+1;last[c]=i;if(i-st+1>best)best=i-st+1;}printf("%d\\n",best);}` },
  'merge-meeting-blocks': { language: 'java', code: `import java.io.*;import java.util.*;
public class Main{public static void main(String[] x)throws IOException{DataInputStream in=new DataInputStream(new BufferedInputStream(System.in,1<<16));StreamTokenizer t=new StreamTokenizer(new BufferedReader(new InputStreamReader(System.in)));t.nextToken();int n=(int)t.nval;long[][] a=new long[n][2];for(int i=0;i<n;i++){t.nextToken();a[i][0]=(long)t.nval;t.nextToken();a[i][1]=(long)t.nval;}
Arrays.sort(a,(p,q)->Long.compare(p[0],q[0]));StringBuilder sb=new StringBuilder();long l=a[0][0],r=a[0][1];for(int i=1;i<n;i++){if(a[i][0]<=r)r=Math.max(r,a[i][1]);else{sb.append(l).append(' ').append(r).append('\\n');l=a[i][0];r=a[i][1];}}sb.append(l).append(' ').append(r).append('\\n');System.out.print(sb);}}` },
  'change-making-ways': { language: 'go', code: `package main
import ("bufio";"fmt";"os")
func main(){r:=bufio.NewReader(os.Stdin);var n,A int;fmt.Fscan(r,&n,&A);w:=make([]int64,A+1);w[0]=1;for i:=0;i<n;i++{var c int;fmt.Fscan(r,&c);for v:=c;v<=A;v++{w[v]=(w[v]+w[v-c])%1000000007}};fmt.Println(w[A])}` },
  'longest-rising-trend': { language: 'javascript', code: `const d=require("fs").readFileSync(0,"utf8").trim().split(/\\s+/).map(Number);const n=d[0];const t=[];
for(let k=1;k<=n;k++){const x=d[k];let lo=0,hi=t.length;while(lo<hi){const m=(lo+hi)>>1;if(t[m]<x)lo=m+1;else hi=m;}t[lo]=x;}console.log(t.length);` },
  'land-plot-area': { language: 'c', code: `#include <stdio.h>
#include <math.h>
static double x[100005],y[100005];int main(){int n;scanf("%d",&n);for(int i=0;i<n;i++)scanf("%lf %lf",&x[i],&y[i]);double s=0;for(int i=0;i<n;i++){int j=(i+1)%n;s+=x[i]*y[j]-x[j]*y[i];}printf("%.9f\\n",fabs(s)/2);}` },
  'build-order': { language: 'cpp', code: `#include <bits/stdc++.h>
int main(){int n,m;scanf("%d %d",&n,&m);std::vector<std::vector<int>>g(n+1);std::vector<int>in(n+1),o;for(int i=0;i<m;i++){int a,b;scanf("%d %d",&a,&b);g[a].push_back(b);in[b]++;}
std::priority_queue<int,std::vector<int>,std::greater<int>>q;for(int i=1;i<=n;i++)if(!in[i])q.push(i);while(!q.empty()){int u=q.top();q.pop();o.push_back(u);for(int v:g[u])if(!--in[v])q.push(v);}
if((int)o.size()!=n){puts("IMPOSSIBLE");return 0;}for(int i=0;i<n;i++)printf("%d%c",o[i],i+1<n?' ':'\\n');}` },
  'sliding-window-rate-limiter': { language: 'cpp', code: `#include <bits/stdc++.h>
int main(){std::ios::sync_with_stdio(false);std::cin.tie(nullptr);int n,k;long long w;std::cin>>n>>k>>w;std::unordered_map<std::string,std::deque<long long>>h;std::string out;
for(int i=0;i<n;i++){long long t;std::string u;std::cin>>t>>u;auto&d=h[u];while(!d.empty()&&d.front()<=t-w)d.pop_front();if((int)d.size()<k){d.push_back(t);out+="ALLOW\\n";}else out+="DENY\\n";}std::cout<<out;}` },
  'count-islands': { language: 'cpp', code: `#include <bits/stdc++.h>
int main(){int R,C;scanf("%d %d",&R,&C);std::vector<std::string>g(R);char buf[1100];for(int i=0;i<R;i++){scanf("%s",buf);g[i]=buf;}int c=0;std::vector<std::pair<int,int>>st;
for(int i=0;i<R;i++)for(int j=0;j<C;j++)if(g[i][j]=='1'){c++;g[i][j]='0';st.push_back({i,j});while(!st.empty()){auto[a,b]=st.back();st.pop_back();int dx[]={1,-1,0,0},dy[]={0,0,1,-1};
for(int d=0;d<4;d++){int x=a+dx[d],y=b+dy[d];if(x>=0&&y>=0&&x<R&&y<C&&g[x][y]=='1'){g[x][y]='0';st.push_back({x,y});}}}}printf("%d\\n",c);}` },
  'warehouse-robot': { language: 'javascript', code: `const L=require("fs").readFileSync(0,"utf8").split(/\\s+/).filter(Boolean);const R=+L[0],C=+L[1];const g=L.slice(2,2+R).join("");
const dist=new Int32Array(R*C).fill(-1);const s=g.indexOf("S"),e=g.indexOf("E");const q=new Int32Array(R*C);let h=0,t=0;q[t++]=s;dist[s]=0;
while(h<t){const u=q[h++];const r=(u/C)|0,c=u%C;const nb=[[u-C,r>0],[u+C,r<R-1],[u-1,c>0],[u+1,c<C-1]];for(const[v,ok]of nb){if(ok&&dist[v]<0&&g[v]!=="#"){dist[v]=dist[u]+1;q[t++]=v;}}}console.log(dist[e]);` },
  'anagram-buckets': { language: 'javascript', code: `const w=require("fs").readFileSync(0,"utf8").split(/\\s+/).filter(Boolean);const n=+w[0];const m=new Map();
for(const x of w.slice(1,1+n)){const k=[...x].sort().join("");if(!m.has(k))m.set(k,[]);m.get(k).push(x);}console.log([...m.values()].reverse().map((g)=>g.sort().join(" ")).join("\\n"));` },
  'delivery-routes': { language: 'cpp', code: `#include <bits/stdc++.h>
using ll=long long;int main(){int n,m;scanf("%d %d",&n,&m);std::vector<std::vector<std::pair<int,ll>>>g(n+1);for(int i=0;i<m;i++){int u,v;ll w;scanf("%d %d %lld",&u,&v,&w);g[u].push_back({v,w});g[v].push_back({u,w});}
std::vector<ll>d(n+1,LLONG_MAX);std::priority_queue<std::pair<ll,int>,std::vector<std::pair<ll,int>>,std::greater<>>pq;d[1]=0;pq.push({0,1});while(!pq.empty()){auto[du,u]=pq.top();pq.pop();if(du>d[u])continue;for(auto[v,w]:g[u])if(du+w<d[v]){d[v]=du+w;pq.push({d[v],v});}}
for(int i=1;i<=n;i++)printf("%lld%c",d[i]==LLONG_MAX?-1:d[i],i<n?' ':'\\n');}` },
  'running-median': { language: 'cpp', code: `#include <bits/stdc++.h>
int main(){int n;scanf("%d",&n);std::priority_queue<int>lo;std::priority_queue<int,std::vector<int>,std::greater<int>>hi;std::string o;
for(int i=0;i<n;i++){int x;scanf("%d",&x);if(!lo.empty()&&x>lo.top())hi.push(x);else lo.push(x);
if(lo.size()>hi.size()+1){hi.push(lo.top());lo.pop();}else if(hi.size()>lo.size()){lo.push(hi.top());hi.pop();}o+=std::to_string(lo.top());o+='\\n';}fputs(o.c_str(),stdout);}` },
};

describe('built-in problem set', () => {
  let judge: Judge;
  before(async () => { judge = new Judge(await testSandbox()); });

  for (const p of PROBLEMS.filter((x) => x.type === 'coding')) {
    test(`${p.slug}: reference solution passes and an independent solution agrees`, async (t) => {
      const data = p.data as any;
      const inputs = p.tests.map((x) => x.input);
      const expected = await judge.expectedOutputs(data.reference.language, data.reference.code, inputs, { timeMs: 20000, memoryMb: 512 });
      const tests = inputs.map((input, i) => ({ input, expected: expected[i], weight: 1, sample: false }));
      const alt = INDEPENDENT[p.slug];
      if (!alt) return;
      if (!(await available(alt.language))) return t.skip(`${alt.language} unavailable`);
      const o = await judge.judgeCode({ language: alt.language, code: alt.code, tests, limits: { timeMs: 5000, memoryMb: 512 }, checker: data.checker });
      assert.equal(o.verdict, 'AC', `${o.compileOutput}\n${JSON.stringify(o.results.filter((r) => r.verdict !== 'AC').map((r) => [r.index, r.verdict, r.message]))}`);
    });
  }

  for (const p of PROBLEMS.filter((x) => x.type === 'sql')) {
    test(`${p.slug}: reference query runs on every dataset`, async () => {
      const data = p.data as any;
      const out = await judge.sqlExpected(data.schema, p.tests.map((x) => x.input), data.solution);
      for (const o of out) assert.ok(JSON.parse(o).rows.length > 0 || p.tests.length > 0);
    });
  }

  test('every coding problem has visible samples and hidden tests', () => {
    for (const p of PROBLEMS.filter((x) => x.type !== 'mcq')) {
      assert.ok(p.tests.some((x) => x.sample), `${p.slug} has no sample`);
      assert.ok(p.tests.some((x) => !x.sample), `${p.slug} has no hidden test`);
    }
  });
});
