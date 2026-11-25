# Ash Group v2 Mac handoff

This branch contains the complete current application source from the Windows workspace, including changes and new files that were not committed to its local `main`. Use this snapshot to set up development on the Mac; do not replace it with the older GitHub `main`.

## Snapshot and Git history

The handoff was prepared on 2026-11-25. Its source workspace was `C:\Users\Badee Salloum\Desktop\New folder (4)\Ash group v2`, with local HEAD `5bb6e1e288eb7f58b0d0c236c776f9255bc4008b` before the handoff.

This is an independent snapshot branch, not a production release. It deliberately does not inherit the Windows Git history because that history includes a tracked environment file. The original local files, index, branch and history remain intact. Do not merge this unrelated history into `main` as part of setup.

Real environment files, Vercel local configuration, build caches, local agent runtime state and empty root-level scratch files are excluded. Source code, tests, migration files, lockfile, application assets and project requirements are included. Excluded files were not deleted from Windows.

The optional `.claude/agents/payments/agentic-payments.md` template is also excluded because a secret scanner flagged a key-like literal in its example. It is not an application dependency.

## Scope of work

The latest completed business request was limited to:

- Fixing automatic reconciliation only, with unambiguous candidate selection and atomic reciprocal links. Check live account, source, transaction type, currency, amounts and availability before committing links. Unequal amounts must not become an exact match.
- Tracking upload stages and actual completion time, retaining failed attempts and warning about partially committed uploads before retrying.
- Distinguishing human initiators, service callers and automatic system actions in audit records.

Manual matching rules were not changed by that request, and no historical financial repair was run for it. If an upload fails after some stages have committed, those results remain available with a failed-batch warning; the upload is not automatically replayed or claimed to have been fully undone.

Earlier work included server-side pagination and sorting, smaller transaction-list payloads, read models, duplicate handling and parser compatibility. Preserve the current code rather than restarting the original broad performance plan. In particular, do not re-enable time-and-amount withdrawal matching.

The Mac setup does not authorize new feature work, employee attribution repairs, follow-up changes, shift changes, financial reclassification or retrospective data updates. Finish setup, report verification results and ask for the next task.

## Runtime and installation

The project uses Node.js 22 in Docker, Next.js 14.2.13, React 18, TypeScript, Prisma 5.22.0, PostgreSQL and Vitest. Retain `package-lock.json` and current dependency versions during the move.

After installing Node.js 22, run from the repository root:

```sh
npm ci --legacy-peer-deps
cp .env.example .env.local
npx prisma generate
npm run preflight
npm run build
```

Set a fresh local `JWT_SECRET` of at least 32 characters before building or running. Configure both `DATABASE_URL` and `DIRECT_DATABASE_URL` for an isolated development database. Never paste production secrets into source, chat, logs or a commit. Do not copy a Windows `node_modules`, `.next` or generated Prisma engine to the Mac.

For development, use `npm run dev` and open `http://localhost:3000`. Database-backed pages need a properly initialized development database; build and mocked tests are not proof of database setup. Inspect the schema and migration history before applying anything. Only initialize a verified isolated local database, and do not seed an existing or production database.

Check case-sensitive imports, Windows-only paths and executable permissions on shell scripts. The optional `.mcp.json` and `.claude` configuration contains Windows commands; inspect it before enabling it and do not run optional agent hooks to start the application.

Some README setup and business-rule descriptions predate the latest fixes. Check `package.json`, the implementation and tests when they disagree; README examples are not authorization to modify production.

## Important code locations

- `src/lib/reconciliation/autoLink.ts`: locked live validation, reciprocal writes and automatic-match audit journal.
- `src/lib/reconciliation/batchProcessor*.ts`: parsing, candidate selection, persistence, historical pending counterparts and upload stages.
- `src/lib/reconciliation/currencyGuard.ts`: currency checks and ambiguity-safe candidate maps.
- `src/lib/audit/context.ts` and `src/lib/auth`: caller provenance and audit metadata.
- `src/lib/uploads/attempts.ts`, `src/app/api/upload` and `src/components/forms/UploadAttempts.tsx`: durable attempts and progress UI.
- `src/lib/parsers`: financial file readers and validation.
- `src/lib/performance`, `src/lib/transactions` and `src/components/tables`: read models and server-controlled tables.
- `tests`: reconciliation, parser, authorization, upload, sorting and other regression tests.

## Production boundaries

The application is hosted at `https://ash-group-v2.vercel.app`. Neon remains hosted remotely; moving the code does not require exporting or moving production financial data.

Do not run production migrations, `db push`, `db push --accept-data-loss`, seed, backfill, repair or database-reset scripts during setup. Do not rotate production credentials, change deployment environment variables, connect a different database or deploy without a new instruction.

If later explicitly asked to deploy, use the existing Vercel project `financial-platform-v2`, project ID `prj_Km6eaYhVKHet8IYW2GgYsYNsMGlH`, team ID `team_NgkZjuuvgbRZYHPEa0ZYSLSl`. Runtime functions are configured in `fra1`. The build command is `prisma generate && next build`; migrations are a separate authorized release step.

The last deployment recorded in the previous work session was `dpl_6gaVAW6nixLez93GJLuDC1mFNbDw` on 2026-10-15, linked to the application hostname. Verify current deployment metadata before any later release; this identifier is historical context, not a claim about the current live version.

Credentials previously shared in chat must not be reused blindly or included in this public branch. Ask the owner for secure access when necessary. Credential rotation is a separate coordinated production action.

## Verification and completion

The last recorded verification before this transfer was 567 passing tests in 68 files, a passing TypeScript check and a successful Vercel build. Re-run checks on the Mac and report the actual results rather than treating that historical result as a new test run.

Complete setup by reporting the checked-out branch and commit, Node version, dependency installation, Prisma generation, TypeScript/tests/build results, local startup status and any missing development-database setup. Preserve user changes and stop before production mutations or unrelated feature work.
