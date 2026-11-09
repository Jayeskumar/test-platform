import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export interface ToolCtx {
  /** Memory limit for the program in MB. */
  memMb: number;
  /** Per-slot writable cache directory (owned by the slot uid). */
  cacheDir: string;
}

export interface LanguageDef {
  id: string;
  name: string;
  /** Source file name inside the box. */
  file: string;
  /** Editor mode hint for the client. */
  editor: string;
  compile?: (ctx: ToolCtx) => string[];
  run: (ctx: ToolCtx) => string[];
  env?: (ctx: ToolCtx) => Record<string, string>;
  /** Time limit multiplier relative to the problem's base limit. */
  timeFactor: number;
  /** Fixed allowance for runtime start-up (JVM, V8...). */
  timeExtraMs: number;
  /** Fixed RSS allowance on top of the problem's memory limit. */
  memExtraMb: number;
  /** Whether RLIMIT_AS can be applied (false for runtimes reserving huge virtual memory). */
  addressLimit: boolean;
  template: string;
  version: () => string[];
}

function which(bin: string, resolve = true): string | null {
  try {
    const p = execFileSync('sh', ['-c', `command -v ${bin}`], { encoding: 'utf8' }).trim();
    if (!p) return null;
    return resolve ? fs.realpathSync(p) : p;
  } catch {
    return null;
  }
}

function rustc(): string | null {
  const proxy = which('rustc', false); // keep the rustup proxy name: argv[0] selects the tool
  if (!proxy) return null;
  try {
    const sysroot = execFileSync(proxy, ['--print', 'sysroot'], { encoding: 'utf8' }).trim();
    const real = path.join(sysroot, 'bin', 'rustc');
    return fs.existsSync(real) ? real : proxy;
  } catch {
    return proxy;
  }
}

const tools = {
  python: which('python3'),
  node: which('node'),
  gcc: which('gcc'),
  gpp: which('g++'),
  javac: which('javac'),
  java: which('java'),
  go: which('go'),
  rustc: rustc(),
};

const T = (p: string | null, name: string) => {
  if (!p) throw new Error(`${name} not installed`);
  return p;
};

