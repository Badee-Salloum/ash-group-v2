# Test Specifications — ASH Group v2

This document lists every test case the project should have, grouped by module. Each item has:
- **Status:** ✅ implemented · 🟡 partial · ⏳ TODO
- **File:** the test file (or planned location)
- **Purpose:** what bug or behaviour it locks in

Run all tests: `npx vitest run`

---

## 1. Reconciliation — Deposits (`tests/reconciliation.deposits.test.ts`)

| # | Status | Test | Why it matters |
|---|---|---|---|
| 1.1 | ✅ | matches deposit by SC TX ID | Core happy path |
| 1.2 | ✅ | REGRESSION: SC deposit looking internal but with real platform partner is matched | Match-first classify-later — was a real bug |
| 1.3 | ✅ | SC deposit + wallet match + no platform → internalTransfers | Heuristic still applies post-match |
| 1.4 | ✅ | SC deposit external + no platform → shamCashOnly | Negative case for internal heuristic |
| 1.5 | ✅ | discrepancy when TX ID matches but amount differs | Direction P-higher / SC-higher |
| 1.6 | ✅ | currency mismatch leaves both sides unmatched | Currency safety |
| 1.7 | ⏳ | platform deposit without `shamCashTxId` → platformOnly | Untagged platform rows |
| 1.8 | ⏳ | discrepancySCHigher reported with correct diff | SC-higher direction |
| 1.9 | ⏳ | duplicate SC TX IDs in same file: only one matches | Map collision behaviour |
| 1.10 | ⏳ | `resolveHistoricalComplaints` matches old PENDING_SC by `platformUserId` | Cross-batch resolution |

## 2. Reconciliation — Withdrawals (`tests/reconciliation.withdrawals.test.ts`)

| # | Status | Test | Why it matters |
|---|---|---|---|
| 2.1 | ✅ | Phase 1: matches by `BankTranferComment` regardless of time gap | Core: TX-ID matching |
| 2.2 | ✅ | DISCREPANCY (P higher) when txId matches but amount differs | Direction routing |
| 2.3 | ✅ | DISCREPANCY (SC higher) when txId matches but SC > P | Reverse direction |
| 2.4 | ✅ | currency mismatch even with same txId → no match | Currency safety |
| 2.5 | ✅ | Phase 2 (time-based) DISABLED: no match without txId link even with perfect time | Locks in disable |
| 2.6 | ✅ | sub-second gap: no match without txId | Same locking |
| 2.7 | ✅ | SC sends to own walletIdentifiers → internalTransfers (NOT shamCashOnly) | Bucket separation |
| 2.8 | ✅ | external SC withdrawal stays in shamCashOnly | Negative case |
| 2.9 | ✅ | REGRESSION: SC withdrawal looking internal but with real platform partner is matched | Match-first |
| 2.10 | ✅ | crossMatchSendsWithDeposits: time+amount alone does NOT match | Disabled heuristic |
| 2.11 | ✅ | crossMatchSendsWithDeposits: matches by `shamCashTxId` (TX-ID-only) | New deterministic cross-match |
| 2.12 | ✅ | crossMatch currency mismatch → no match | Currency safety |
| 2.13 | ✅ | crossMatch skips deposits already used by another step | Set-based exclusion |
| 2.14 | ⏳ | already-matched SC IDs (passed from deposit step) are not re-used in withdrawal Phase 1 | `alreadyMatchedSCIds` Set |
| 2.15 | ⏳ | platform withdrawal without `shamCashTxId` → platformOnly | Untagged platform |

## 3. Live parser tests (`tests/parser.live.test.ts`)

| # | Status | Test | Why it matters |
|---|---|---|---|
| 3.1 | ✅ | SC parser: target TX rows have correct sentAmount + type | Sham Cash file integrity |
| 3.2 | ✅ | Platform withdrawal parser: extracts shamCashTxId for target IDs | XML escaping (was a real bug) |
| 3.3 | ✅ | Diagnostic: ALL platform rows are parsed (no silent drop) | XML sanitization regression |
| 3.4 | ✅ | extractShamCashTxId: BankTranferComment with comma after | Regex coverage |
| 3.5 | ✅ | extractShamCashTxId: BankTranfeComment typo (no `r`) | Optional `r` in regex |
| 3.6 | ✅ | extractShamCashTxId: ext_trn_id pattern | Newer platform format |
| 3.7 | ✅ | extractShamCashTxId: Arabic legacy "رقم العملية" | Backward compatibility |
| 3.8 | ✅ | extractShamCashTxId returns null when nothing matches | Defensive |
| 3.9 | ✅ | End-to-end deposit reconciliation on real files: TX 199793455 + 199650168 matched | User-reported regression |

