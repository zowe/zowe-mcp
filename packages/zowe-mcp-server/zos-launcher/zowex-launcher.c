/*
 * This program and the accompanying materials are made available under the terms of the
 * Eclipse Public License v2.0 which accompanies this distribution, and is available at
 * https://www.eclipse.org/legal/epl-v20.html
 *
 * SPDX-License-Identifier: EPL-2.0
 *
 * Copyright Contributors to the Zowe Project.
 */

/*
 * zowex-launcher: run a program as another z/OS user via SURROGAT authority.
 *
 *   usage: zowex-launcher /absolute/path/to/program [args...]
 *   stdin: first line = target SAF userid; everything after the newline is
 *          left unread and reaches the launched program as its stdin (so a
 *          JSON-RPC stream can follow the userid on the same pipe).
 *
 * Identity switch (design: docs/zos-local-zowex-identity.md): the target
 * program is started with __spawn2() + SPAWN_SETUSERID, which creates the
 * child in a NEW address space dubbed under the TARGET user's complete
 * security environment — UID, GID, and the supplementary group list built
 * from the target's security-product group connections. Authorization is
 * the same as for setuid(): the invoker's READ access to BPX.SRV.<userid>
 * in the SURROGAT class (the documented non-daemon path). No password,
 * ticket, or token is involved.
 *
 * Validated on a live RACF LPAR (2026-10-08): setuid()-then-exec — the
 * previous design — does NOT rebuild the POSIX supplementary group list, so
 * the switched process retained the invoker's groups, and that leaked list
 * conveyed REAL authority (a group-readable file of the server identity was
 * readable as the target user). initgroups()/setgroups() need superuser or
 * the target's password, and a __login() environment does not survive exec
 * and refuses spawn. Identity-spawn is IBM's documented replacement for the
 * whole initgroups+setgid+setuid+exec sequence, and the spawned child was
 * verified to carry exactly the target's groups (the invoker-group read was
 * denied). The launcher stays resident to wait for the child and mirrors
 * its exit status, forwarding termination signals.
 *
 * The userid arrives on stdin, never argv (visible in ps) and never the
 * environment (inherited by children).
 *
 * When BPX.DAEMON is defined in FACILITY, the address space must be clean:
 * this binary needs `extattr +p` and every STEPLIB dataset it loads from
 * must be covered in the PROGRAM class, or the identity spawn fails with
 * EMVSERR/JRENVDIRTY.
 *
 * PROTOTYPE for on-LPAR validation. Requires security/integrity specialist
 * review before any production-shaped use.
 */

#define _UNIX03_SOURCE 1 /* SUSv3: setenv */
#define _OPEN_SYS 1      /* z/OS extensions: __errno2, EMVSERR, __spawn2 */

#include <ctype.h>
#include <errno.h>
#include <pwd.h>
#include <signal.h>
#include <spawn.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/wait.h>
#include <unistd.h>

#define MAX_USERID_LEN 8

/* Exit codes, kept distinct so a caller can map them to operator guidance. */
#define EXIT_USAGE 2
#define EXIT_BAD_INPUT 3
#define EXIT_UNKNOWN_USER 4
#define EXIT_SWITCH_FAILED 5
#define EXIT_REFUSED_UID0 6
#define EXIT_EXEC_FAILED 127

extern char **environ;

static void warnmsg(const char *what) {
  fprintf(stderr, "zowex-launcher: warning: %s: %s (errno=%d errno2=%08x)\n", what,
          strerror(errno), errno, __errno2());
}

static void failmsg(const char *what) {
  fprintf(stderr, "zowex-launcher: error: %s: %s (errno=%d errno2=%08x)\n", what,
          strerror(errno), errno, __errno2());
}

/*
 * Read the first stdin line one byte at a time so nothing past the newline is
 * consumed — the rest of the stream belongs to the launched program.
 */
static int read_userid(char *buf, size_t bufsize) {
  size_t len = 0;
  for (;;) {
    char c;
    ssize_t n = read(STDIN_FILENO, &c, 1);
    if (n < 0) {
      if (errno == EINTR) {
        continue;
      }
      failmsg("reading userid from stdin");
      return -1;
    }
    if (n == 0 || c == '\n') {
      break;
    }
    if (c == '\r') {
      continue;
    }
    if (len >= bufsize - 1) {
      fprintf(stderr, "zowex-launcher: error: userid longer than %d characters\n",
              MAX_USERID_LEN);
      return -1;
    }
    buf[len++] = (char)toupper((unsigned char)c);
  }
  buf[len] = '\0';
  if (len == 0) {
    fprintf(stderr, "zowex-launcher: error: no userid on stdin\n");
    return -1;
  }
  return 0;
}