export const LANGUAGES: LanguageDef[] = [
  {
    id: 'python',
    name: 'Python 3',
    file: 'main.py',
    editor: 'python',
    run: () => [T(tools.python, 'python3'), '-u', 'main.py'],
    env: () => ({ PYTHONDONTWRITEBYTECODE: '1', PYTHONIOENCODING: 'utf-8', PYTHONHASHSEED: '0' }),
    timeFactor: 3,
    timeExtraMs: 150,
    memExtraMb: 16,
    addressLimit: true,
    template: `import sys

def main():
    data = sys.stdin.read().split()
    # Parse input from data and print the answer


if __name__ == "__main__":
    main()
`,
    version: () => [T(tools.python, 'python3'), '--version'],
  },
  {
    id: 'javascript',
    name: 'JavaScript (Node.js)',
    file: 'main.js',
    editor: 'javascript',
    run: ({ memMb }) => [T(tools.node, 'node'), `--max-old-space-size=${Math.max(64, memMb)}`, 'main.js'],
    timeFactor: 2,
    timeExtraMs: 300,
    memExtraMb: 64,
    addressLimit: false,
    template: `const data = require("fs").readFileSync(0, "utf8").trim().split(/\\s+/);
// Parse input from data and print the answer with console.log

`,
    version: () => [T(tools.node, 'node'), '--version'],
  },
  {
    id: 'typescript',
    name: 'TypeScript (Node.js)',
    file: 'main.ts',
    editor: 'typescript',
    run: ({ memMb }) => [
      T(tools.node, 'node'),
      '--experimental-strip-types',
      '--no-warnings',
      `--max-old-space-size=${Math.max(64, memMb)}`,
      'main.ts',
    ],
    timeFactor: 2,
    timeExtraMs: 400,
    memExtraMb: 64,
    addressLimit: false,
    template: `import { readFileSync } from "node:fs";

const data: string[] = readFileSync(0, "utf8").trim().split(/\\s+/);
// Parse input from data and print the answer with console.log

`,
    version: () => [T(tools.node, 'node'), '--version'],
  },
  {
    id: 'c',
    name: 'C (GCC, C17)',
    file: 'main.c',
    editor: 'cpp',
    compile: () => [T(tools.gcc, 'gcc'), '-O2', '-std=gnu17', '-pipe', '-o', 'main', 'main.c', '-lm'],
    run: () => ['./main'],
    timeFactor: 1,
    timeExtraMs: 0,
    memExtraMb: 4,
    addressLimit: true,
    template: `#include <stdio.h>

int main(void) {
    // Read input with scanf and print the answer with printf
    return 0;
}
`,
    version: () => [T(tools.gcc, 'gcc'), '--version'],
  },
  {
    id: 'cpp',
    name: 'C++20 (GCC)',
    file: 'main.cpp',
    editor: 'cpp',
    compile: () => [T(tools.gpp, 'g++'), '-O2', '-std=gnu++20', '-pipe', '-o', 'main', 'main.cpp'],
    run: () => ['./main'],
    timeFactor: 1,
    timeExtraMs: 0,
    memExtraMb: 4,
    addressLimit: true,
    template: `#include <bits/stdc++.h>
using namespace std;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    // Read input with cin and print the answer with cout
    return 0;
}
`,
    version: () => [T(tools.gpp, 'g++'), '--version'],
  },
  {
    id: 'java',
    name: 'Java',
    file: 'Main.java',
    editor: 'java',
    compile: () => [T(tools.javac, 'javac'), '-J-Xmx512m', '-J-XX:+UseSerialGC', '-J-XX:-UsePerfData', '-encoding', 'UTF-8', 'Main.java'],
    run: ({ memMb }) => [
      T(tools.java, 'java'),
      `-Xmx${Math.max(32, memMb)}m`,
      '-Xss64m',
      '-XX:+UseSerialGC',
      '-XX:-UsePerfData',
      '-XX:TieredStopAtLevel=1',
      'Main',
    ],
    timeFactor: 2,
    timeExtraMs: 1200,
    memExtraMb: 96,
    addressLimit: false,
    template: `import java.io.*;
import java.util.*;

public class Main {
    public static void main(String[] args) throws IOException {
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
        StreamTokenizer in = new StreamTokenizer(br);
        // Read input and print the answer with System.out.println
    }
}
`,
    version: () => [T(tools.java, 'java'), '-version'],
  },
  {
    id: 'go',
    name: 'Go',
    file: 'main.go',
    editor: 'go',
    compile: () => [T(tools.go, 'go'), 'build', '-o', 'main', 'main.go'],
    run: () => ['./main'],
    env: ({ cacheDir }) => ({
      GOCACHE: path.join(cacheDir, 'go-build'),
      GOPATH: path.join(cacheDir, 'gopath'),
      GOTOOLCHAIN: 'local',
      GO111MODULE: 'off',
      CGO_ENABLED: '0',
      GOMAXPROCS: '1',
    }),
    timeFactor: 1,
    timeExtraMs: 50,
    memExtraMb: 16,
    addressLimit: false,
    template: `package main

import (
	"bufio"
	"fmt"
	"os"
)

func main() {
	reader := bufio.NewReader(os.Stdin)
	writer := bufio.NewWriter(os.Stdout)
	defer writer.Flush()
	_ = reader
	// Read input with fmt.Fscan(reader, &x) and print with fmt.Fprintln(writer, ...)
	fmt.Fprint(writer, "")
}
`,
    version: () => [T(tools.go, 'go'), 'version'],
  },
  {
    id: 'rust',
    name: 'Rust',
    file: 'main.rs',
    editor: 'rust',
    compile: () => [T(tools.rustc, 'rustc'), '-O', '--edition', '2021', '-o', 'main', 'main.rs'],
    run: () => ['./main'],
    timeFactor: 1,
    timeExtraMs: 0,
    memExtraMb: 4,
    addressLimit: true,
    template: `use std::io::{self, Read, Write};

fn main() {
    let mut input = String::new();
    io::stdin().read_to_string(&mut input).unwrap();
    let mut it = input.split_ascii_whitespace();
    let out = io::stdout();
    let mut out = io::BufWriter::new(out.lock());
    let _ = &mut it;
    // Parse tokens from it and write the answer with writeln!(out, ...)
    write!(out, "").unwrap();
}
`,
    version: () => [T(tools.rustc, 'rustc'), '--version'],
  },
];

export const LANGUAGE_MAP = new Map(LANGUAGES.map((l) => [l.id, l]));

/** Hello-world programs used by the start-up self test (they print "ok"). */
export const HELLO: Record<string, string> = {
  python: 'print("ok")\n',
  javascript: 'console.log("ok")\n',
  typescript: 'const s: string = "ok";\nconsole.log(s)\n',
  c: '#include <stdio.h>\nint main(void){puts("ok");return 0;}\n',
  cpp: '#include <iostream>\nint main(){std::cout<<"ok\\n";}\n',
  java: 'public class Main { public static void main(String[] a){ System.out.println("ok"); } }\n',
  go: 'package main\nimport "fmt"\nfunc main(){ fmt.Println("ok") }\n',
  rust: 'fn main(){ println!("ok"); }\n',
};

export function toolDirs(): string[] {
  return [...new Set(Object.values(tools).filter(Boolean).map((p) => path.dirname(p as string)))];
}