## 4. Parsers — pure unit (`tests/parser.shamCash.test.ts`)

| # | Status | Test |
|---|---|---|
| 4.1 | ✅ | shamCash: `parseAmount` handles `'00.00'`, `'1,234'`, defaults |
| 4.2 | ✅ | shamCash: anchors date/time to Asia/Damascus (+03:00) |
| 4.3 | ✅ | shamCash: type='ارسال' → WITHDRAWAL, 'استقبال' → DEPOSIT |
| 4.4 | ✅ | shamCash: missing required column raises clear error |
| 4.5 | ✅ | shamCash: duplicate TX IDs reported as errors |
| 4.6 | ✅ | shamCash: skips rows without TX ID silently |
| 4.7 | ✅ | shamCash: flags rows with missing date/time as errors |
| 4.8 | ✅ | shamCash: parses currency, defaults to USD |
| 4.9 | ⏳ | platformDeposits: parses xlsx via ExcelJS |
| 4.10 | ⏳ | platformDeposits: extracts userInfo correctly (column 14) |
| 4.11 | ✅ | platformWithdrawals: handles SpreadsheetML XML with unescaped `&` (covered by parser.live.test 3.3) |
| 4.12 | ⏳ | platformWithdrawals: handles xlsx (zip) format |

## 5. Wallet matching (`tests/walletMatch.test.ts`)

| # | Status | Test |
|---|---|---|
| 5.1 | ✅ | matches when accountName contains all words of an identifier |
| 5.2 | ✅ | requires ALL words of multi-word identifier (no partial) |
| 5.3 | ✅ | empty walletIdentifiers → never matches |
| 5.4 | ✅ | matches against accountNumber suffix |
| 5.5 | ✅ | matches against notes field |
| 5.6 | ✅ | OR semantics across multiple identifiers |
| 5.7 | ✅ | case-insensitive substring match |
| 5.8 | ✅ | single-char identifiers require exact token match (avoid false positives) |
| 5.9 | ✅ | handles undefined/null inputs gracefully |
| 5.10 | ✅ | empty walletIdentifier string is ignored |
| 5.11 | ⏳ | tolerant to "عبد لله" vs "عبد الله" via Unicode normalization |

## 5b. Auth — Signup (`tests/auth.signup.test.ts`)

POST `/api/auth/signup` accepts `{ name, email, password }`. New accounts are created inactive and must be activated by an admin before they can log in.

| # | Status | Test | Why it matters |
|---|---|---|---|
| 5b.1 | ✅ | rejects short name (<2 chars) with Arabic error | Schema validation |
| 5b.2 | ✅ | rejects invalid email | Schema validation |
| 5b.3 | ✅ | rejects short password (<8 chars) | Schema validation |
| 5b.4 | ✅ | rejects missing fields | Schema validation |
| 5b.5 | ✅ | returns 409 when email already registered | Duplicate guard |
| 5b.6 | ✅ | happy path creates user with isActive=false, role=EMPLOYEE | Activation-required policy |
| 5b.7 | ✅ | passwordHash matches bcrypt signature (never plaintext) | Security |
| 5b.8 | ✅ | name is trimmed, email is lower-cased | Normalization |
| 5b.9 | ✅ | duplicate check uses lower-cased email | Case-insensitive uniqueness |
| 5b.10 | ✅ | returns 429 with Arabic retry message when rate-limited | Brute-force protection |
| 5b.11 | ✅ | rate limit key includes client IP | IP scoping |
| 5b.12 | ⏳ | login refuses inactive accounts with helpful message (integration) | End-to-end activation flow |

## 5d. Attendance — Planned Roster Merge (`tests/attendance.planned.test.ts`)

The attendance matrix overlays the planned schedule (Shift rows) so the page shows who is *rostered* per shift even before anyone checks in. Pure helpers live in `@/lib/attendance/planned`.

