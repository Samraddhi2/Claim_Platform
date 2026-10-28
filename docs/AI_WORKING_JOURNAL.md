# AI working journal

A running record of **what was asked of the AI, what it produced, what was checked, and what still needs a human decision.**
The rule of the house: you sign off every line you submit, so anything marked *Your call* below is yours to accept, change or reject.

| Item | Detail |
|---|---|
| Last updated | 28 October 2026 |
| AI used | Claude (Anthropic), in an agentic coding session |
| Sessions logged | 1. Original build of the app. 2. Tests, screenshots and documentation (this update) |

**How to read the status words**

| Word | Meaning |
|---|---|
| **Verified** | The AI ran it and saw the result. The evidence is named. |
| **Partly verified** | Run in a reduced environment or by a different tool than the real one. The gap is stated. |
| **Not verified** | Written but never executed. |
| **Your call** | A judgement or business decision a human must own. |

---

## 1. Timeline of session 2: tests, screenshots, documentation

![Timeline of session 2](images/diagrams/journal-session-timeline.png)

---

## 2. What was asked and what came back

| # | The ask | What the AI produced | Status | Your call |
|---|---|---|---|---|
| 2.1 | Read the repository, understand the project, and make the README, architecture and AI journal more visual and easier to follow | Three rewritten documents, 8 screenshots, Mermaid diagrams for architecture, lifecycle, sequence, data model and test results | **Verified** against source: endpoints, rules, defaults and file names were checked line by line. Diagrams are PNG images generated with the Mermaid CLI from sources in `docs/diagrams/`, so they look the same in VS Code, GitHub and any viewer. The rendered images were looked at | Read the prose and confirm it says what you would say |
| 2.2 | Test the frontend and report the score | Test runner set up (`karma.conf.js`, `tsconfig.spec.json`, `test` target in `angular.json`, `npm test` and `npm run test:ci`). 388 specs across 16 spec files plus a shared fixtures file | **Verified.** Run in headless Chromium: 388 of 388 pass, 100% statements, branches, functions and lines (573/573, 169/169, 219/219, 467/467), all 22 source files at 100% | Run `npm run test:ci` once on your machine |
| 2.3 | Test the backend and report the score | 172 new xUnit tests in three files (`ClaimStateMachineMatrixTests`, `DomainModelTests`, `EventContractTests`) next to the 20 that already existed, 192 in total. `coverlet.collector` added so `dotnet test --collect:"XPlat Code Coverage"` works | **Partly verified.** 192 of 192 pass, but run through an xUnit-compatible stand-in, not the real xUnit runner (see 3.1) | Run `dotnet test` once. This is the one confirmation the AI could not give |
| 2.4 | Put the percent and score in the README | A scoreboard: pass rate 580 of 580 (100%), frontend coverage 100%, backend coverage **6.4%** overall with a file-by-file map | **Verified** for the numbers; method described in the README | Decide whether you are comfortable showing the 6.4% figure openly (the AI recommends yes) |
| 2.5 | *(AI's own initiative)* Prove the tests can fail | One bug injected at a time: 12 in the frontend, 11 in the backend. Every injected bug turned the suite red, then the file was restored | **Verified.** Results are in the README | None |
| 2.6 | *(AI's own initiative)* Screenshots for the README | 8 PNGs in `docs/images/` | **Partly verified.** Real Angular build, but the data comes from a throw-away stand-in API (3.2) | Retake against the real API if you want them to be fully authentic |

---

## 3. Constraints the AI hit, and what it did about them

### 3.1 The backend could not be restored or built

The sandbox could not reach the NuGet feed, so EF Core, Kafka, xUnit and coverlet could not be installed. A .NET SDK was available from the OS package manager.

Choices made:

| Choice | Reason | Cost |
|---|---|---|
| Compile the **real test files, unchanged,** against a tiny xUnit-compatible stand-in and run them | A test that has been run is worth more than one that has not | Not the real xUnit runner |
| Run them against the production files that need only the .NET base library: `Domain/*`, `Dtos.cs`, `Events.cs` | They are the only ones that can compile without EF Core or Kafka | Anything that touches EF Core or Kafka stays unrun |
| Measure coverage with a small Roslyn instrumenter | coverlet was not available | It reports *statement* coverage, close to but not equal to coverlet's line coverage; no branch or function figures |
| **Do not** commit tests for `ClaimCommands`, `ClaimQueries`, endpoints, handlers or the outbox | They could not be run, and an unrun test may be wrong | Backend coverage is 6.4% overall. The README says so plainly |

### 3.2 The backend could not be started, so screenshots use a stand-in API

A small Node server served the built Angular app and answered `/api/*` with the same JSON shapes and the same business rules (transitions, four-eyes, which buttons each role sees). Data is fictional. It is not part of the repository.

### 3.3 The production build and Google Fonts

`ng build` (production) tries to inline the Google Fonts stylesheet at build time and the sandbox blocks that request. With font inlining temporarily switched off, the production build compiles (277 kB initial, 79 kB gzipped) and the config was then restored. On a normal machine with internet access this is not an issue.

---

## 4. Things the AI got wrong along the way

Mistakes are useful evidence of why human review matters, so they are kept here.

| Where | Mistake | How it was caught | Fix |
|---|---|---|---|
| Frontend interceptor spec | Passed an `unknown` value where the compiler needed a body type | TypeScript error TS2345 | Typed the helper's argument |
| Routing spec | Asserted 8 lazy routes; the app has 9 | Test failed | Corrected to 9 |
| Claims list and dashboard specs | 13 failures: the test module was configured twice, and a periodic timer leaked out of a `fakeAsync` block | Test failures with a clear message | Reset the module in setup; switched to an async boot with a short real wait |
| Coverage | 8 defensive branches (for example "page rendered before data arrives") were uncovered | Coverage report | Wrote specs for those paths rather than excluding them |
| Coverage | The shared fixtures file counted towards coverage and flattered the number | Looking at which files were in the report | Excluded `src/testing/**` |
| Backend coverage tool | Two bugs in the instrumenter, and a rebuild that **silently reused an old binary** because the tool project was compiling its own output folder | The numbers did not change after a fix, which was suspicious | Excluded output folders from compilation; re-ran from clean |
| First draft of ARCHITECTURE.md | Said unreadable event JSON counts as "processed" (only a literal `null` does; bad JSON is retried then skipped). Said the API trusts the SPA's threshold (it is the other way round). Said the relay retries every 2 s (a publish attempt first times out after 8 s) | Re-reading the draft against `Messaging.cs` and the SPA source | Corrected before delivery |
| Screenshot data | A claimant from Malaysia had claims in Thailand | Looking at the images | Aligned claim market with claimant market |

---

## 5. Issues found in the existing project

These were **not** changed in the code. They are listed so you can decide.

| # | Where | Observation | Impact | Suggested action | Your call |
|---|---|---|---|---|---|
| 5.1 | `Infrastructure/Messaging.cs` | After 3 failed attempts an event is logged and skipped, and in Kafka mode the offset is still committed, so the event is dropped for good | Medium. A permanent bug in a handler silently loses notifications | Dead-letter topic and an alert (already listed as a shortcut) | [ ] |
| 5.2 | In-memory mode | Events already stamped as sent but still in the in-process channel are lost if the process stops. The old docs implied the outbox covered restarts; it covers only events not yet sent | Low (development mode) | Say so (done in ARCHITECTURE.md, 4.7) or use Kafka | [ ] |
| 5.3 | Frontend `claim-detail.component.ts`, `dashboard.component.ts` | The 50,000 threshold is written into the SPA (one constant and three text strings, in two files) although `GET /api/system/info` already returns `approvalThreshold` | Medium. Change it on the server and the UI text goes stale | Read the value from the API | [ ] |
| 5.4 | `Application/ClaimQueries.cs` | The dashboard's open-claim counts are live, but its exposure totals come from the asynchronous projection, so the two can briefly disagree | Low. The UI shows "Exposure updated X ago" | Keep, or compute both from one source | [ ] |
| 5.5 | `Infrastructure/Handlers.cs` | `ExposureProjector` loads every claim in a (market, type) bucket on each event | Low now, grows with data | Aggregate in SQL or incrementally | [ ] |
| 5.6 | `Infrastructure/Messaging.cs` (comment on `OutboxDispatcher`) | The comment mentions a `ClaimService` that no longer exists; the class is `ClaimCommands` | Cosmetic | Edit the comment | [ ] |
| 5.7 | Old README and ARCHITECTURE | `GET /api/me` and `GET /api/officers` were missing from the API table, and the lifecycle sketch left out the Assessed to UnderReview ("sent back") transition | Documentation only | Corrected in the new documents | done |
| 5.8 | Backend tests | Before this session: 20 tests, all on the state machine. Nothing on the database, HTTP, handlers or outbox | High for a production claim system | API integration tests (see ARCHITECTURE.md, section 10) | [ ] |

---

## 6. Decisions the original AI made that you should confirm or change

Carried over from the first session, with additions from this one.

- [ ] Modular monolith rather than separate notification and reporting services
- [ ] SQLite with in-memory decimal aggregation (fine for a demo, not for production)
- [ ] The $50,000 manager-approval threshold (an invented business rule)
- [ ] Exposure = approved, else assessed, else claimed, while a claim is open
- [ ] Demo header-based authentication instead of JWT
- [ ] Retry 3 times then log, instead of a dead-letter topic
- [ ] **New:** seven dev dependencies added to the SPA (`karma`, `karma-chrome-launcher`, `karma-coverage`, `karma-jasmine`, `karma-jasmine-html-reporter`, `jasmine-core`, `@types/jasmine`); review `package.json`
- [ ] **New:** `coverlet.collector` 6.0.2 added to the backend test project
- [ ] **New:** `.gitignore` entries for `coverage/`, `out-tsc/`, `TestResults/`
- [ ] **New:** showing the backend figure as 6.4% overall (not only "100% of what is tested")
- [ ] **New:** screenshots taken against a stand-in API

---

## 7. Verification ledger

Everything stated in the README, with how it was established.

| Claim | Evidence | Status |
|---|---|---|
| Frontend: 388 of 388 specs pass | `ng test` in headless Chromium, run several times in this session, final clean run 28 Oct 2026 | **Verified** |
| Frontend coverage 100% (573/573, 169/169, 219/219, 467/467) | `karma-coverage` summary; all 22 files at 100% | **Verified** |
| Frontend tests catch bugs (12 of 12 injected bugs caught) | Mutation run, results kept | **Verified** |
| Backend: 192 of 192 tests pass | Real test files, stand-in runner | **Partly verified** |
| Backend coverage 6.4% (38 of 593 statements) | Roslyn statement instrumenter over all 13 backend files | **Partly verified** (method differs from coverlet) |
| Backend tests catch bugs (11 of 11 injected bugs caught) | Mutation run, results kept | **Verified** (in the stand-in runner) |
| Angular production build compiles | Build run with font inlining disabled | **Verified**, apart from the network-only font step |
| The whole .NET API builds and starts | Not possible in the sandbox | **Not verified** |
| End-to-end demo script, with and without Kafka | Not possible in the sandbox | **Not verified** |
| Docs match the code | Checked against source while writing; errors in the AI's own drafts were found and fixed (section 4) | **Verified**, but a second human read is worthwhile |
| Diagrams are visible in any viewer | Rendered to PNG with the Mermaid CLI and embedded as images; the page was also rendered with a plain Markdown engine that has no Mermaid support, to mimic VS Code's preview | **Verified** |

### Still to run on your machine

- [ ] `cd backend && dotnet build && dotnet test` (expect 192 passing)
- [ ] `cd backend && dotnet test --collect:"XPlat Code Coverage"` (expect a figure near 6%)
- [ ] `cd frontend && npm install && npm run test:ci` (expect 388 passing, 100% coverage)
- [ ] `cd frontend && npm run build`
- [ ] The README's 3-minute tour, once with `Messaging:Provider=InMemory` and once with Kafka

---

## 8. What worked when working with the AI

- **Ask for evidence, not assertions.** Every number in the README traces back to a command that was run. Where something could not be run, the document says so.
- **Make the tests prove they can fail.** All 23 injected bugs were caught; injecting them is the only way to know a suite is not hollow.
- **Say what is missing.** With no package feed, the choice was between a flattering coverage figure and an honest one. The honest one is in the README.
- **Re-read the AI's prose against the code.** Even careful drafts contained wrong statements (section 4). Documentation is the place where plausible-sounding errors hide.
- **Treat the AI's own mistakes as a log, not an embarrassment.** They show where review pays off.

---

## 9. Your own entries

Add a row each time you ask the AI for something and decide what to do with the answer.

| # | Prompt / ask | AI output | Accepted / challenged / overrode | Reasoning |
|---|---|---|---|---|
| 1 | "Fullstack project for the assessment: Angular 17 + .NET + Kafka for async; must run with or without Kafka; attractive UI; every button works end-to-end." | Modular monolith, REST for commands and queries, outbox to `IEventPublisher` with in-memory and Kafka providers, notifications and the exposure projection as consumers | *(fill in)* | One config switch keeps one code path; the outbox avoids the dual-write problem |
| 2 | *(for example: "Why a monolith? Argue the case for two services.")* | | | |
| 3 | *(for example: "Walk me through what happens if Kafka is down mid-request.")* | | | |
