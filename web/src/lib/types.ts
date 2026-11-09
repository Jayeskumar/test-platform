export type Role = 'candidate' | 'recruiter' | 'admin';
export interface User { id: number; email: string; name: string; role: Role }

export type Verdict = 'AC' | 'WA' | 'TLE' | 'MLE' | 'RE' | 'OLE' | 'CE' | 'SE' | 'OK';
export type Difficulty = 'easy' | 'medium' | 'hard';

export interface LanguageInfo {
  id: string;
  name: string;
  editor: string;
  available: boolean;
  version?: string;
  reason?: string;
  template: string;
}

export interface Meta {
  languages: LanguageInfo[];
  isolation: { network: boolean; filesystem: boolean; users: boolean };
  workers: number;
  ai: boolean;
}

export interface Table { columns: string[]; rows: unknown[][] }

export interface Sample { id: number; input: string; expected: string; explanation: string; expectedTable?: Table | null }

export interface Problem {
  id: number;
  slug: string;
  type: 'coding' | 'sql' | 'mcq';
  title: string;
  difficulty: Difficulty;
  tags: string[];
  statement: string;
  limits?: { timeMs: number; memoryMb: number };
  checker?: string;
  starter?: Record<string, string>;
  languages?: string[] | null;
  complexity?: { expected: string; sizes: number[] } | null;
  samples?: Sample[];
  testCount?: number;
  schema?: string;
  ordered?: boolean;
  options?: { id: string; text: string }[];
  multiple?: boolean;
}

export interface TestResult {
  index: number;
  sample: boolean;
  custom?: boolean;
  hidden?: boolean;
  verdict: Verdict;
  timeMs: number;
  memoryKb: number;
  message?: string;
  input?: string;
  expected?: string;
  output?: string;
  stderr?: string;
  table?: Table;
  expectedTable?: Table;
}

export interface ComplexityReport {
  estimate: string;
  expected: string;
  meetsTarget: boolean;
  confidence: number;
  slope: number | null;
  points: { n: number; cpuMs: number; status: string }[];
  fits: { model: string; error: number }[];
  note?: string;
}

export interface Submission {
  id: number;
  questionId: number;
  language: string;
  code: string;
  kind: 'run' | 'submit';
  status: 'queued' | 'running' | 'done';
  verdict: Verdict | null;
  score: number;
  passed: number;
  total: number;
  timeMs: number | null;
  memoryKb: number | null;
  compileOutput: string | null;
  results: TestResult[];
  complexity: ComplexityReport | null;
  createdAt: number;
}