| # | Status | Test | Why it matters |
|---|---|---|---|
| 5d.1 | ✅ | dayIndexOf maps weekStart → 0, each weekday → 0..6 | Correct day-column placement |
| 5d.2 | ✅ | dayIndexOf clamps out-of-range dates to [0,6] | No array overflow on stray dates |
| 5d.3 | ✅ | dayIndexOf accepts ISO string dates | Prisma `@db.Date` round-trips as string |
| 5d.4 | ✅ | buildPlannedMatrix places shifts in correct user/day slot | Core merge correctness |
| 5d.5 | ✅ | every listed user gets a 7-slot row even with no shifts | UI never indexes undefined |
| 5d.6 | ✅ | shifts for users outside the view are ignored | No cross-contamination |
| 5d.7 | ✅ | derivePlannedFields: working cell → shift set, off false | UI hint derivation |
| 5d.8 | ✅ | derivePlannedFields: day-off cell → shift null, off true | Day-off rendering |
| 5d.9 | ✅ | derivePlannedFields: no cell → both empty | Unscheduled days |

## 6. Permissions (`tests/permissions.test.ts`)

| # | Status | Test |
|---|---|---|
| 6.1 | ✅ | hasPermission(ADMIN, any) returns true for every key |
| 6.2 | ✅ | hasPermission(EMPLOYEE) restricts to SHIFTS_CHECKIN only |
| 6.3 | ✅ | hasPermission(SUPERVISOR, RECONCILIATION_UPLOAD) returns true (recently granted) |
| 6.4 | ✅ | hasPermission(SUPERVISOR) cannot manage payroll |
| 6.5 | ✅ | hasPermission(MANAGER) can run payroll, cannot manage system users/roles |
| 6.6 | ✅ | hasPermission(ACCOUNT_MGR) can edit transactions, cannot delete employees |
| 6.7 | ✅ | requirePermission returns null when granted |
| 6.8 | ✅ | requirePermission returns 403 NextResponse when missing |
| 6.9 | ✅ | 403 body contains Arabic error message |
| 6.10 | ✅ | permissionsForRole returns non-empty for every built-in role |
| 6.11 | ✅ | permissionsForRole(ADMIN) returns the full permission set |
| 6.12 | ✅ | permissionsForRole returns fresh array (defensive copy) |

## 7. Payroll (`tests/payroll.math.test.ts`)

| # | Status | Test |
|---|---|---|
| 7.1 | ✅ | Daily rate = baseSalary / max(1, 7 − weeklyOffDays) |
| 7.2 | ✅ | Daily rate clamps to 1 working day (avoid div by zero) |
| 7.3 | ✅ | proRated = dailyRate × daysWorked |
| 7.4 | ✅ | Full week worked → full base salary |
| 7.5 | ✅ | Cumulative bonus = clean weeks × 5,000 |
| 7.6 | ✅ | Cumulative resets at error week |
| 7.7 | ✅ | Cumulative respects start boundary (hireDate) |
| 7.8 | ✅ | Cumulative caps at MAX_LOOKBACK_WEEKS |
| 7.9 | ✅ | net = proRated + bonuses − deductions |
| 7.10 | ✅ | net allows negative (deductions exceed earnings) |
| 7.11 | ⏳ | Cumulative falls back to createdAt when hireDate missing (integration) |
| 7.12 | ⏳ | PAID entry returns frozen snapshot, not live values (integration) |
| 7.13 | ⏳ | Range mode aggregates bonuses across multiple weeks (integration) |

## 8. Bonuses (`tests/bonuses.api.test.ts`)

| # | Status | Test |
|---|---|---|
| 8.1 | ✅ | DELETE returns 400 when id missing |
| 8.2 | ✅ | DELETE returns 404 when bonus not found |
| 8.3 | ✅ | DELETE refuses with Arabic error if PAID payroll exists for that week |
| 8.4 | ✅ | DELETE succeeds when no PAID payroll for that week |
| 8.5 | ✅ | DELETE succeeds when bonus has no weekStart (skips PAID guard) |
| 8.6 | ⏳ | POST GROUP creates one BonusLog per userId (integration) |
| 8.7 | ⏳ | POST MANUAL creates single entry (integration) |
| 8.8 | ⏳ | Dashboard API computes cumulative live (integration) |
| 8.9 | ⏳ | Dashboard returns isPaid=true for bonuses in PAID weeks (integration) |