/* SAF userid: 1-8 chars from A-Z, 0-9, #, $, @ (already upper-folded). */
static int valid_userid(const char *userid) {
  size_t i;
  for (i = 0; userid[i] != '\0'; i++) {
    char c = userid[i];
    if (!((c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '#' || c == '$' ||
          c == '@')) {
      return 0;
    }
  }
  return i >= 1 && i <= MAX_USERID_LEN;
}

/* Forward termination signals to the identity-spawned child. */
static pid_t child_pid = -1;
static void forward_signal(int sig) {
  if (child_pid > 0) {
    kill(child_pid, sig);
  }
}

int main(int argc, char **argv) {
  char userid[MAX_USERID_LEN + 1];
  struct passwd *pw;
  struct __inheritance inh;
  struct sigaction sa;
  int status;
  pid_t waited;

  if (argc < 2 || argv[1][0] != '/') {
    fprintf(stderr,
            "usage: zowex-launcher /absolute/path/to/program [args...]\n"
            "       (target userid is read as the first line of stdin)\n");
    return EXIT_USAGE;
  }

  if (read_userid(userid, sizeof(userid)) != 0) {
    return EXIT_BAD_INPUT;
  }
  if (!valid_userid(userid)) {
    fprintf(stderr, "zowex-launcher: error: userid is not a valid SAF userid\n");
    return EXIT_BAD_INPUT;
  }

  errno = 0;
  pw = getpwnam(userid);
  if (pw == NULL) {
    fprintf(stderr, "zowex-launcher: error: unknown user or no OMVS segment: %s\n",
            userid);
    return EXIT_UNKNOWN_USER;
  }

  if (pw->pw_uid == 0) {
    fprintf(stderr, "zowex-launcher: error: refusing to switch to a UID 0 user\n");
    return EXIT_REFUSED_UID0;
  }

  /* The child must never see a stray _BPX_USERID: it would silently retarget
   * every spawn the child itself issues. The identity goes through the
   * inheritance structure only. */
  if (unsetenv("_BPX_USERID") != 0) {
    warnmsg("unsetenv _BPX_USERID (continuing)");
  }
  if (setenv("HOME", pw->pw_dir, 1) != 0 || setenv("USER", userid, 1) != 0 ||
      setenv("LOGNAME", userid, 1) != 0) {
    warnmsg("setting HOME/USER/LOGNAME (continuing)");
  }

  memset(&inh, 0, sizeof(inh));
  inh.flags = SPAWN_SETUSERID | SPAWN_SETCWD;
  strncpy(inh.userid, userid, sizeof(inh.userid) - 1);
  inh.cwdptr = pw->pw_dir;
  inh.cwdlen = (int)strlen(pw->pw_dir);

  /* All open fds are inherited (fd_count 0): the remaining stdin stream and
   * the stdout/stderr pipes connect the caller directly to the child. */
  child_pid = __spawn2(argv[1], 0, NULL, &inh,
                       (const char **)&argv[1], (const char **)environ);
  if (child_pid < 0 && errno != EPERM && errno != EMVSERR) {
    /* A missing/inaccessible target home fails SETCWD-style; retry in the
     * invoker's cwd (same warn-and-continue the old chdir had). */
    int saved = errno;
    inh.flags = SPAWN_SETUSERID;
    inh.cwdptr = NULL;
    inh.cwdlen = 0;
    errno = saved;
    warnmsg("identity spawn with target home as cwd (retrying in current cwd)");
    child_pid = __spawn2(argv[1], 0, NULL, &inh,
                         (const char **)&argv[1], (const char **)environ);
  }
  if (child_pid < 0) {
    failmsg("identity spawn");
    if (errno == EPERM) {
      fprintf(stderr,
              "zowex-launcher: hint: the invoking user needs READ on BPX.SRV.%s "
              "in the SURROGAT class\n",
              userid);
      return EXIT_SWITCH_FAILED;
    }
    if (errno == EMVSERR) {
      fprintf(stderr,
              "zowex-launcher: hint: errno2 xxxx02AF (JRENVDIRTY) means the address "
              "space is not program-controlled: extattr +p this binary and cover "
              "every STEPLIB dataset in the PROGRAM class\n");
      return EXIT_SWITCH_FAILED;
    }
    /* ENOENT/EACCES/ELOOP…: the program could not be run at all. */
    return EXIT_EXEC_FAILED;
  }

  /* Stay resident as a transparent middleman: forward termination signals,
   * then mirror the child's exit so the caller sees unchanged semantics. */
  memset(&sa, 0, sizeof(sa));
  sa.sa_handler = forward_signal;
  sigaction(SIGTERM, &sa, NULL);
  sigaction(SIGINT, &sa, NULL);
  sigaction(SIGHUP, &sa, NULL);

  for (;;) {
    waited = waitpid(child_pid, &status, 0);
    if (waited >= 0) {
      break;
    }
    if (errno != EINTR) {
      failmsg("waitpid");
      return EXIT_EXEC_FAILED;
    }
  }
  if (WIFSIGNALED(status)) {
    /* Die by the same signal, so the caller observes what the child did. */
    int sig = WTERMSIG(status);
    signal(sig, SIG_DFL);
    raise(sig);
    return 128 + sig; /* unreachable unless the signal is ignored */
  }
  return WIFEXITED(status) ? WEXITSTATUS(status) : EXIT_EXEC_FAILED;
}
