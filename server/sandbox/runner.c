/*
 * Crucible sandbox runner.
 *
 * Supervises one untrusted process: applies resource limits, isolates it
 * (no network, private mount namespace with sensitive paths hidden, dropped
 * privileges), enforces CPU / wall / memory limits and reports exact CPU time
 * and peak memory as a single JSON line on stdout.
 *
 *   runner [options] -- program [args...]
 *
 *   --cpu MS        CPU time limit in milliseconds (0 = none)
 *   --wall MS       wall clock limit in milliseconds (0 = none)
 *   --mem KB        resident memory limit, enforced by polling + rusage (0 = none)
 *   --as KB         address space limit, RLIMIT_AS (0 = none)
 *   --stack KB      stack size limit (default 262144)
 *   --fsize KB      maximum size of any file written (default 65536)
 *   --nproc N       max processes/threads for the uid (default 128)
 *   --uid N --gid N drop to this uid/gid (only when running as root)
 *   --cwd DIR       working directory
 *   --stdin F --stdout F --stderr F   redirections (opened before dropping privileges)
 *   --nonet         new empty network namespace
 *   --hide DIR      mount an empty read-only tmpfs over DIR (repeatable)
 *   --env K=V       environment entry (repeatable; environment is otherwise empty)
 *
 * Output: {"status":"OK|TLE|MLE|OLE|RE|SE","exit_code":N,"signal":N,
 *          "cpu_ms":N,"wall_ms":N,"mem_kb":N,"net_isolated":B,"fs_isolated":B,"error":"..."}
 */
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <grp.h>
#include <sched.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mount.h>
#include <sys/prctl.h>
#include <sys/resource.h>
#include <sys/stat.h>
#include <sys/time.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

#define MAX_LIST 64

static long long now_ms(void) {
  struct timespec ts;
  clock_gettime(CLOCK_MONOTONIC, &ts);
  return (long long)ts.tv_sec * 1000 + ts.tv_nsec / 1000000;
}

static long read_rss_kb(pid_t pid) {
  char path[64], line[256];
  snprintf(path, sizeof path, "/proc/%d/status", (int)pid);
  FILE *f = fopen(path, "r");
  if (!f) return -1;
  long kb = -1;
  while (fgets(line, sizeof line, f)) {
    if (strncmp(line, "VmRSS:", 6) == 0) { kb = atol(line + 6); break; }
  }
  fclose(f);
  return kb;
}

static long read_cpu_ms(pid_t pid) {
  char path[64], buf[1024];
  snprintf(path, sizeof path, "/proc/%d/stat", (int)pid);
  int fd = open(path, O_RDONLY);
  if (fd < 0) return -1;
  ssize_t n = read(fd, buf, sizeof buf - 1);
  close(fd);
  if (n <= 0) return -1;
  buf[n] = 0;
  char *p = strrchr(buf, ')');
  if (!p) return -1;
  /* fields after ')' start at field 3 (state); utime is 14, stime is 15 */
  unsigned long ut = 0, st = 0;
  if (sscanf(p + 2, "%*c %*d %*d %*d %*d %*d %*u %*u %*u %*u %*u %lu %lu", &ut, &st) != 2) return -1;
  static long hz = 0;
  if (!hz) hz = sysconf(_SC_CLK_TCK);
  return (long)((ut + st) * 1000 / hz);
}

static void json_escape(const char *s, char *out, size_t n) {
  size_t j = 0;
  for (size_t i = 0; s && s[i] && j + 7 < n; i++) {
    unsigned char c = (unsigned char)s[i];
    if (c == '"' || c == '\\') { out[j++] = '\\'; out[j++] = c; }
    else if (c < 0x20) { j += snprintf(out + j, n - j, "\\u%04x", c); }
    else out[j++] = c;
  }
  out[j] = 0;
}

static long file_kb(const char *p) {
  struct stat st;
  return stat(p, &st) == 0 ? (long)(st.st_size / 1024) : 0;
}

struct child_err { int stage; int err; };

static void die_child(int fd, int stage) {
  struct child_err e = { stage, errno };
  if (write(fd, &e, sizeof e) < 0) { /* nothing to do */ }
  _exit(127);
}

static void set_limit(int res, rlim_t v) {
  struct rlimit rl = { v, v };
  setrlimit(res, &rl);
}