## 9. Shifts & Handover (`tests/shifts.handover.test.ts`)

| # | Status | Test |
|---|---|---|
| 9.1 | ✅ | approveHandover flips PENDING_START → ACTIVE on success |
| 9.2 | ✅ | approveHandover throws with Arabic error when count=0 |
| 9.3 | ✅ | approveHandover closes outgoing PENDING_END when set |
| 9.4 | ✅ | Concurrent approveHandover: only first wins (race-safe via status guard) |
| 9.5 | ⏳ | Check-in creates ACTIVE session (integration) |
| 9.6 | ⏳ | Cannot check-in twice without check-out (integration) |
| 9.7 | ⏳ | requestEnd transitions ACTIVE → PENDING_END (integration) |
| 9.8 | ⏳ | Wallet validation: rejects unauthorized walletIds (integration) |

## 10. Employees (`tests/employees.cycle.test.ts`)

| # | Status | Test |
|---|---|---|
| 10.1 | ✅ | flat hierarchy: assigning peer is safe |
| 10.2 | ✅ | direct subordinate as manager → cycle detected |
| 10.3 | ✅ | indirect (grandchild) subordinate as manager → cycle |
| 10.4 | ✅ | 5-deep indirect descendant → cycle |
| 10.5 | ✅ | sibling assignment is safe |
| 10.6 | ✅ | superior is not descendant → safe |
| 10.7 | ✅ | disconnected subtree → safe |
| 10.8 | ✅ | self as manager → cycle (degenerate) |
| 10.9 | ⏳ | POST creates new employee with auto-generated EMP-XXXX code (integration) |
| 10.10 | ⏳ | POST with existing inactive email reactivates (integration) |
| 10.11 | ⏳ | DELETE soft-deletes and detaches from manager chain (integration) |
| 10.12 | ⏳ | Friendly Arabic errors for unique-constraint failures (integration) |

## 11. Dedupe (`tests/dedupe.test.ts`)

Tests now import directly from `@/lib/reconciliation/dedupeLogic` so a regression in the production code surfaces here (previously the test file duplicated the logic locally — silent drift was possible).

| # | Status | Test |
|---|---|---|
| 11.1 | ✅ | PENDING_SC categorized as stale |
| 11.2 | ✅ | PENDING_P categorized as stale |
| 11.3 | ✅ | MATCHED categorized as kept (drop new) |
| 11.4 | ✅ | DISCREPANCY/WASTE categorized as kept |
| 11.5 | ✅ | rows with null idKey are skipped (defensive) |
| 11.6 | ✅ | mixed batch routes to correct buckets |
| 11.7 | ✅ | orphan-pair pruning: keep both pair partners when intact |
| 11.8 | ✅ | orphan-pair pruning: drop both when one is dropped |
| 11.9 | ✅ | unpaired records unaffected by drop set |
| 11.10 | ✅ | multiple pairs handled independently |
| 11.11 | ✅ | prunePairs: drops pair when either id dropped |
| 11.12 | ✅ | prunePairs: keeps untouched pairs |
| 11.13 | ✅ | prunePairs: returns empty when both dropped |
| 11.14 | ⏳ | matchedTxId cleared before stale delete (FK safety, integration) |

## 12. Historical match endpoints (`tests/historical.test.ts` + `historical.platform.test.ts`)

| # | Status | Test |
|---|---|---|
| 12.1 | ✅ | resolveHistoricalComplaints matches by platformUserId + amount |
| 12.2 | ✅ | resolveHistoricalComplaints rejects mismatched userId/amount |
| 12.3 | ✅ | resolveHistoricalComplaints handles empty inputs |
| 12.4 | ✅ | resolveHistoricalComplaints skips pending rows with no platformUserId |
| 12.5 | ✅ | applyHistoricalPlatformOnlyMatches: returns 0 when no SC TX IDs |
| 12.6 | ✅ | applyHistoricalPlatformOnlyMatches: links old PENDING_P → MATCHED on amount match |
| 12.7 | ✅ | applyHistoricalPlatformOnlyMatches: amount mismatch → DISCREPANCY with diff |
| 12.8 | ✅ | applyHistoricalPlatformOnlyMatches: no match when shamCashTxId differs |
| 12.9 | ✅ | applyHistoricalPlatformOnlyMatches: skips platform rows with null shamCashTxId |
| 12.10 | ⏳ | applyHistoricalScIdMatches: old PENDING_SC + new platform shamCashTxId → MATCHED (integration) |

