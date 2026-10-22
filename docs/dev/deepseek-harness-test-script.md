# DeepSeek Harness: manual test script

For the owner's hand test on real machines. Everything below is **untested** until you run it; the
automatic checks only prove that the package is well formed and installs under `dsh web` 0.2.1-rc.2
(see [deepseek-harness-support-plan.md](deepseek-harness-support-plan.md)). Never paste a real key into
a chat with the model or into a report; test the key page with a throwaway value or skip it.

## Get the file

No published release lists the package yet (v0.1.0 predates it). Either:

- **Actions → Release assets → Run workflow**, branch `feat/dsh-support`, then download the
  `release-assets` artifact and take `dsh-ai4s-literature-workbench.tgz` out of it; or
- after the next release is published, use the file from the release page.

## Set-up for each run

Use a machine, or at least a user account, with nothing of ours installed and no existing
`~/.agents/skills` or Zotero key file, or the result is contaminated (the skill list and the tool
processes both read the real home folder). Note: OS and version, DeepSeek Harness version, and
where you got the installer (the plan could not find a public installer).

## Steps

| # | Do | You should see | Report |
| --- | --- | --- | --- |
| 1 | Open the **Plugins** page, choose **Add plugin**, paste the path of the `.tgz` | The package listed as installed, no terminal needed | Did the page accept a local path? Any error text. Did you need to type anything outside the app? |
| 2 | Quit and reopen DeepSeek Harness | `ai4s-literature-zotero` and `ai4s-literature-fulltext` among the connected tools (19 and 6 tools) | Do both show as running? If not, the exact error. Which Node version does Desktop run? (optional: run Desktop's own executable with `ELECTRON_RUN_AS_NODE=1` and `-e "console.log(process.version)"`; the bundles need 22.13 or newer) |
| 3 | Start a new session and type `/` | Four skills: `ai4s-setup`, `literature-manager`, `literature-research`, `literature-writing` | Which of the four appear, with full descriptions? |
| 4 | Ask: "run the ai4s-setup skill" | A "Works now / Needs you / Optional" summary in plain words | Did the model call the status tool by itself? Did it invent any step not in `INSTALL.md`? |
| 5 | Ask for the Zotero key page (or any key) | A browser page opens on your computer, already signed in | Did the browser open from inside DeepSeek Harness? If not, did the model give an address and a short code, and did typing it work? Is there any masked field for plugin settings in the app? |
| 6 | Say: "Retrieve and rank PubMed evidence on GLP-1 receptor agonists and cardiovascular outcomes. Save the evidence and report for later writing." | A ranked reading list and a saved report | Minutes to the first result, commands you typed, number of agent turns. Does it work with no key? |
| 7 | Without naming a skill, ask: "Put my finalized report and the selected papers into a Zotero collection called Test Project." | The model picks `literature-manager` | Did it pick the skill, or did you have to name it? (`literature-manager`'s description is 787 characters and may be cut in the model's list.) |
| 8 | After the next release is published: **Add plugin** with the address `https://github.com/Frankkk1912/ai4s-literature-workbench/releases/latest/download/dsh-ai4s-literature-workbench.tgz` | Same as step 1 | Does the page take an address? |
| 9 | Repeat 1 to 6 on Windows 11 | Same | Anything that differs, especially a Windows path with spaces |

## What to send back

One short note per run: OS and DeepSeek Harness versions; for each step "worked", "worked with a
workaround" (say which) or "failed" (the exact error text, a screenshot of the Plugins page); the three
numbers from step 6. Do not include keys, the contents of any key file, or full home-folder paths.
