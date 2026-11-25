# Configuration management

Owner and change authority: Duc Anh Duong (solo project).
Effective date: 2026-11-24. Repository: https://github.com/jeremi1995/echoesOfTheRealm

## Controlled configuration

Git controls the TypeScript source in server/, shared/, and web/; public/art/ assets;
test/; guardrail.md; package.json and package-lock.json; tsconfig.json; index.html;
.env.example; .gitignore; workflow files; and project documentation.
Keep dependency changes in both package files and install with npm ci on Node.js 24.
Never commit .env, .data/, node_modules/, or dist/. AI credentials belong in the
local ignored .env. SQLite saves are runtime data, not a release baseline.

## Formal change control

1. **Request**: create docs/changes/CM-NNN.md before implementation. Record the
   requester, date, problem, affected files, risks, acceptance criteria, and rollback.
2. **Assess and authorize**: Duc Anh Duong accepts, defers, or rejects the request
   and records the decision. For a solo project this is a documented self-review,
   not an independent review. Assignment or chat instructions can authorize scope;
   cite them in the request. Separate later scope additions into another request.
3. **Branch**: start feature/<topic>, fix/<topic>, or chore/<topic> from an up-to-date
   master. All new development and release preparation happen on that branch.
4. **Implement and verify**: link commits to the request. Run npm ci, npm test,
   npm run typecheck, and npm run build. Record date, environment, results, and
   test coverage limits. Add a manual or live-model check when the change needs it.
5. **Review and integrate**: inspect the complete diff, confirm acceptance criteria
   and absence of secrets, and record the gate result in the request. Merge the
   tested branch with git merge --no-ff. Re-test if conflict resolution changes code.
6. **Release**: keep the package version consistent with an annotated vMAJOR.MINOR.PATCH
   tag on the tested master commit. Increment MAJOR for incompatible releases,
   MINOR for compatible features, PATCH for compatible fixes. Never move a published tag.
   Push the branch, master, and the specific tag. CI checks branches and master;
   do not claim a remote check passed until its actual result is available.
7. **Close**: record the branch, test evidence, commit/merge/tag identifiers, and
   disposition. Produce the source ZIP with git archive from the tag so the
   submission and baseline contain the same tracked source.

For defects, open a new fix branch and change request. Use git revert through a
tested branch to undo an integrated change; do not rewrite shared master history.
For an immediate local recovery, check out the previous release tag in a separate
folder, run npm ci and npm run build, and preserve the current SQLite save first.
Code rollback does not automatically restore or migrate a save.

## Release gate

- Request authorized; scope and review outcome recorded.
- Working tree clean after committing intended files only.
- Automated tests, type checking, and build pass on the development branch.
- Annotated tag identifies the released master commit; source ZIP uses that tag.
- GitHub source and tag accessible to the instructor; public access is sufficient
  while this repository remains public. If made private, invite the instructor's
  GitHub account and confirm access before submission.

The first four historical commits predate this procedure. Their linear history
does not provide evidence of tested development branches or release tagging.
This procedure is adopted prospectively; earlier history is retained unchanged.