## 13. Currency helper (`tests/currency.test.ts`)

| # | Status | Test |
|---|---|---|
| 13.1 | ✅ | fmtSYP(1000) = '1,000 ل.س' |
| 13.2 | ✅ | fmtSYP(0) = '0 ل.س' |
| 13.3 | ✅ | fmtSYP(null/undefined) = '0 ل.س' |
| 13.4 | ✅ | fmtSYP(1234567) = '1,234,567 ل.س' |
| 13.5 | ✅ | fmtSYP(123.45) → '123 ل.س' (no decimals) |
| 13.6 | ✅ | fmtSYP(n, { withSymbol: false }) returns just the number |
| 13.7 | ✅ | handles negative numbers |

## 14. Date helpers (`tests/datetime.test.ts`)

| # | Status | Test |
|---|---|---|
| 14.1 | ✅ | startOfWeek(Sunday) returns same date at 00:00:00 |
| 14.2 | ✅ | startOfWeek(any weekday) returns prior Sunday |
| 14.3 | ✅ | startOfWeek accepts ISO string input |
| 14.4 | ✅ | endOfWeek returns Saturday 23:59:59.999 |
| 14.5 | ✅ | endOfWeek - startOfWeek = 7 days minus 1 ms |
| 14.6 | ✅ | fmtSyriaDate returns YYYY-MM-DD format |
| 14.7 | ✅ | fmtSyriaDate handles ISO string |
| 14.8 | ✅ | fmtSyria includes seconds by default |
| 14.9 | ✅ | fmtSyria omits seconds with withSeconds=false |
| 14.10 | ✅ | invalid date returns "—" |
| 14.11 | ✅ | UTC midnight renders as Damascus 03:00 |

## 15. Rate limiting (`tests/rateLimit.test.ts`)

| # | Status | Test |
|---|---|---|
| 15.1 | ✅ | First N requests within window: ok=true |
| 15.2 | ✅ | (N+1)th request within window: ok=false, resetInMs > 0 |
| 15.3 | ✅ | Different keys have independent buckets |
| 15.4 | ✅ | Reports remaining count correctly |
| 15.5 | ✅ | After windowMs elapses: bucket resets |
| 15.6 | ⏳ | Sweep removes expired buckets after 60s |

## 16a. Schedule Generator (`tests/schedule.generator.test.ts`)

Pure-logic tests for the weekly schedule generator that replaces naïve round-robin with shift-continuity + weekly off-days + deterministic rotation.

| # | Status | Test | Why it matters |
|---|---|---|---|
| 16a.1 | ✅ | Each employee stays on the same shift number every day of the week | Continuity — no jumping between morning/evening/night |
| 16a.2 | ✅ | Round-robin pins employees[0,1,2,3] to ONE/TWO/THREE/ONE | Deterministic shift assignment |
| 16a.3 | ✅ | weeklyOffDays:2 marks exactly 2 days off per employee | Off-days respected when coverage allows |
| 16a.4 | ✅ | weeklyOffDays:0 leaves nobody off | Edge case |
| 16a.5 | ✅ | Off-day windows rotate so a shift is never fully empty | Cross-team rotation correctness |
| 16a.6 | ✅ | `minPerShift` floor overrides weeklyOffDays when needed | Coverage SLA |
| 16a.7 | ✅ | minPerShift:0 honors weeklyOffDays exactly | Negative case of the floor |
| 16a.8 | ✅ | Same input twice produces byte-identical output | Determinism |
| 16a.9 | ✅ | Caller order doesn't matter — internal sort by id | Stability |
| 16a.10 | ✅ | Output is 7 × 3 × roster-size rows with correct YYYY-MM-DD dates | Output shape |

## 16b. Reconciliation Unlink (`tests/reconciliation.unlink.test.ts`)

