# Crucible — product brief

## The problem

Coding-test platforms answer one question well: *did the code pass the tests?* Hiring teams need answers to three more:

1. **Is it a good solution?** An O(n²) answer often passes if the tests are not large enough. Reviewers rarely have time to read every submission.
2. **How did they get there?** A clean final file says nothing about whether it took two minutes or ninety, or whether it arrived in one paste.
3. **Did they write it?** Copy detection is either absent or a blunt "similarity 87%" that punishes the person who was copied as much as the person who copied.

At the same time, candidates distrust opaque proctoring, and practice platforms reward grinding over understanding.

## Who it's for

| Persona | Job to be done | What Crucible gives them |
|---|---|---|
| **Hiring manager / recruiter** | Shortlist fairly and quickly | Ranked results, score distribution, per-question averages, and one report per candidate with evidence |
| **Interviewer** | Prepare the next round | Measured complexity, code playback and AI-suggested follow-up questions |
| **Candidate** | Show their ability without feeling surveilled | A fast IDE with live results, plus an upfront and complete list of what is recorded. No camera, microphone or screen capture |
| **Learner** | Get better at problem solving | Practice problems, instant feedback, complexity feedback, progress, rank and a skill radar |
| **Question author** | Ship correct questions | Reference-driven expected outputs, one-click validation, a complexity target with an input generator |

## How Crucible differs from HackerRank-style platforms

| Capability | Typical platform | Crucible |
|---|---|---|
| Test feedback | Shown once the whole run finishes | Each test case streams in live, with CPU time and memory |
| Efficiency | Implicit in time limits | **Measured growth curve** and Big-O estimate against a target |
| Plagiarism | Pairwise similarity score | Winnowing plus comparison with reference solutions **plus authorship evidence** (paste or burst versus typed) |
| Proctoring | Often camera-based and opaque | Opt-in webcam snapshots with **on-device** face detection, identity check, lockdown and device/network checks — all listed to the candidate before they start, each with its own retention period |
| Code history | Final submission | **Playback** of the whole writing process |
| SQL | Usually one dataset | Several hidden datasets, row-order aware, sandboxed |
| Authoring | Hand-written expected outputs | Expected outputs computed from the reference solution; validation runs the reference against every test |
| Review | Manual | Optional structured AI review with follow-up questions; teammates review shared assessments and mark each flag explained or concern |
| Learning | Editorial visible to anyone | Progressive hints, editorial unlocked by effort, **withheld during contests and assessments** |

## Principles

- **Evidence, not verdicts.** Every flag links to what triggered it. Integrity signals inform a conversation; they don't auto-reject.
- **Transparency for candidates.** The test intro lists exactly what is recorded.
- **Fairness by design.** The person who was copied is not penalized like the copier. Canonical solutions to canonical problems are not flagged as cheating. Thresholds rise for short programs.
- **Honest measurement.** The complexity estimate is labelled as empirical, and isolation is reported as it actually is on each host.

## Scope delivered (v0.1)

- Multi-language sandboxed judge (8 languages) with a start-up self-test
- Coding, SQL and MCQ questions; five checker types including custom Python
- Practice: problem list, IDE, run/submit, live results, history, dashboard, leaderboard
- Assessments: builder, invite links, timed test-taking with autosave and auto-submit
- Reports: score and percentile, integrity timeline, playback, per-test results, complexity, plagiarism, optional AI review
- Proctoring (v0.2): webcam snapshots with on-device face detection, identity check, paste/copy lockdown, one-browser lock, second-display and duplicate-tab detection, device fingerprinting and shared-device detection, question pools, automatic retention
- Question library and editor with validation
- 90 automated tests, including security-boundary tests, proctoring tests, and cross-language verification of the problem set, plus 13 Playwright browser tests with WCAG 2.1 AA audits
- Reviewer workflow (v0.3): review queue, compare candidates, decisions and notes, CSV export, PDF reports; light/dark themes, command palette, redesigned IDE and landing page
- v0.4: live ICPC-style contests with scoreboard freeze; team hiring (editor and reviewer roles, per-flag review); progressive hints and editorials for every built-in problem; on-demand code loading (landing page JS 1,075 KB → 255 KB); WCAG 2.1 AA in both themes

## Success metrics

- **Signal quality:** correlation between assessment score and onsite outcome; share of candidates where the complexity analysis changed the decision.
- **Reviewer time:** median time from submission to decision.
- **Candidate experience:** completion rate; post-test CSAT; share of candidates who say they understood what was recorded.
- **Integrity accuracy:** precision of high-severity flags, confirmed by reviewers.

## Roadmap

**Next**
- Email delivery of invites and reminders; ATS webhooks (Greenhouse, Lever)
- Organization workspaces (beyond per-assessment sharing); sharing reports with interviewers
- Live interview mode: a shared editor and judge with the interviewer watching
- Contest extras: virtual participation in past contests, rating changes, clarifications
- Question versioning, so editing a question never changes past results

**Proctoring, next**
- A second camera angle via a paired phone, showing the desk and screen
- Optional screen-share snapshots, consent-gated like the webcam
- Assisted face matching between selfie, ID and snapshots (reviewer-confirmed, never automatic rejection)

**Hardening**
- A seccomp syscall allow-list in the sandbox supervisor; optional gVisor or Firecracker backend
- Judge workers as separate services behind a queue, for horizontal scale
- Rate limiting and audit logs; Postgres option for larger deployments

**Learning**
- AI hints that explain *why* a solution is too slow, using the measured growth curve
- Spaced repetition over weak topics on the skill radar
