# Spike: could the add-on let the workbench save to Zotero without a key?

Written 2026-10-21 for Phase 3 of the [zero-terminal onboarding plan](zero-terminal-onboarding-plan.md).
This is a desk finding: nothing here was prototyped, and the Zotero 10 route below could not be
run against a real Zotero 10 (the machine used had Zotero 9.0.6).

## Short answer

Zotero 10 already does what the spike was meant to build. The add-on endpoint is only worth
building for Zotero 7 to 9, and the cost is higher than the benefit. Recommendation: do not build it.

## What changed

Zotero 10.0 (2026-08-17) added write support to the local API on port 23119
([local API page](https://www.zotero.org/support/dev/web_api/v3/local_api); the Zotero team
confirmed it in the [forum thread](https://forums.zotero.org/discussion/132977/)). A program asks
once with `POST /api/local/authorize`; Zotero shows a dialog (Allow, Always Allow, Deny) and
answers with a write key. Writes then use the ordinary Web API shapes. That is the "one-time token
protected local write path" the spike asked about, shipped by Zotero itself, with the permission
dialog inside Zotero rather than in our code.

The workbench now uses it (`runtime/src/api/local-writer.ts`): with no Zotero key and Zotero 10
or later open, saving goes there, and Zotero asks the user once. A Zotero key, when present,
still wins. Zotero 9.0.6 was checked directly: it answers writes with 400 "Endpoint does not
support method" and `/api/local/authorize` with 404, and sends no `Zotero-Server-ID` header, so
the workbench tells Zotero 7 to 9 users to add a key.

## What an add-on endpoint would still give

Only Zotero 7 to 9 users, who would save without a key. How it would work: an add-on can add
its own paths to Zotero's built-in server on the same port (Better BibTeX does this at
`/better-bibtex`, see `runtime/docs/grounding.md`), so no new port is needed. It would need:

- a confirmation step in Zotero (a dialog the add-on shows) to hand out a one-time token, since
  the token must not travel through chat;
- write handlers in Zotero's privileged JavaScript for items, collections, tags and notes,
  reimplementing what the Web API write format does;
- retesting on every Zotero release in the supported range (7.0 to 10.9), plus the security
  review of an endpoint that can change a library, reachable by every program on the computer.

## Why not

- Zotero 10 is the current stable release (10.0.6, 2026-10-07), and Zotero updates itself, so
  the group that would benefit shrinks without any work from us.
- The add-on would be a second, home-made version of a feature Zotero maintains. Its bugs would be
  ours, and a flaw in it would be a way to write to a user's library.
- A Zotero key costs a beginner about two minutes, once, on the setup page.

## What to do instead

- Measure first: `setup_status` diagnostics already tell whether the desktop connection is up
  and whether it is Zotero 10 or later. If many users turn out to be on 7 to 9 and stuck on the
  key, revisit.
- Keep the key path complete for them: the setup page links to the key page and says to tick
  "Allow write access". Whether `settings/keys/new` accepts prefilled permissions is **not
  verified**: the documented parameters (`name`, `library_access`, `notes_access`, `write_access`,
  `all_groups`) are described only for the OAuth exchange, and the page redirects to the login
  when signed out, so it could not be tested without signing in.

## Not verified

- Saving against a real Zotero 10 (the tests use a stand-in server written from the documentation).
- That "Always Allow" keeps the key valid across restarts of the workbench. The write key is
  held in memory only, so after a restart Zotero is asked again; whether it then skips the dialog
  for an app it already trusts is unknown.