int main(int argc, char **argv) {
  long cpu_ms = 0, wall_ms = 0, mem_kb = 0, as_kb = 0, stack_kb = 262144, fsize_kb = 65536, nproc = 128;
  long uid = -1, gid = -1;
  const char *cwd = NULL, *in = NULL, *out = NULL, *err = NULL;
  int nonet = 0;
  const char *hide[MAX_LIST]; int nhide = 0;
  char *envp[MAX_LIST + 1]; int nenv = 0;
  int i = 1;
  for (; i < argc; i++) {
    const char *a = argv[i];
    if (strcmp(a, "--") == 0) { i++; break; }
    const char *v = (i + 1 < argc) ? argv[i + 1] : NULL;
#define OPT(name) (strcmp(a, name) == 0 && v && (i++, 1))
    if (OPT("--cpu")) cpu_ms = atol(v);
    else if (OPT("--wall")) wall_ms = atol(v);
    else if (OPT("--mem")) mem_kb = atol(v);
    else if (OPT("--as")) as_kb = atol(v);
    else if (OPT("--stack")) stack_kb = atol(v);
    else if (OPT("--fsize")) fsize_kb = atol(v);
    else if (OPT("--nproc")) nproc = atol(v);
    else if (OPT("--uid")) uid = atol(v);
    else if (OPT("--gid")) gid = atol(v);
    else if (OPT("--cwd")) cwd = v;
    else if (OPT("--stdin")) in = v;
    else if (OPT("--stdout")) out = v;
    else if (OPT("--stderr")) err = v;
    else if (OPT("--hide")) { if (nhide < MAX_LIST) hide[nhide++] = v; }
    else if (OPT("--env")) { if (nenv < MAX_LIST) envp[nenv++] = (char *)v; }
    else if (strcmp(a, "--nonet") == 0) nonet = 1;
    else { fprintf(stdout, "{\"status\":\"SE\",\"error\":\"bad option %s\"}\n", a); return 2; }
#undef OPT
  }
  envp[nenv] = NULL;
  if (i >= argc) { fprintf(stdout, "{\"status\":\"SE\",\"error\":\"no command\"}\n"); return 2; }
  char **cmd = argv + i;
  int is_root = geteuid() == 0;

  /* Probe isolation capabilities up front so we can report them honestly. */
  int pipefd[2];
  if (pipe2(pipefd, O_CLOEXEC) != 0) { fprintf(stdout, "{\"status\":\"SE\",\"error\":\"pipe\"}\n"); return 2; }
  int flagpipe[2];
  if (pipe(flagpipe) != 0) { fprintf(stdout, "{\"status\":\"SE\",\"error\":\"pipe\"}\n"); return 2; }

  long long t0 = now_ms();
  pid_t pid = fork();
  if (pid < 0) { fprintf(stdout, "{\"status\":\"SE\",\"error\":\"fork\"}\n"); return 2; }
  if (pid == 0) {
    close(pipefd[0]);
    close(flagpipe[0]);
    setpgid(0, 0);
    prctl(PR_SET_PDEATHSIG, SIGKILL);
    /* Redirections are opened with the supervisor's privileges. */
    if (in) { int fd = open(in, O_RDONLY); if (fd < 0 || dup2(fd, 0) < 0) die_child(pipefd[1], 1); close(fd); }
    else { int fd = open("/dev/null", O_RDONLY); if (fd >= 0) { dup2(fd, 0); close(fd); } }
    if (out) { int fd = open(out, O_WRONLY | O_CREAT | O_TRUNC, 0644); if (fd < 0 || dup2(fd, 1) < 0) die_child(pipefd[1], 2); close(fd); }
    if (err) { int fd = open(err, O_WRONLY | O_CREAT | O_TRUNC, 0644); if (fd < 0 || dup2(fd, 2) < 0) die_child(pipefd[1], 3); close(fd); }

    char flags[2] = { '0', '0' };
    if (is_root && nonet && unshare(CLONE_NEWNET) == 0) flags[0] = '1';
    if (is_root && nhide > 0 && unshare(CLONE_NEWNS) == 0 &&
        mount("none", "/", NULL, MS_REC | MS_PRIVATE, NULL) == 0) {
      int ok = 1;
      for (int h = 0; h < nhide; h++) {
        struct stat st;
        if (stat(hide[h], &st) != 0) continue;
        if (mount("tmpfs", hide[h], "tmpfs", MS_RDONLY | MS_NOSUID | MS_NODEV | MS_NOEXEC, "size=4k,mode=0555") != 0) ok = 0;
      }
      if (ok) flags[1] = '1';
    }
    if (write(flagpipe[1], flags, 2) < 0) { /* ignore */ }
    close(flagpipe[1]);

    if (cwd && chdir(cwd) != 0) die_child(pipefd[1], 4);

    set_limit(RLIMIT_CORE, 0);
    if (cpu_ms > 0) {
      rlim_t s = (rlim_t)((cpu_ms + 999) / 1000 + 1);
      struct rlimit rl = { s, s + 1 };
      setrlimit(RLIMIT_CPU, &rl);
    }
    if (as_kb > 0) set_limit(RLIMIT_AS, (rlim_t)as_kb * 1024);
    set_limit(RLIMIT_STACK, stack_kb > 0 ? (rlim_t)stack_kb * 1024 : RLIM_INFINITY);
    if (fsize_kb > 0) set_limit(RLIMIT_FSIZE, (rlim_t)fsize_kb * 1024);

    if (is_root && gid >= 0) {
      if (setgroups(0, NULL) != 0) die_child(pipefd[1], 5);
      if (setgid((gid_t)gid) != 0) die_child(pipefd[1], 5);
    }
    if (is_root && uid >= 0) {
      /* NPROC only means anything for a dedicated uid. */
      if (nproc > 0) set_limit(RLIMIT_NPROC, (rlim_t)nproc);
      if (setuid((uid_t)uid) != 0) die_child(pipefd[1], 6);
    }
    prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0);
    execvpe(cmd[0], cmd, envp);
    die_child(pipefd[1], 7);
  }

  close(pipefd[1]);
  close(flagpipe[1]);
  char flags[2] = { '0', '0' };
  if (read(flagpipe[0], flags, 2) < 0) { /* child died early */ }
  close(flagpipe[0]);

  int status = 0;
  struct rusage ru;
  memset(&ru, 0, sizeof ru);
  long peak_kb = 0;
  int killed_wall = 0, killed_mem = 0, killed_cpu = 0;
  for (;;) {
    pid_t r = wait4(pid, &status, WNOHANG, &ru);
    if (r == pid) break;
    if (r < 0 && errno != EINTR) break;
    long rss = read_rss_kb(pid);
    if (rss > peak_kb) peak_kb = rss;
    if (mem_kb > 0 && rss > mem_kb) { killed_mem = 1; kill(-pid, SIGKILL); kill(pid, SIGKILL); }
    long c = read_cpu_ms(pid);
    if (cpu_ms > 0 && c > cpu_ms) { killed_cpu = 1; kill(-pid, SIGKILL); kill(pid, SIGKILL); }
    if (wall_ms > 0 && now_ms() - t0 > wall_ms) { killed_wall = 1; kill(-pid, SIGKILL); kill(pid, SIGKILL); }
    struct timespec ts = { 0, 2 * 1000 * 1000 };
    nanosleep(&ts, NULL);
  }
  long long wall = now_ms() - t0;
  kill(-pid, SIGKILL); /* reap stragglers in the process group */

  struct child_err ce = { 0, 0 };
  ssize_t got = read(pipefd[0], &ce, sizeof ce);
  close(pipefd[0]);

  long cpu = ru.ru_utime.tv_sec * 1000 + ru.ru_utime.tv_usec / 1000 + ru.ru_stime.tv_sec * 1000 + ru.ru_stime.tv_usec / 1000;
  long mem = ru.ru_maxrss > peak_kb ? ru.ru_maxrss : peak_kb;
  int exit_code = WIFEXITED(status) ? WEXITSTATUS(status) : -1;
  int sig = WIFSIGNALED(status) ? WTERMSIG(status) : 0;

  const char *st = "OK";
  char emsg[256] = "";
  if (got == (ssize_t)sizeof ce) {
    static const char *stages[] = { "", "stdin", "stdout", "stderr", "chdir", "setgid", "setuid", "exec" };
    snprintf(emsg, sizeof emsg, "%s: %s", ce.stage < 8 ? stages[ce.stage] : "?", strerror(ce.err));
    st = "SE";
  } else if (killed_mem) st = "MLE";
  else if (killed_wall || killed_cpu) st = "TLE";
  else if (sig == SIGXCPU || (cpu_ms > 0 && cpu > cpu_ms)) st = "TLE";
  else if (mem_kb > 0 && mem > mem_kb) st = "MLE";
  else if (sig == SIGXFSZ || (out && fsize_kb > 0 && file_kb(out) >= fsize_kb)) st = "OLE";
  else if (sig != 0 || exit_code != 0) {
    st = (as_kb > 0 && mem > as_kb * 9 / 10) ? "MLE" : "RE";
  }

  char esc[512];
  json_escape(emsg, esc, sizeof esc);
  printf("{\"status\":\"%s\",\"exit_code\":%d,\"signal\":%d,\"cpu_ms\":%ld,\"wall_ms\":%lld,\"mem_kb\":%ld,"
         "\"net_isolated\":%s,\"fs_isolated\":%s,\"error\":\"%s\"}\n",
         st, exit_code, sig, cpu, wall, mem, flags[0] == '1' ? "true" : "false",
         flags[1] == '1' ? "true" : "false", esc);
  return 0;
}
