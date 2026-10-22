# Getting started

[中文](getting-started_CN.md)

This page takes you from nothing to a first search, in the order you will meet each step.
You type no commands: you approve prompts, click a download, and paste keys into a form.

**What you should have at the end:** a ranked reading list from a real search, and, if you want
them, the journal columns (IF / JCR / CAS) in Zotero.

## Before you start

- You need an agent app, and Zotero Desktop if you want papers organized there.
- Your app may ask permission to reach GitHub or the network. Choose **Allow**. The install stops
  without it.
- Keys are optional. You can search, rank and draft without any.

## Step 1: Install

| Your app | What to do |
| --- | --- |
| **Claude Desktop** | Open the [latest release](https://github.com/Frankkk1912/ai4s-literature-workbench/releases/latest), download `ai4s-literature-zotero-<version>.mcpb`, and double-click it (or drag it onto the Claude Desktop window). Accept the install screen and leave both optional settings alone. This installs the Zotero tools only, not the skills or the full-text tools. |
| **DeepSeek Harness** (not yet tested on a real machine) | Open the [latest release](https://github.com/Frankkk1912/ai4s-literature-workbench/releases/latest) and download `dsh-ai4s-literature-workbench-<version>.tgz`. In DeepSeek Harness open the **Plugins** page, choose **Add plugin**, and paste the path of the downloaded file. Quit and reopen DeepSeek Harness, then ask: "run the ai4s-setup skill". This installs the Zotero tools, the full-text tools and all the skills. |
| **Claude Code, Codex, WorkBuddy, CodeBuddy** | Paste the install prompt from the [README](../README.md#1-install-pick-your-app) into the app. The agent follows [INSTALL.md](../INSTALL.md) and tells you what works and what needs you. |
| **Trae, Qoder** | Follow "Other agents & manual install" in the [README](../README.md). |

WorkBuddy, CodeBuddy and DeepSeek Harness have not been tested on a real machine yet; if they fail,
the agent says which step failed. For DeepSeek Harness that also covers the Plugins page, Windows, and
how the DeepSeek models use the skills.

## Step 2: See what works

Ask the agent to run the `ai4s-setup` skill, or just start. It calls a status check and shows three
groups: **Works now**, **Needs you**, **Optional**. If it says "My search tools are not connected
yet", restart the app and ask again.

## Step 3: Add what you want (all optional)

When you want a key, the agent opens a page on your own computer. The page is already signed in,
explains why the key is useful, links to where you get it, and has a masked field. Paste the key
there. The agent cannot see it, and it is never printed in chat.

| You want | You need | Where |
| --- | --- | --- |
| Search, rank, draft | Nothing | |
| Read your Zotero library | Zotero open, with **Allow other applications on this computer to communicate with Zotero** ticked | Zotero → Settings → Advanced |
| Save papers into Zotero | A Zotero key, or Zotero 10 or later (it asks once in its own window; choose **Always Allow**) | The setup page |
| Faster PubMed search | A free PubMed key | The setup page |
| More journal ratings in reports | An EasyScholar key | The setup page |
| IF / JCR / CAS columns in Zotero | The Zotero add-on | Below |

A Zotero key takes effect after you restart the app; the agent tells you when.

If the page does not open, the agent gives you an address and a short code: open the address and
type the code. If that fails too, double-click `Setup AI4S.bat` (Windows) or `Setup AI4S.command`
(Mac) in the extracted release folder. On a Mac, if it is blocked, right-click it, choose **Open**,
then **Open** again.

### The Zotero add-on (journal columns)

1. [Download the add-on](https://github.com/Frankkk1912/ai4s-literature-workbench/releases/latest/download/literature-metrics.xpi).
   If nothing downloads, open the [releases page](https://github.com/Frankkk1912/ai4s-literature-workbench/releases)
   and pick the `.xpi` file.
2. In Zotero choose **Tools → Add-ons**.
3. Click the gear → **Install Add-on From File…** and pick the file.
4. Restart Zotero.

The setup status says whether the add-on was found in your Zotero profile. It cannot prove that
Zotero loaded it. The columns show data the tools write to your items, so after installing, ask
the agent to sync or refresh a collection.

## Step 4: Your first prompt

```text
Retrieve and rank PubMed evidence on GLP-1 receptor agonists and cardiovascular outcomes. Save the evidence and report for later writing.
```

You get a deduplicated reading list, ranking reasons and a saved report you can open.

## If something goes wrong

| What you see | What to do |
| --- | --- |
| The agent says "My search tools are not connected yet" | Restart the app, then ask: "run the ai4s-setup skill". |
| The setup page did not open | Use the address and code the agent gives you, or double-click the `Setup AI4S` file (see Step 3). |
| The agent cannot read my Zotero library | Open Zotero and tick **Allow other applications on this computer to communicate with Zotero** in Settings → Advanced. |
| It cannot save to Zotero | Add a Zotero key on the setup page, or use Zotero 10 or later and choose Always Allow when Zotero asks. |
| No journal columns in Zotero | Install the add-on (Step 3), restart Zotero, then ask the agent to sync or refresh a collection. |
| The add-on installed long ago never updates | Copies older than 0.1.14 cannot update themselves. Install the newest file once by hand. |
| DeepSeek Harness shows no tools after you add the package | Quit and reopen it (the package loads at start-up), check that the package is listed on the Plugins page, then ask: "run the ai4s-setup skill". |
| The app asks to reach GitHub or the network | Choose Allow. |
| A search says the helper is missing | The agent offers to install a small search helper (`uv`). Say yes. |

## Questions

**What is a key?** A long password-like string that lets this tool use a service as you. It goes
into the setup page on your computer, is stored in a private file there, and is never shown in chat.

**Which keys are free?** A PubMed key is free with an NCBI account, and a Zotero key is free with a
Zotero account. EasyScholar issues its own; check their terms.

**Why does search work without any?** Searching uses public sources. Keys raise PubMed's request
allowance, let the tools save to Zotero, and add more journal ratings.
