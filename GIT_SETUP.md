# One-time: push this project to your friend's repo as a branch, then disconnect

You're a **collaborator** on your friend's GitHub repo, and we're sharing the
**tool only** — your personal data is excluded by `.gitignore` (verified). Run
these in **Terminal on your Mac**, top to bottom.

```bash
cd "/Volumes/BountyDrive/Financial_Advisor"
```

## 0. One-time setup (skip anything you've already done)

```bash
# Is git installed? If this errors, run:  xcode-select --install
git --version

# Tell git who you are (use the email on your GitHub account)
git config --global user.name  "Your Name"
git config --global user.email "you@example.com"
```

## 1. Make this folder a git repo

```bash
git init
git add -A
```

## 2. ⚠️ VERIFY your data is excluded BEFORE committing

```bash
git status --short        # review the list
git ls-files              # exactly what will be shared
```

The list must **NOT** contain: `portfolio.json`, `goals.md`, `backups/`,
`data/*.json`, anything in `initial_stage/*.xlsx`, or `legacy/`. It SHOULD contain
the code (`dashboard.html`, `server.py`, `news_engine.py`, …), `GLOBALS.md`,
`goals.example.md`, and `instruments.json`. Quick spot-check:

```bash
git check-ignore portfolio.json goals.md data/insights.json backups/index.json
# ^ should echo each name back (meaning: ignored = safe)
```

If anything personal shows up as tracked, stop and tell me — don't push yet.

## 3. Commit

```bash
git commit -m "Portfolio dashboard tool (shared, no personal data)"
```

## 4. Connect your friend's repo and push to a NEW branch

Replace the URL with his repo, and pick a branch name.

```bash
git remote add friend https://github.com/FRIEND_USERNAME/HIS_REPO.git
git push friend HEAD:portfolio-dashboard
```

- `HEAD:portfolio-dashboard` pushes your commit to a brand-new branch called
  `portfolio-dashboard` on his repo, without changing his `main`.
- **Auth:** if it asks for a password, paste a **GitHub Personal Access Token**, not
  your account password. Create one at GitHub → Settings → Developer settings →
  Personal access tokens → **Fine-grained tokens**, scoped to his repo with
  **Contents: Read and write**. (Or use SSH and the `git@github.com:...` URL.)

## 5. Disconnect (what you asked for)

```bash
git remote remove friend     # unlink his repo
```

That's the disconnect — your folder no longer points anywhere. To go further and
remove git from this project entirely (back to a plain folder):

```bash
rm -rf .git                  # optional: fully untrack this folder
```

Your friend now has a `portfolio-dashboard` branch in his repo. He checks it out
with `git checkout portfolio-dashboard`.

---

## If `git push` is rejected (403 / permission denied)

Then you're not actually a collaborator yet. Either:
- ask your friend to add you (his repo → Settings → Collaborators), then re-run
  step 4; **or**
- fork his repo on GitHub, `git remote add friend <your-fork-url>`, push the
  branch to your fork, and open a Pull Request he can pull as a branch.

## Notes

- `instruments.json` is shared — it lists the **ISINs/names** of instruments you've
  mapped (public identifiers, no amounts). If you'd rather not reveal which
  instruments you hold, replace its `"byIsin"` with `{}` before step 1.
- `Indian Market Investment Plan.md` (your research) is also shared. Add it to
  `.gitignore` first if you'd prefer to keep it private.
- Re-running later: this is meant as a one-shot. If you want to push again after
  `rm -rf .git`, just repeat from step 1.
```