| # | Status | Test |
|---|---|---|
| 16b.1 | ✅ | 401 when unauthenticated |
| 16b.2 | ✅ | 403 when caller is not ADMIN or SUPERVISOR |
| 16b.3 | ✅ | 404 when transaction missing |
| 16b.4 | ✅ | 400 when transaction is in PENDING_* (nothing to unlink) |
| 16b.5 | ✅ | 400 guard when MATCHED but matchedTxId is null (data corruption) |
| 16b.6 | ✅ | Happy path returns both rows to PENDING_* + audits MANUAL_UNLINK |
| 16b.7 | ✅ | Works on DISCREPANCY too (clears amountDiff) |
| 16b.8 | ✅ | Defensive: proceeds even if partner row was already deleted |

## 16c. Shift-Counterpart Lookup (`tests/shifts.counterpart.test.ts`)

The check-in form auto-suggests the previous-shift employee based on which wallets the incoming user selects. This locks in that suggestion logic.

| # | Status | Test |
|---|---|---|
| 16c.1 | ✅ | 400 when walletIds query param is missing |
| 16c.2 | ✅ | Returns single counterpart when one session holds the requested wallets |
| 16c.3 | ✅ | counterpart:null when no open session holds the wallets |
| 16c.4 | ✅ | ambiguous:true + candidates list when multiple users hold them |
| 16c.5 | ✅ | Excludes sessions that hold only a subset of requested wallets |
| 16c.6 | ✅ | DB filter restricts to ACTIVE/PENDING_END statuses only |
| 16c.7 | ✅ | 401 when unauthenticated |

## 16d. Auto-Approve Handover — Integration (`tests/shifts.autoApprove.integration.test.ts`)

Exercises the *real* `tryAutoApproveHandover()` from `src/lib/shifts/autoApprove.ts` with a mocked Prisma client. Complements the pure-logic gate test in `shifts.autoApprove.test.ts`.

| # | Status | Test | Why it matters |
|---|---|---|---|
| 16d.1 | ✅ | Approves when triggered by incoming + both sides ready | Happy path, incoming trigger |
| 16d.2 | ✅ | Returns "في انتظار تسجيل خروج…" when outgoing PENDING_END not yet posted | Waiting-state UX |
| 16d.3 | ✅ | Rejects when wallet sets differ | Wallet equality guard |
| 16d.4 | ✅ | Approves when triggered by outgoing after incoming already checked in | Mutual-handover (NEW) |
| 16d.5 | ✅ | Returns "في انتظار تسجيل دخول…" when no incoming PENDING_START exists | Waiting-state UX (NEW) |
| 16d.6 | ✅ | Rejects when the outgoing session is no longer PENDING_END | Status guard |
| 16d.7 | ✅ | Returns "تعارض متزامن" when updateMany.count === 0 | Race safety |

## 17. End-to-end batch processing

`tests/e2e.batch.test.ts` (⏳ planned, needs test DB)

| # | Status | Test |
|---|---|---|
| 16.1 | ⏳ | Full upload: parses files, persists records, links pairs |
| 16.2 | ⏳ | Re-upload same files: dedupe keeps state correct |
| 16.3 | ⏳ | Re-upload after fixing internal-transfer false positive: rows now MATCHED |
| 16.4 | ⏳ | Concurrent uploads on same account: advisory lock serializes |
| 16.5 | ⏳ | Upload failure: rollback removes all records + batch row |

---

## Test infrastructure

- **Runner:** vitest 4.x (`vitest.config.ts`)
- **Path alias:** `@/` → `src/`
- **Live-file tests:** skipped via `describe.skipIf(!fs.existsSync(...))` so CI without local files passes
- **Test command:** `npx vitest run` (or `npx vitest` for watch mode)

## Adding a new test

1. Find the right file by module; if none, create `tests/<module>.test.ts`
2. Add to this SPEC.md under the appropriate section
3. Run `npx vitest run` — must be green before deploying
4. The pre-deploy ritual is: `npx tsc --noEmit && npx vitest run` then `npx vercel --prod`

## Coverage gaps to prioritise

1. **Permissions tests** (Section 6) — protect against role escalation regressions
2. **Dedupe tests** (Section 11) — the part that broke twice in this session
3. **Live parser unit tests** (Section 4) — protect against XML format quirks
4. **Payroll tests** (Section 7) — money math should never silently change
