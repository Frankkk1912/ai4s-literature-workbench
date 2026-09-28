# Migration from the parent repository

Status: M1 archive (T1.2–T1.6). This file is the one-time source-to-destination hash record. It is not a daily gate.

This repository is the source of truth. `node scripts/assemble-plugin.mjs check` does not read a parent checkout, does not store fixed source hashes, and does not fail when source text evolves.

## Method

Copied files are git-tracked files only. Untracked `node_modules/`, `dist/`, `data/`, caches, and credential files were not copied.

Baseline tree hash matches `scripts/assemble-plugin.mjs` as it existed in the parent plugin before T1.5:

- walk each directory with sorted entry names
- skip a top-level `dist` directory
- skip names excluded by `excluded()`: `.git`, `node_modules`, `dist`, `data`, `coverage`, `.pytest_cache`, `__pycache__`, `.DS_Store`, `original-draft.md`, `*.pyc`, and `.env*` except `.env.example`
- for the Zotero runtime and fulltext runtime only, also keep the historical top-level allowlist: `.env.example`, `LICENSE`, `THIRD_PARTY_NOTICES.md`, `licenses`, `package-lock.json`, `package.json`, `scripts`, `src`, `tsconfig.json`
- hash is SHA-256 over `relative-path\0file-bytes\0` for each included file

The same filter is applied to the parent source tree and the new destination tree. Per-file SHA-256 is the raw file bytes.

At copy time, 381 tracked files were byte-identical (0 mismatches). A rescan after T1.5/T1.6 found only the intentional diffs listed below. A later D11 pre-push scan fix is recorded with those diffs and does not rewrite the migration-time runtime tree baseline.

## Bundle baseline

The first five hashes also equal the historical parent `bundle-manifest.json` values generated on 2026-08-03. That confirms the filter implementation, not a daily pin.

| Parent path | New path | Filter | Parent files | New files | Parent tree SHA-256 | New tree SHA-256 | Match |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `literature-research` | `skills/literature-research` | excluded() only | 21 | 21 | `308939ea5aadb95f37fd115334613582fc8ad7ac9eabbf0358506594730cada7` | `308939ea5aadb95f37fd115334613582fc8ad7ac9eabbf0358506594730cada7` | yes |
| `literature-manager` | `skills/literature-manager` | excluded() only | 15 | 15 | `269623c776035edd65395a752278c9f6e463572a6c2173a73a8a66948802374d` | `269623c776035edd65395a752278c9f6e463572a6c2173a73a8a66948802374d` | yes |
| `literature-writing` | `skills/literature-writing` | excluded() only | 4 | 4 | `cd667c275c57bb2fdbd42a4c4afd4e7e1fe12c372248838e7f21dd7772b01a51` | `cd667c275c57bb2fdbd42a4c4afd4e7e1fe12c372248838e7f21dd7772b01a51` | yes |
| `literature-zotero-mcp` | `runtime` | excluded() + runtime top-level allowlist | 122 | 122 | `4e01b0e628c65e8a8219fcfdf95fbf4932c0374e77b59ba2a7f2d1505c2c4726` | `4e01b0e628c65e8a8219fcfdf95fbf4932c0374e77b59ba2a7f2d1505c2c4726` | yes |
| `literature-fulltext-mcp` | `fulltext-runtime` | excluded() + runtime top-level allowlist | 15 | 15 | `437c61531b44dbc6d6313c01d9375a255059498481304988f0c146810acd870d` | `437c61531b44dbc6d6313c01d9375a255059498481304988f0c146810acd870d` | yes |
| `literature-metrics` | `literature-metrics` | excluded() only | 24 | 24 | `ef567ba76fd4526d33f31d50c6505ab9b7c66513786eab37235bc97222e26853` | `ef567ba76fd4526d33f31d50c6505ab9b7c66513786eab37235bc97222e26853` | yes |
| `plugins/ai4s-literature-workbench/database-browser-runtime` | `database-browser-runtime` | excluded() only | 18 | 18 | `2ab62043e1efa75a454b3c4b0fd96c9404450b7ee82e87d59172be71c19abe5d` | `2ab62043e1efa75a454b3c4b0fd96c9404450b7ee82e87d59172be71c19abe5d` | yes |

Files inside this filter are byte-identical. There is no in-filter mismatch.

## Additional files outside the baseline filter

These tracked files were copied, but the historical bundle filter does not include them. They are listed so the filter alignment is explicit. `runtime/tests/`, `runtime/vitest.config.ts`, Docker/deploy metadata, and `fulltext-runtime/tests/` are in this set.

| Parent path | New path | Parent SHA-256 | New SHA-256 | Match | Note |
| --- | --- | --- | --- | --- | --- |
| `literature-fulltext-mcp/README.md` | `fulltext-runtime/README.md` | `0292cc0108d21f651bb5bfd4f89f10e41510cb7032bcf83750e24db8c57715ba` | `0292cc0108d21f651bb5bfd4f89f10e41510cb7032bcf83750e24db8c57715ba` | yes | Copied tracked file outside the baseline filter |
| `literature-fulltext-mcp/tests/broker.test.ts` | `fulltext-runtime/tests/broker.test.ts` | `65c7be0982a84b63bf0f266185eb8cef2479143fdf0d19804bab83d93f014c56` | `cdb2000087227e32a21dd56adfa2c8daf131a547f3527c98f30d7797a1fce2b1` | no — intentional | D8 path correction: import the handoff contract from ../../runtime instead of ../../literature-zotero-mcp. No contract behavior change. |
| `literature-fulltext-mcp/tests/paths.test.ts` | `fulltext-runtime/tests/paths.test.ts` | `9eb5d36673648b4841ddacadacbfbc889fd3919ce3081d3449d719bbc16c7427` | `9eb5d36673648b4841ddacadacbfbc889fd3919ce3081d3449d719bbc16c7427` | yes | Copied tracked file outside the baseline filter |
| `literature-fulltext-mcp/tests/verification.test.ts` | `fulltext-runtime/tests/verification.test.ts` | `4f6fbe9661f3b7b4cf9370118dd1f3c73ab28178cbf9729147e4d92cebad0a27` | `4f6fbe9661f3b7b4cf9370118dd1f3c73ab28178cbf9729147e4d92cebad0a27` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/.dockerignore` | `runtime/.dockerignore` | `e22fffa01317a70923594e636594688b2681b5aa322cc3097c902a2df2e165cd` | `e22fffa01317a70923594e636594688b2681b5aa322cc3097c902a2df2e165cd` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/.editorconfig` | `runtime/.editorconfig` | `dda16a291e7ff89f03e6f67c90545b61f647887c72a6e3073e0d051fbcb4b47c` | `dda16a291e7ff89f03e6f67c90545b61f647887c72a6e3073e0d051fbcb4b47c` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/.eslintrc.json` | `runtime/.eslintrc.json` | `7ce94e117579734115f116ec1858563eccf16da5bb0777832d8c9d8917ab0061` | `7ce94e117579734115f116ec1858563eccf16da5bb0777832d8c9d8917ab0061` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/.github/workflows/ci.yml` | `runtime/.github/workflows/ci.yml` | `67c79e6dd5413c465748edb73f5ae87174c7d559232d98ad28db0167d8d4e0a5` | `67c79e6dd5413c465748edb73f5ae87174c7d559232d98ad28db0167d8d4e0a5` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/.gitignore` | `runtime/.gitignore` | `2b4fcd5fedb348765f8f693a11395bb8b0b5c0abb0c11c661d2a7b7050b94952` | `2b4fcd5fedb348765f8f693a11395bb8b0b5c0abb0c11c661d2a7b7050b94952` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/.prettierrc` | `runtime/.prettierrc` | `ecd05dc9cecd8ab83cc395aef7052ce780aba7f5ddb92a2bc079b8f705961fdc` | `ecd05dc9cecd8ab83cc395aef7052ce780aba7f5ddb92a2bc079b8f705961fdc` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/CHANGELOG.md` | `runtime/CHANGELOG.md` | `a4deb39cb493a3777168bc26114b22f7c9b028aa8c59a5e7ef78b09004e8405a` | `a4deb39cb493a3777168bc26114b22f7c9b028aa8c59a5e7ef78b09004e8405a` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/codex/README.md` | `runtime/codex/README.md` | `b9245081e817449581a59364980be0944f7603b706a4054a0733ed3ab20aa02d` | `b9245081e817449581a59364980be0944f7603b706a4054a0733ed3ab20aa02d` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/codex/runtime.ts` | `runtime/codex/runtime.ts` | `a4788d345ac8573315024848478c78272f42357f73296fe98d3a5553b6fa912d` | `a4788d345ac8573315024848478c78272f42357f73296fe98d3a5553b6fa912d` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/codex/zotero/applyImportPlan.ts` | `runtime/codex/zotero/applyImportPlan.ts` | `763fedd72d7ee570207709a3ea447833d33341700e2bcfce8c7e7ef067af455f` | `763fedd72d7ee570207709a3ea447833d33341700e2bcfce8c7e7ef067af455f` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/codex/zotero/attachment.ts` | `runtime/codex/zotero/attachment.ts` | `a3960f28da35e38d5cc03db73f63df91a8510acc2e645cfa44e575ff1bd2a8ff` | `a3960f28da35e38d5cc03db73f63df91a8510acc2e645cfa44e575ff1bd2a8ff` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/codex/zotero/bibliography.ts` | `runtime/codex/zotero/bibliography.ts` | `f994f0a8b3a676a702bdbe9399c412981ad8b19c5cc8afa86cf31f0213622ec6` | `f994f0a8b3a676a702bdbe9399c412981ad8b19c5cc8afa86cf31f0213622ec6` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/codex/zotero/createItems.ts` | `runtime/codex/zotero/createItems.ts` | `49bca1673d23fa41316964c63f7e9970716d440159f79e899ce7c13056241b87` | `49bca1673d23fa41316964c63f7e9970716d440159f79e899ce7c13056241b87` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/codex/zotero/deleteItems.ts` | `runtime/codex/zotero/deleteItems.ts` | `b3e8f9fea0ff22750066901ade692c9bd824ad84921535c604916781b74492ed` | `b3e8f9fea0ff22750066901ade692c9bd824ad84921535c604916781b74492ed` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/codex/zotero/exportTool.ts` | `runtime/codex/zotero/exportTool.ts` | `10f14e20b80037ef927260550fd83209c29d75a2a212e1b534b2f9c5ea0a3e7c` | `10f14e20b80037ef927260550fd83209c29d75a2a212e1b534b2f9c5ea0a3e7c` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/codex/zotero/findDuplicates.ts` | `runtime/codex/zotero/findDuplicates.ts` | `5eaefa5ad256a5fdc911cef4b275c331fbb04fefcaed940a2e953afb2e278775` | `5eaefa5ad256a5fdc911cef4b275c331fbb04fefcaed940a2e953afb2e278775` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/codex/zotero/formatBibliography.ts` | `runtime/codex/zotero/formatBibliography.ts` | `02a1b42baa015cbae10062cfaf14bfb33e07363517ac85173b6ae85b82e02d7e` | `02a1b42baa015cbae10062cfaf14bfb33e07363517ac85173b6ae85b82e02d7e` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/codex/zotero/fulltext.ts` | `runtime/codex/zotero/fulltext.ts` | `a1647df34bba175ce4cf5e78ac63c7aef8719af76ff1bc03f2c229e966ce074b` | `a1647df34bba175ce4cf5e78ac63c7aef8719af76ff1bc03f2c229e966ce074b` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/codex/zotero/getFulltext.ts` | `runtime/codex/zotero/getFulltext.ts` | `18a4fb7992eaafb262d874f04461b89bb30b21b8561cb9b446be9fb99aef8936` | `18a4fb7992eaafb262d874f04461b89bb30b21b8561cb9b446be9fb99aef8936` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/codex/zotero/getItem.ts` | `runtime/codex/zotero/getItem.ts` | `c337985217b8163dede9a86caccb4701a09aaae381fd53c18e4ef74ccb0858b9` | `c337985217b8163dede9a86caccb4701a09aaae381fd53c18e4ef74ccb0858b9` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/codex/zotero/groups.ts` | `runtime/codex/zotero/groups.ts` | `06acb2f958369ec27649babd6607dd0bd002c33c7b20822d8c9540d1a24af956` | `06acb2f958369ec27649babd6607dd0bd002c33c7b20822d8c9540d1a24af956` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/codex/zotero/importTool.ts` | `runtime/codex/zotero/importTool.ts` | `7b142e87254c4f2fcbb612e39d7cf80d60948047a3edd45252d566110345fce8` | `7b142e87254c4f2fcbb612e39d7cf80d60948047a3edd45252d566110345fce8` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/codex/zotero/index.ts` | `runtime/codex/zotero/index.ts` | `e83d588e00c2b03208bbecee5ed4c7dd58d7d8d99b74d695b707e8246ae8590a` | `e83d588e00c2b03208bbecee5ed4c7dd58d7d8d99b74d695b707e8246ae8590a` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/codex/zotero/listCollections.ts` | `runtime/codex/zotero/listCollections.ts` | `3e2a8c048484b7a226599e0607ee35d62e2c140e2c3695cc6726d653b3fc4522` | `3e2a8c048484b7a226599e0607ee35d62e2c140e2c3695cc6726d653b3fc4522` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/codex/zotero/listTags.ts` | `runtime/codex/zotero/listTags.ts` | `9dbb744a1ba997a99061d50ce49e16547ed69979e21ee5b3c2ca3fb37a2172d1` | `9dbb744a1ba997a99061d50ce49e16547ed69979e21ee5b3c2ca3fb37a2172d1` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/codex/zotero/manageCollections.ts` | `runtime/codex/zotero/manageCollections.ts` | `be9674453dcf9c21fab43f37c920b6db02e74a83ee287d77beca5fe3473f22c1` | `be9674453dcf9c21fab43f37c920b6db02e74a83ee287d77beca5fe3473f22c1` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/codex/zotero/manageTags.ts` | `runtime/codex/zotero/manageTags.ts` | `bcc647f6099f2628ba038119d01c5d9c67b73566f669bd89c3505243631a18cf` | `bcc647f6099f2628ba038119d01c5d9c67b73566f669bd89c3505243631a18cf` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/codex/zotero/mod.ts` | `runtime/codex/zotero/mod.ts` | `908d02a955ad88e7100889930b79ae6d074291489313c3076c087149e6495b81` | `908d02a955ad88e7100889930b79ae6d074291489313c3076c087149e6495b81` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/codex/zotero/savedSearches.ts` | `runtime/codex/zotero/savedSearches.ts` | `9219e5528743e4bc1271ea297651494b2f40cb4a2c8f3abdb6a9eb9dae0f8ddf` | `9219e5528743e4bc1271ea297651494b2f40cb4a2c8f3abdb6a9eb9dae0f8ddf` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/codex/zotero/schema.ts` | `runtime/codex/zotero/schema.ts` | `e74c49ccb4f50ebb9772f99a65f81b4f819e9dc6dc57c46afd806f73577c2d4d` | `e74c49ccb4f50ebb9772f99a65f81b4f819e9dc6dc57c46afd806f73577c2d4d` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/codex/zotero/scholar.ts` | `runtime/codex/zotero/scholar.ts` | `9428b68a9c6417b81f631410fdc0444568525abb13aabf8d2c8e93cd419d376d` | `9428b68a9c6417b81f631410fdc0444568525abb13aabf8d2c8e93cd419d376d` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/codex/zotero/searchItems.ts` | `runtime/codex/zotero/searchItems.ts` | `dd445afb342e90dec450006a1a3a8ab06d949a840101a0e7cdfe180d88287c54` | `dd445afb342e90dec450006a1a3a8ab06d949a840101a0e7cdfe180d88287c54` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/codex/zotero/searchTools.ts` | `runtime/codex/zotero/searchTools.ts` | `12784de64436ed083eb6bd5d22629f0b02bd8d491fcbcfbe740a258d2354c976` | `12784de64436ed083eb6bd5d22629f0b02bd8d491fcbcfbe740a258d2354c976` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/codex/zotero/semanticSearch.ts` | `runtime/codex/zotero/semanticSearch.ts` | `f2a63de8fa07d08291bce0476b0732e02e06c96b9d50ae3e764cc1eff461dc4b` | `f2a63de8fa07d08291bce0476b0732e02e06c96b9d50ae3e764cc1eff461dc4b` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/codex/zotero/styles.ts` | `runtime/codex/zotero/styles.ts` | `d8542e7cf74545c52e2d9f26ff75dad412dae174b68ec744cc41fa02a6069b9b` | `d8542e7cf74545c52e2d9f26ff75dad412dae174b68ec744cc41fa02a6069b9b` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/codex/zotero/sync.ts` | `runtime/codex/zotero/sync.ts` | `ca0c9f33a4fc9c632a690018f7739a7a6d2a85f6c8974113f0508edde21666bc` | `ca0c9f33a4fc9c632a690018f7739a7a6d2a85f6c8974113f0508edde21666bc` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/codex/zotero/tagAudit.ts` | `runtime/codex/zotero/tagAudit.ts` | `d5303060fbc8ceee3f06d77256343876f967d8599e5024dc5cc4d97c54f4a39e` | `d5303060fbc8ceee3f06d77256343876f967d8599e5024dc5cc4d97c54f4a39e` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/codex/zotero/trashItems.ts` | `runtime/codex/zotero/trashItems.ts` | `8c5632cff81d305b7195adb4a853dd7179597b4a92d118383a9f7720e72d29bf` | `8c5632cff81d305b7195adb4a853dd7179597b4a92d118383a9f7720e72d29bf` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/codex/zotero/updateItem.ts` | `runtime/codex/zotero/updateItem.ts` | `2c52d81b9b3c5a1cae5ef6ba2efabc8f273a27a73dff7d94b1aa669ad29c177a` | `2c52d81b9b3c5a1cae5ef6ba2efabc8f273a27a73dff7d94b1aa669ad29c177a` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/codex/zotero/whoami.ts` | `runtime/codex/zotero/whoami.ts` | `623c538d8f3588652be0acd2bfb955240ff6b5b0fcd59bf2ae8dbb730acc9a96` | `623c538d8f3588652be0acd2bfb955240ff6b5b0fcd59bf2ae8dbb730acc9a96` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/CONTRIBUTING.md` | `runtime/CONTRIBUTING.md` | `2b165caa0a27a4e466e7a0226a5b6c71ea65b90e560de6c8ce2d54cc84466014` | `2b165caa0a27a4e466e7a0226a5b6c71ea65b90e560de6c8ce2d54cc84466014` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/deploy/Caddyfile` | `runtime/deploy/Caddyfile` | `ddf8ec6e5f95b0958289130ea2943a54fc52b82995fe57d9aac84b1be2fab27d` | `ddf8ec6e5f95b0958289130ea2943a54fc52b82995fe57d9aac84b1be2fab27d` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/deploy/literature-zotero-mcp.service` | `runtime/deploy/literature-zotero-mcp.service` | `467e6a9438918c9689eddcf540d46b66d2daab583ca610404a9c63ca4fdc4ba6` | `467e6a9438918c9689eddcf540d46b66d2daab583ca610404a9c63ca4fdc4ba6` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/docker-compose.yml` | `runtime/docker-compose.yml` | `abc20cffe8ce8e7b51f1f4b79cdfc8dc5a34f309bd769ba8af73658d6ce9bdd1` | `abc20cffe8ce8e7b51f1f4b79cdfc8dc5a34f309bd769ba8af73658d6ce9bdd1` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/Dockerfile` | `runtime/Dockerfile` | `b35109cedda92105ab2f43f795de980cc21db2135281f401b09cd173a1443401` | `b35109cedda92105ab2f43f795de980cc21db2135281f401b09cd173a1443401` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/docs/architecture.md` | `runtime/docs/architecture.md` | `21c115d3c1f546a4e3b4f587be2289cdb4f1c9a8e982f1efceb10a7f500a7d28` | `21c115d3c1f546a4e3b4f587be2289cdb4f1c9a8e982f1efceb10a7f500a7d28` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/docs/citations.md` | `runtime/docs/citations.md` | `e3bbc783dfcbe1b32f13bd1fc48e440cc85bfc88677a127581c2ebb28786218d` | `e3bbc783dfcbe1b32f13bd1fc48e440cc85bfc88677a127581c2ebb28786218d` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/docs/code-execution.md` | `runtime/docs/code-execution.md` | `0abd80dd6006596183d2ee573fd1079d83bf6c632aac587aacdd5bd6bdcdc34d` | `0abd80dd6006596183d2ee573fd1079d83bf6c632aac587aacdd5bd6bdcdc34d` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/docs/configuration.md` | `runtime/docs/configuration.md` | `ac6b6c8a73e67b3012c1595fe9ef049bcdcd9f701c726df3b8a4709db64c82ea` | `ac6b6c8a73e67b3012c1595fe9ef049bcdcd9f701c726df3b8a4709db64c82ea` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/docs/deployment.md` | `runtime/docs/deployment.md` | `570411435a649946b7e79c056227ec319ecbfc09bc5fa1af6c4fa5e0727e04e5` | `570411435a649946b7e79c056227ec319ecbfc09bc5fa1af6c4fa5e0727e04e5` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/docs/distribution.md` | `runtime/docs/distribution.md` | `3276433e9d65d322b9c1e1eca840993de7dc68299f8be0c980be64ccf6982187` | `3276433e9d65d322b9c1e1eca840993de7dc68299f8be0c980be64ccf6982187` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/docs/files-and-sync.md` | `runtime/docs/files-and-sync.md` | `cd6ac701c0d0df86182ea1055fd0f57716124694685841994a60b9382b6d92f9` | `cd6ac701c0d0df86182ea1055fd0f57716124694685841994a60b9382b6d92f9` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/docs/grounding.md` | `runtime/docs/grounding.md` | `0986a1cfa2f5dfc1db7e228cbc81a2eaa471d9dce58a0522af6522dfa4834163` | `0986a1cfa2f5dfc1db7e228cbc81a2eaa471d9dce58a0522af6522dfa4834163` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/docs/prompts.md` | `runtime/docs/prompts.md` | `041a7b3b2a66a1d2ecc0875786ceeacb729b9f65c184b42a5ec4239111c8b660` | `041a7b3b2a66a1d2ecc0875786ceeacb729b9f65c184b42a5ec4239111c8b660` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/docs/remote-oauth.md` | `runtime/docs/remote-oauth.md` | `efb1d338e19d9bed22bb65ea51e0fb9b930bff4198d3f66ea0329e55b97baa2d` | `efb1d338e19d9bed22bb65ea51e0fb9b930bff4198d3f66ea0329e55b97baa2d` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/docs/scholar.md` | `runtime/docs/scholar.md` | `356c039e55a1cb80401703dc2dcc5362f90b6d9c55754e63d7de85b5c1901daf` | `356c039e55a1cb80401703dc2dcc5362f90b6d9c55754e63d7de85b5c1901daf` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/docs/semantic-search.md` | `runtime/docs/semantic-search.md` | `9860c5db2975fab458b0d754fbfd0381b11615f85bf4e043c606c2e2f89ddfb5` | `9860c5db2975fab458b0d754fbfd0381b11615f85bf4e043c606c2e2f89ddfb5` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/docs/writing.md` | `runtime/docs/writing.md` | `796a1668d130713edc149a1bd6cb7bcd9590e92c6e45f931ada33e1cd2edb539` | `796a1668d130713edc149a1bd6cb7bcd9590e92c6e45f931ada33e1cd2edb539` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/dxt/icon.png` | `runtime/dxt/icon.png` | `37d1d0e5d82562ac02f7f1ac566aec0a75ebd0412f35db7afd03044ca7c4a222` | `37d1d0e5d82562ac02f7f1ac566aec0a75ebd0412f35db7afd03044ca7c4a222` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/dxt/manifest.json` | `runtime/dxt/manifest.json` | `44005270322849e0550e2db1aede61d7ba313fe3dda264ebfdadd504cfed2429` | `44005270322849e0550e2db1aede61d7ba313fe3dda264ebfdadd504cfed2429` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/glama.json` | `runtime/glama.json` | `c0947cdb61a502a0a20e62c9a0108edc4d210594c78d8e3b87bcdedd60e39e18` | `c0947cdb61a502a0a20e62c9a0108edc4d210594c78d8e3b87bcdedd60e39e18` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/README.md` | `runtime/README.md` | `54eb919021315f417fc82f32191b41fead6940ef1f421983fa7baf2a38c185d0` | `54eb919021315f417fc82f32191b41fead6940ef1f421983fa7baf2a38c185d0` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/server.json` | `runtime/server.json` | `a1e8b78e29cd2cc20dc3e00fe66d99d4e5dfb935702d22a6b98457542807090b` | `a1e8b78e29cd2cc20dc3e00fe66d99d4e5dfb935702d22a6b98457542807090b` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/tests/api/attachments.test.ts` | `runtime/tests/api/attachments.test.ts` | `c2b75dc93825fe25463f586403565dc337830b05828b78b71d3007fa9192c6aa` | `c2b75dc93825fe25463f586403565dc337830b05828b78b71d3007fa9192c6aa` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/tests/api/bbt-client.test.ts` | `runtime/tests/api/bbt-client.test.ts` | `d97e0b7612fdded66fb27ea656b1466e804596d33f1f3bc98b8282a626106769` | `d97e0b7612fdded66fb27ea656b1466e804596d33f1f3bc98b8282a626106769` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/tests/api/errors.test.ts` | `runtime/tests/api/errors.test.ts` | `fb9897ab39a3d0643b38527c41d10c0a4a3e40716c57dcc4130b740c09f19e03` | `fb9897ab39a3d0643b38527c41d10c0a4a3e40716c57dcc4130b740c09f19e03` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/tests/api/http.test.ts` | `runtime/tests/api/http.test.ts` | `58b5d6abdc6b1d4c561be9bdc4ce161e8f0b1f54a7e392a9bf4a3e52d965341a` | `58b5d6abdc6b1d4c561be9bdc4ce161e8f0b1f54a7e392a9bf4a3e52d965341a` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/tests/api/local-client.test.ts` | `runtime/tests/api/local-client.test.ts` | `906d3f0ea918ae64131c7b807abcf512baf83ac8cd22b6af50fd902c05ec872b` | `906d3f0ea918ae64131c7b807abcf512baf83ac8cd22b6af50fd902c05ec872b` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/tests/api/web-client-files.test.ts` | `runtime/tests/api/web-client-files.test.ts` | `49f7132f7edcf3adc69aef963dac18235175a161383396556f836a2756387ae4` | `49f7132f7edcf3adc69aef963dac18235175a161383396556f836a2756387ae4` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/tests/api/web-client-writes.test.ts` | `runtime/tests/api/web-client-writes.test.ts` | `6cdc0a37ebea5d9628466a43f2b63ce1349e7fce641d5064233e94febfbfc1af` | `6cdc0a37ebea5d9628466a43f2b63ce1349e7fce641d5064233e94febfbfc1af` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/tests/api/web-client.test.ts` | `runtime/tests/api/web-client.test.ts` | `433f00bbe3568314d7320873e66fdedb63e62b837075010d0da16b61a39ac9e9` | `433f00bbe3568314d7320873e66fdedb63e62b837075010d0da16b61a39ac9e9` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/tests/auth/provider.test.ts` | `runtime/tests/auth/provider.test.ts` | `7701c64c3fb9cd50e0d8a1ef6a8835b1bc0256457a5232b9f11594b1f64da07c` | `7701c64c3fb9cd50e0d8a1ef6a8835b1bc0256457a5232b9f11594b1f64da07c` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/tests/auth/store.test.ts` | `runtime/tests/auth/store.test.ts` | `0beb9a1631b93cb642d00fbb58f0fcf68fd309d9503cf063e929433408eaacec` | `0beb9a1631b93cb642d00fbb58f0fcf68fd309d9503cf063e929433408eaacec` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/tests/auth/zotero-oauth.test.ts` | `runtime/tests/auth/zotero-oauth.test.ts` | `7ed0fbab9c7273090f3009a73cd2da9d3d85a18ca44957a2ae1f643569f1fc06` | `6c992037e82f65d108f5b0f1e8edea06aa6dce6a464a5b2ff0a6a3c720072b01` | no — intentional | D11 scan-gate fix: synthetic low-entropy OAuth fixtures. Outside the runtime tree-hash allowlist. |
| `literature-zotero-mcp/tests/config.test.ts` | `runtime/tests/config.test.ts` | `870cee642c913150602351398b458a753d3814db2b42ae2d581382653f377a30` | `870cee642c913150602351398b458a753d3814db2b42ae2d581382653f377a30` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/tests/e2e/live-writes.test.ts` | `runtime/tests/e2e/live-writes.test.ts` | `14ae56e3d1d7a6318e2437ae5551cc307ff21db7bb3f42db26d8c80ec5d41917` | `14ae56e3d1d7a6318e2437ae5551cc307ff21db7bb3f42db26d8c80ec5d41917` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/tests/e2e/live.test.ts` | `runtime/tests/e2e/live.test.ts` | `1946e1984acc23ac63a545912de026c61931e8b0a009035a8a42aa6ec9fa02ef` | `1946e1984acc23ac63a545912de026c61931e8b0a009035a8a42aa6ec9fa02ef` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/tests/env-files.test.ts` | `runtime/tests/env-files.test.ts` | `679cc2c0d6b7b7c39f7f052de2de4f8e21d34e42d1490c81e9ef82b74f73dee6` | `679cc2c0d6b7b7c39f7f052de2de4f8e21d34e42d1490c81e9ef82b74f73dee6` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/tests/features/duplicates.test.ts` | `runtime/tests/features/duplicates.test.ts` | `c5d08973557e2eee16fa5a5d9d0987e44dd139f56b12155266eba0ea88033d9b` | `c5d08973557e2eee16fa5a5d9d0987e44dd139f56b12155266eba0ea88033d9b` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/tests/features/evidence-metrics.test.ts` | `runtime/tests/features/evidence-metrics.test.ts` | `24b067eb3bda2517c7741393ea87cfbec0dec1acba9e799f406e3ac65f5e68db` | `24b067eb3bda2517c7741393ea87cfbec0dec1acba9e799f406e3ac65f5e68db` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/tests/features/fulltext-apply.test.ts` | `runtime/tests/features/fulltext-apply.test.ts` | `254ea5feb8b8120509e4bb466582d4ec83d00e1c928f1da4e8d55af5495c16d9` | `254ea5feb8b8120509e4bb466582d4ec83d00e1c928f1da4e8d55af5495c16d9` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/tests/features/fulltext-handoff-contract.test.ts` | `runtime/tests/features/fulltext-handoff-contract.test.ts` | `783227f8fdb942ab0ad20da28b2737413e813e5a3f35674589584b2438ae6ffb` | `783227f8fdb942ab0ad20da28b2737413e813e5a3f35674589584b2438ae6ffb` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/tests/features/fulltext.test.ts` | `runtime/tests/features/fulltext.test.ts` | `2d3ee4b95a89f4bae2dee3f7addad15ddcf5dd1281559bda52e294f8ab1c817f` | `2d3ee4b95a89f4bae2dee3f7addad15ddcf5dd1281559bda52e294f8ab1c817f` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/tests/features/metrics-plan.test.ts` | `runtime/tests/features/metrics-plan.test.ts` | `99d9e1f9b197957fbd9d0467dbb7f407458018a43cfb7e77877566e0164520d3` | `99d9e1f9b197957fbd9d0467dbb7f407458018a43cfb7e77877566e0164520d3` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/tests/features/pdf-pages.test.ts` | `runtime/tests/features/pdf-pages.test.ts` | `4167c96b71fe46f44aada67df52c6d2f5d85a1a438b72c029940c61d74dca2cc` | `4167c96b71fe46f44aada67df52c6d2f5d85a1a438b72c029940c61d74dca2cc` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/tests/features/project-sync.test.ts` | `runtime/tests/features/project-sync.test.ts` | `cc542713580ed3c58060886ecb350851613fa97ef8ecfd4ffc006a136bd95e6b` | `cc542713580ed3c58060886ecb350851613fa97ef8ecfd4ffc006a136bd95e6b` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/tests/features/scholar.test.ts` | `runtime/tests/features/scholar.test.ts` | `d15faca7afc58e44e5eef31adbac5c7ae57b41fbc31e420d39620b44eae9a71f` | `d15faca7afc58e44e5eef31adbac5c7ae57b41fbc31e420d39620b44eae9a71f` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/tests/features/search.test.ts` | `runtime/tests/features/search.test.ts` | `dcdeb57c7a9ab4b36702bcec47b1924620938a00e80224fdfb453762dc8bc1c4` | `dcdeb57c7a9ab4b36702bcec47b1924620938a00e80224fdfb453762dc8bc1c4` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/tests/features/styles.test.ts` | `runtime/tests/features/styles.test.ts` | `c9e102573799219892afeb24df25db50ac5979e3b06b40f8b8f8167aec6c6fe1` | `c9e102573799219892afeb24df25db50ac5979e3b06b40f8b8f8167aec6c6fe1` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/tests/features/tag-audit.test.ts` | `runtime/tests/features/tag-audit.test.ts` | `2067467cc635781619742151df335f16da5f647ec805adf55c7230594a2bf146` | `2067467cc635781619742151df335f16da5f647ec805adf55c7230594a2bf146` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/tests/fixtures/fulltext/login-page.html` | `runtime/tests/fixtures/fulltext/login-page.html` | `d0ed63959959d5c3439a76b405121e75ac6293df0d97708ae30df936cd144546` | `d0ed63959959d5c3439a76b405121e75ac6293df0d97708ae30df936cd144546` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/tests/fixtures/fulltext/main-article.pdf` | `runtime/tests/fixtures/fulltext/main-article.pdf` | `7fbe755609b7c1901e99de8b533ab73166f0e146957165d87a222395e9e0e2ed` | `7fbe755609b7c1901e99de8b533ab73166f0e146957165d87a222395e9e0e2ed` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/tests/fixtures/fulltext/README.md` | `runtime/tests/fixtures/fulltext/README.md` | `c3cde9c5696ba58d2c92740c070f9d16a848d28ece5b406d9d907475c9f4ef34` | `c3cde9c5696ba58d2c92740c070f9d16a848d28ece5b406d9d907475c9f4ef34` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/tests/integration/cimd-metadata.test.ts` | `runtime/tests/integration/cimd-metadata.test.ts` | `6b3db65f90551016d1aac567b3f3cfa133829b8bbc55529c513e1c9debe42ce2` | `6b3db65f90551016d1aac567b3f3cfa133829b8bbc55529c513e1c9debe42ce2` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/tests/integration/dns-rebinding.test.ts` | `runtime/tests/integration/dns-rebinding.test.ts` | `d918383f0771ed6127829bd3ab9fca2ed79a78115efa2f10020685a9e77fe6e3` | `d918383f0771ed6127829bd3ab9fca2ed79a78115efa2f10020685a9e77fe6e3` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/tests/integration/graceful-shutdown.test.ts` | `runtime/tests/integration/graceful-shutdown.test.ts` | `d84cc01ef437e0210428cbc4fdd1153105a5ceaa004951d9b033f6d7c5583bcf` | `d84cc01ef437e0210428cbc4fdd1153105a5ceaa004951d9b033f6d7c5583bcf` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/tests/integration/health-endpoints.test.ts` | `runtime/tests/integration/health-endpoints.test.ts` | `2caaf866b85875cce2467cfb21479c4d68b00cf952d6350c3e08c4ea874f553f` | `2caaf866b85875cce2467cfb21479c4d68b00cf952d6350c3e08c4ea874f553f` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/tests/integration/http-sessions.test.ts` | `runtime/tests/integration/http-sessions.test.ts` | `9f73cb05dd0ef3c5c7276a52de96888121da2eca04ccf9bf15a4a9136ed11322` | `9f73cb05dd0ef3c5c7276a52de96888121da2eca04ccf9bf15a4a9136ed11322` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/tests/integration/http.test.ts` | `runtime/tests/integration/http.test.ts` | `e612aed210601c2a97ab7287b2c5432e6d780d0a213a98321ab4085a68003c6d` | `e612aed210601c2a97ab7287b2c5432e6d780d0a213a98321ab4085a68003c6d` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/tests/integration/multitenant.test.ts` | `runtime/tests/integration/multitenant.test.ts` | `050c7f45f6cde947f209d9e5e155c52b99f2e4b300122fe7da2c2935a0a789bf` | `050c7f45f6cde947f209d9e5e155c52b99f2e4b300122fe7da2c2935a0a789bf` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/tests/integration/oauth-flow.test.ts` | `runtime/tests/integration/oauth-flow.test.ts` | `ae89082bc69a32f4093ca8b3700ba627f7aee1d8243cb5e342bddacadd42f275` | `ae89082bc69a32f4093ca8b3700ba627f7aee1d8243cb5e342bddacadd42f275` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/tests/integration/server.test.ts` | `runtime/tests/integration/server.test.ts` | `184dea7620611ceff2f385497104648016aa4ad3343817d103af9cfcfd94c76a` | `184dea7620611ceff2f385497104648016aa4ad3343817d103af9cfcfd94c76a` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/tests/lib/cimd.test.ts` | `runtime/tests/lib/cimd.test.ts` | `b231dc264d70f2439b541fcdce64e39f7b3a25bb8b8cc24062c965bd7b5dec0b` | `b231dc264d70f2439b541fcdce64e39f7b3a25bb8b8cc24062c965bd7b5dec0b` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/tests/lib/health.test.ts` | `runtime/tests/lib/health.test.ts` | `f40c58808b4739fd208a2710315464c37e71e04e21389cdfc2347c12a575516b` | `f40c58808b4739fd208a2710315464c37e71e04e21389cdfc2347c12a575516b` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/tests/lib/lifecycle.test.ts` | `runtime/tests/lib/lifecycle.test.ts` | `2c4970e688c2ba3e86949a1bdecabbb98b38f5c9bd5ff21b6ed6a0e1428df721` | `2c4970e688c2ba3e86949a1bdecabbb98b38f5c9bd5ff21b6ed6a0e1428df721` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/tests/lib/logger.test.ts` | `runtime/tests/lib/logger.test.ts` | `ecdb54b18d9810cb24f521c9d8768a55145a14d7fdcdde60516bbc4e6e32abe5` | `ecdb54b18d9810cb24f521c9d8768a55145a14d7fdcdde60516bbc4e6e32abe5` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/tests/lib/metrics.test.ts` | `runtime/tests/lib/metrics.test.ts` | `7daf2e1d45f147fdfde0c1ec6866284aab95f53e65aa2ebc70e2883a47ed6f09` | `7daf2e1d45f147fdfde0c1ec6866284aab95f53e65aa2ebc70e2883a47ed6f09` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/tests/lib/redact.test.ts` | `runtime/tests/lib/redact.test.ts` | `236af23811ad05c90edf48c954f823f2f8e1fe04ab54cc4c285e177c30d91a16` | `236af23811ad05c90edf48c954f823f2f8e1fe04ab54cc4c285e177c30d91a16` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/tests/lib/request-logger.test.ts` | `runtime/tests/lib/request-logger.test.ts` | `6cdad8c71c55fdf58553ba8dbbed29d9236314084a63450ae8a95b645d5d4027` | `6cdad8c71c55fdf58553ba8dbbed29d9236314084a63450ae8a95b645d5d4027` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/tests/lib/semaphore.test.ts` | `runtime/tests/lib/semaphore.test.ts` | `3f3c33d8ff7bd13963626003ad340a607a076fe41dfcf9728453e4284c17be35` | `3f3c33d8ff7bd13963626003ad340a607a076fe41dfcf9728453e4284c17be35` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/tests/paths.test.ts` | `runtime/tests/paths.test.ts` | `c164e6148064878503cf80874cc7121046a9f85bd484a7edd887753dc7b61b05` | `c164e6148064878503cf80874cc7121046a9f85bd484a7edd887753dc7b61b05` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/tests/read-only.test.ts` | `runtime/tests/read-only.test.ts` | `810fae340b793bcdc6d5ba6e975103f53cd75ee77a98501c9f7907e3189548de` | `810fae340b793bcdc6d5ba6e975103f53cd75ee77a98501c9f7907e3189548de` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/tests/router/capabilities.test.ts` | `runtime/tests/router/capabilities.test.ts` | `45b001382d336bb94ceb118266b8b95e6457928816da45bd70598a25697f8f1a` | `45b001382d336bb94ceb118266b8b95e6457928816da45bd70598a25697f8f1a` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/tests/router/library-router.test.ts` | `runtime/tests/router/library-router.test.ts` | `8726e5401c69aa2c4862f4400ed771d9a335a2f4d751b07bee8054c775417a13` | `8726e5401c69aa2c4862f4400ed771d9a335a2f4d751b07bee8054c775417a13` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/tests/schema/schema-service.test.ts` | `runtime/tests/schema/schema-service.test.ts` | `eb632bf07b10bb37790a383efedab6ab4ef783f0cc02a448c4cd329897d6439d` | `eb632bf07b10bb37790a383efedab6ab4ef783f0cc02a448c4cd329897d6439d` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/tests/schema/validate.test.ts` | `runtime/tests/schema/validate.test.ts` | `b2ea7f7cc198249b00ffbeb3696e4477fb16f10f73423ac51f67ac2c44d8001a` | `b2ea7f7cc198249b00ffbeb3696e4477fb16f10f73423ac51f67ac2c44d8001a` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/tests/tools/ai-summaries.test.ts` | `runtime/tests/tools/ai-summaries.test.ts` | `fcd3fffb1e9250125ec53cc68d426b7fe4a74b204d2875d493ad8001aae602f2` | `fcd3fffb1e9250125ec53cc68d426b7fe4a74b204d2875d493ad8001aae602f2` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/tests/tools/apply-citation-plan.test.ts` | `runtime/tests/tools/apply-citation-plan.test.ts` | `7e7f82bfabdcb1596f21f8b05ec4497c6405001e732b1f64871939eacca4b30d` | `7e7f82bfabdcb1596f21f8b05ec4497c6405001e732b1f64871939eacca4b30d` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/tests/tools/apply-import-plan.test.ts` | `runtime/tests/tools/apply-import-plan.test.ts` | `1f323c7611c58aa80f4c474fbb84c8951437bbcb9bec54e360a6b64d5de35c9b` | `1f323c7611c58aa80f4c474fbb84c8951437bbcb9bec54e360a6b64d5de35c9b` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/tests/tools/apply-metrics-plan.test.ts` | `runtime/tests/tools/apply-metrics-plan.test.ts` | `ca9eaf1b12a4ee0467d72deae0949d894d5fab63fec562afd5f58c67db7c1654` | `ca9eaf1b12a4ee0467d72deae0949d894d5fab63fec562afd5f58c67db7c1654` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/tests/tools/bibliography.test.ts` | `runtime/tests/tools/bibliography.test.ts` | `9b2a7de9620ad538c13f1b8793c699dbf176512d9ee1712934ae177177aa5998` | `9b2a7de9620ad538c13f1b8793c699dbf176512d9ee1712934ae177177aa5998` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/tests/tools/citation.test.ts` | `runtime/tests/tools/citation.test.ts` | `eeb8c287a19dfc9be7016bc20ea1b4ce402f9f7c89048a1f8b263fa64ef7fa92` | `eeb8c287a19dfc9be7016bc20ea1b4ce402f9f7c89048a1f8b263fa64ef7fa92` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/tests/tools/descriptions.test.ts` | `runtime/tests/tools/descriptions.test.ts` | `54b727a5bff759583b146fcd1011898fb09fb70b3eed62a31752532054d30129` | `54b727a5bff759583b146fcd1011898fb09fb70b3eed62a31752532054d30129` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/tests/tools/export.test.ts` | `runtime/tests/tools/export.test.ts` | `9cfe1293a9ed73a1ba8bdb3f90f07fb346b78e997660ce75fd24ab66934f414b` | `9cfe1293a9ed73a1ba8bdb3f90f07fb346b78e997660ce75fd24ab66934f414b` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/tests/tools/files.test.ts` | `runtime/tests/tools/files.test.ts` | `1bcc5998b2c172e41539b2aea7e6d9f5ff4e46932a48214584665dc0ec770f51` | `1bcc5998b2c172e41539b2aea7e6d9f5ff4e46932a48214584665dc0ec770f51` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/tests/tools/find-duplicates.test.ts` | `runtime/tests/tools/find-duplicates.test.ts` | `2f52ac1772bfc24a86e617a21a3b248e0a5d39a6a5d0d84782bb7097b90457f2` | `2f52ac1772bfc24a86e617a21a3b248e0a5d39a6a5d0d84782bb7097b90457f2` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/tests/tools/format-bibliography.test.ts` | `runtime/tests/tools/format-bibliography.test.ts` | `cd15256f29bbc165889b220521ebf3ff86639e5a64e454ef1df5185acb0f8274` | `cd15256f29bbc165889b220521ebf3ff86639e5a64e454ef1df5185acb0f8274` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/tests/tools/fulltext-context.test.ts` | `runtime/tests/tools/fulltext-context.test.ts` | `94049f688b7642a50b2260073a095d94ce8bccd2152b21fcfabd6c768ae9198e` | `94049f688b7642a50b2260073a095d94ce8bccd2152b21fcfabd6c768ae9198e` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/tests/tools/get-fulltext.test.ts` | `runtime/tests/tools/get-fulltext.test.ts` | `49ca1a00104f6004a6a7d8bbcd5148e1d5a5c3c11d1cc0d03401fae572c89c6c` | `49ca1a00104f6004a6a7d8bbcd5148e1d5a5c3c11d1cc0d03401fae572c89c6c` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/tests/tools/get-item.test.ts` | `runtime/tests/tools/get-item.test.ts` | `c245c901a1d3ae5ee8b6fa3cfc0efdacd3e53805cd35cb30bfea145df2eeae9f` | `c245c901a1d3ae5ee8b6fa3cfc0efdacd3e53805cd35cb30bfea145df2eeae9f` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/tests/tools/list-collections.test.ts` | `runtime/tests/tools/list-collections.test.ts` | `14605e4e5d56d96cb696423c315520503fa0cc946dc48059bd1ea8ba1f29380b` | `14605e4e5d56d96cb696423c315520503fa0cc946dc48059bd1ea8ba1f29380b` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/tests/tools/list-tags.test.ts` | `runtime/tests/tools/list-tags.test.ts` | `cff18aba42cbed837056315eea4969fee61ebb367b4d8569e8853cd3e108850b` | `cff18aba42cbed837056315eea4969fee61ebb367b4d8569e8853cd3e108850b` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/tests/tools/schema.test.ts` | `runtime/tests/tools/schema.test.ts` | `2bd9f3b149fe554aad8704164d249de8f06b573aaeb7447755fd1858738d475c` | `2bd9f3b149fe554aad8704164d249de8f06b573aaeb7447755fd1858738d475c` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/tests/tools/search-items.test.ts` | `runtime/tests/tools/search-items.test.ts` | `3414709d061e905d5b74f3b5dec27e9d918b286856e0308b91e6ca9829923956` | `3414709d061e905d5b74f3b5dec27e9d918b286856e0308b91e6ca9829923956` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/tests/tools/search-tools.test.ts` | `runtime/tests/tools/search-tools.test.ts` | `e54d22680fd0278de8448938d425bbe32f7220e3f166d8f5f8a5217870c225bb` | `e54d22680fd0278de8448938d425bbe32f7220e3f166d8f5f8a5217870c225bb` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/tests/tools/semantic-tags.test.ts` | `runtime/tests/tools/semantic-tags.test.ts` | `b107960e660b3b8094e397132e0d53de3343ba4f1f192a1db3a2120b17d85075` | `b107960e660b3b8094e397132e0d53de3343ba4f1f192a1db3a2120b17d85075` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/tests/tools/tag-audit.test.ts` | `runtime/tests/tools/tag-audit.test.ts` | `d8dde32e5c84fbfa7a3ca7e12781fafd396ca64719ba0bb54cfc177e09e0e53b` | `d8dde32e5c84fbfa7a3ca7e12781fafd396ca64719ba0bb54cfc177e09e0e53b` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/tests/tools/whoami.test.ts` | `runtime/tests/tools/whoami.test.ts` | `f35950727b6ee21da1d09d5a49735115ad0893742ec6f0b0e974f4faabe106d7` | `f35950727b6ee21da1d09d5a49735115ad0893742ec6f0b0e974f4faabe106d7` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/tests/tools/writes.test.ts` | `runtime/tests/tools/writes.test.ts` | `b5a7f39c0f12713c018fa0efa260c4715f785ea00c67304499ab80d97a924de3` | `b5a7f39c0f12713c018fa0efa260c4715f785ea00c67304499ab80d97a924de3` | yes | Copied tracked file outside the baseline filter |
| `literature-zotero-mcp/vitest.config.ts` | `runtime/vitest.config.ts` | `fa33c727d719f986f876fb0236a7323fa077648ee3295b28fab08dc82e1af22f` | `fa33c727d719f986f876fb0236a7323fa077648ee3295b28fab08dc82e1af22f` | yes | Copied tracked file outside the baseline filter |
| `literature-research/references/original-draft.md` | `skills/literature-research/references/original-draft.md` | `18841df8af75ad448d109318675fd57271eb833fea87c52fc60329b90d720e92` | `18841df8af75ad448d109318675fd57271eb833fea87c52fc60329b90d720e92` | yes | Copied tracked file outside the baseline filter |

Additional files: 145. Byte-identical: 143. Intentional diff: 2.

### Intentional layout diff

`fulltext-runtime/tests/broker.test.ts` imported `../../literature-zotero-mcp/src/features/fulltext/handoff-contract.js`. Under D8 that sibling directory is `runtime/`. The import now points at `../../runtime/src/features/fulltext/handoff-contract.js`. The handoff contract module itself is unchanged. Parent SHA-256 `65c7be0982a84b63bf0f266185eb8cef2479143fdf0d19804bab83d93f014c56`; current SHA-256 `cdb2000087227e32a21dd56adfa2c8daf131a547f3527c98f30d7797a1fce2b1`.

`skills/literature-research/references/original-draft.md` is tracked, so it was copied, but `excluded()` omits `original-draft.md` from the baseline tree hash. Its per-file hash matches.

### Intentional D11 scan-gate fix

`runtime/tests/auth/zotero-oauth.test.ts` (parent `literature-zotero-mcp/tests/auth/zotero-oauth.test.ts`).

Reason: D11 pre-push scan gate. `gitleaks` rule `generic-api-key` matched the public-documentation example constants for `oauth_consumer_key`, `oauth_nonce`, and `oauth_token` in the signature-base-string fixture. Any hit stops the push. Allow comments and `.gitleaks.toml` / `.gitleaksignore` exemptions are forbidden. The parent checkout stays frozen (N5); only this repository is fixed.

Disposition: those three fixtures were replaced with synthetic low-entropy values, and the expected signature base string was recomputed by hand (parameter sort, `&` join, and a second percent-encoding pass). No other test in the file was restructured.

Runtime tree hash: this file lives under `runtime/tests/`, which the historical runtime allowlist does not include (kept names are `.env.example`, `LICENSE`, `THIRD_PARTY_NOTICES.md`, `licenses`, `package-lock.json`, `package.json`, `scripts`, `src`, and `tsconfig.json`). The migration-time runtime tree baseline therefore stays archived as `4e01b0e628c65e8a8219fcfdf95fbf4932c0374e77b59ba2a7f2d1505c2c4726`. This is a later gate-fix difference, not a rewrite of that baseline, and it does not change the in-filter tree hash.

Parent SHA-256 `7ed0fbab9c7273090f3009a73cd2da9d3d85a18ca44957a2ae1f643569f1fc06`; current SHA-256 `6c992037e82f65d108f5b0f1e8edea06aa6dce6a464a5b2ff0a6a3c720072b01`.

## Plugin-only content

Copied from tracked files under `plugins/ai4s-literature-workbench/`, not from the assembled `skills/`, `runtime/`, or `fulltext-runtime/` snapshots in that directory. Those snapshots were not the migration baseline.

`database-browser-runtime/` is plugin-only. Its 18 tracked files are byte-identical; the bundle row above is the tree hash.

| Parent path | New path | Parent SHA-256 | Current SHA-256 | Match |
| --- | --- | --- | --- | --- |
| `plugins/ai4s-literature-workbench/.claude-plugin/plugin.json` | `.claude-plugin/plugin.json` | `ada678958eead139c8883c17da9b6df19bc99f783bfdf7d1c6f7d631bc32b2a6` | `ada678958eead139c8883c17da9b6df19bc99f783bfdf7d1c6f7d631bc32b2a6` | yes |
| `plugins/ai4s-literature-workbench/.codex-plugin/plugin.json` | `.codex-plugin/plugin.json` | `de0b9e0f2d3cc67f979121d7e4cab26a49fc2422bcdfd81361fb969cf668f14b` | `de0b9e0f2d3cc67f979121d7e4cab26a49fc2422bcdfd81361fb969cf668f14b` | yes |
| `plugins/ai4s-literature-workbench/.mcp.json` | `.mcp.json` | `d78fac08e42f5bf23ae49ad6e67015d537d0efaf3f576193fa211739a8b86074` | `d78fac08e42f5bf23ae49ad6e67015d537d0efaf3f576193fa211739a8b86074` | yes |
| `plugins/ai4s-literature-workbench/bundle-manifest.json` | `bundle-manifest.json` | `33ab896d5309f9e25fbad8255e1794b26c46ecc917d7b896a19c96833dbf6c10` | `f4bd0e17b9d11fc1a9418020657159b0def9ca576f47c979b9fb63aa215f960c` | no — intentional |
| `plugins/ai4s-literature-workbench/CHANGELOG.md` | `CHANGELOG.md` | `a5c0cc66d785abbe5b209d714752820000bcd6f27225ebb4dc1ba547f38b396d` | `a5c0cc66d785abbe5b209d714752820000bcd6f27225ebb4dc1ba547f38b396d` | yes |
| `plugins/ai4s-literature-workbench/docs/onboarding.md` | `docs/onboarding.md` | `2a9f1c201e4fae3ed79aa76844c8e8d3fc384d8a3ab382d6e30afd68e8549e56` | `2a9f1c201e4fae3ed79aa76844c8e8d3fc384d8a3ab382d6e30afd68e8549e56` | yes |
| `plugins/ai4s-literature-workbench/docs/windows-acceptance.md` | `docs/windows-acceptance.md` | `a2bf12250ce6acef7da0bc55d89d05ae0830cfcc3da42e05cb5a422d6437447c` | `a2bf12250ce6acef7da0bc55d89d05ae0830cfcc3da42e05cb5a422d6437447c` | yes |
| `plugins/ai4s-literature-workbench/LICENSE` | `LICENSE` | `7a184f6d9abbc48c6039610edaccd3e74f4f6a1cb767ebfc370598f0fa7d2ef8` | `7a184f6d9abbc48c6039610edaccd3e74f4f6a1cb767ebfc370598f0fa7d2ef8` | yes |
| `plugins/ai4s-literature-workbench/scripts/assemble-plugin.mjs` | `scripts/assemble-plugin.mjs` | `2981d431a2aa9fb0624970f25f573ef4f13b0847cd533721077b7b378209d56f` | `7b8858d25e530dc46a214402e4dd9f447bd8dc17b72d732c10511213e1187141` | no — intentional |
| `plugins/ai4s-literature-workbench/scripts/bootstrap-runtime.ps1` | `scripts/bootstrap-runtime.ps1` | `16e88e5806cf48cb8a8c0b006492fb53f651029794e45ee599e607bf4cc70800` | `16e88e5806cf48cb8a8c0b006492fb53f651029794e45ee599e607bf4cc70800` | yes |
| `plugins/ai4s-literature-workbench/scripts/bootstrap-runtime.sh` | `scripts/bootstrap-runtime.sh` | `b9fcd6a954c2d5367487887fda508c913370be5982f628f2cc0cdbc1b4e9fa9b` | `b9fcd6a954c2d5367487887fda508c913370be5982f628f2cc0cdbc1b4e9fa9b` | yes |
| `plugins/ai4s-literature-workbench/scripts/onboard.mjs` | `scripts/onboard.mjs` | `2864f6d07f44dd20cdc96bd05aae4d7811041a39ce461f785ad260c635bb5595` | `2864f6d07f44dd20cdc96bd05aae4d7811041a39ce461f785ad260c635bb5595` | yes |
| `plugins/ai4s-literature-workbench/scripts/verify-database-browser-runtime.mjs` | `scripts/verify-database-browser-runtime.mjs` | `2792a8716ab813ce616d11b37789c0561fc6342f73d02bc0cd12257b9528c6ff` | `2792a8716ab813ce616d11b37789c0561fc6342f73d02bc0cd12257b9528c6ff` | yes |
| `plugins/ai4s-literature-workbench/scripts/verify-fulltext-runtime.mjs` | `scripts/verify-fulltext-runtime.mjs` | `677306a0226f3767b3dc5a56243fe2a48c397de216f388d5e6b663798c84a5d5` | `677306a0226f3767b3dc5a56243fe2a48c397de216f388d5e6b663798c84a5d5` | yes |
| `plugins/ai4s-literature-workbench/scripts/verify-runtime.mjs` | `scripts/verify-runtime.mjs` | `2711d08bb21a15d301ddb843fba15efac8469b1d83dfba5ea51afd205f62543e` | `2711d08bb21a15d301ddb843fba15efac8469b1d83dfba5ea51afd205f62543e` | yes |
| `plugins/ai4s-literature-workbench/scripts/windows-acceptance.ps1` | `scripts/windows-acceptance.ps1` | `388b22b7d2c64e7193d667011251429133608019ec2d17673fd055408c5a248e` | `20fa18975c98d7102c1e2c0bae5b1e68524cef16044a4742ddad7ca9435df81f` | no — intentional |
| `plugins/ai4s-literature-workbench/tests/onboarding.test.mjs` | `tests/onboarding.test.mjs` | `780b3af4c49d5a2ac2c94cc9a441e567c2c4c7955a2151dbde9fa7df3e11c22b` | `d073e0b93178294848bff6ba26e2446cb38cb19697e0db03bd32f77a883888a0` | no — intentional |

### Intentional post-copy edits

| New path | Why | Parent SHA-256 | Current SHA-256 |
| --- | --- | --- | --- |
| `scripts/assemble-plugin.mjs` | T1.5: removed parent sync/drift; check now validates structure, manifest inventory, artifacts, lockfiles, and build inputs. | `2981d431a2aa9fb0624970f25f573ef4f13b0847cd533721077b7b378209d56f` | `7b8858d25e530dc46a214402e4dd9f447bd8dc17b72d732c10511213e1187141` |
| `bundle-manifest.json` | T1.5: replaced parent source_root and fixed source hashes with in-repo inventory metadata. | `33ab896d5309f9e25fbad8255e1794b26c46ecc917d7b896a19c96833dbf6c10` | `f4bd0e17b9d11fc1a9418020657159b0def9ca576f47c979b9fb63aa215f960c` |
| `scripts/windows-acceptance.ps1` | D8 path correction: repo root is this checkout; runtime, fulltext-runtime, skills/*, and scripts/assemble-plugin.mjs. | `388b22b7d2c64e7193d667011251429133608019ec2d17673fd055408c5a248e` | `20fa18975c98d7102c1e2c0bae5b1e68524cef16044a4742ddad7ca9435df81f` |
| `tests/onboarding.test.mjs` | T1.6: added legacy/native/override and XPI artifact-template tests. Existing cases kept. | `780b3af4c49d5a2ac2c94cc9a441e567c2c4c7955a2151dbde9fa7df3e11c22b` | `d073e0b93178294848bff6ba26e2446cb38cb19697e0db03bd32f77a883888a0` |

New in this repository, not a parent copy:

- `tests/env-file-fallback.test.mjs` — proves `runtime/src/lib/env-files.ts` still loads the legacy `~/.config/ai4s-literature-workbench/zotero.env`, keeps native paths, and honors `LITERATURE_ZOTERO_MCP_ENV_FILE`.
- `docs/migration-from-parent.md` — this archive.

Root files kept from the T1.1 baseline instead of being replaced:

| File | Decision | Parent plugin SHA-256 | Current SHA-256 |
| --- | --- | --- | --- |
| `LICENSE` | Copied. Identical to the plugin license and the T1.1 license. | `7a184f6d9abbc48c6039610edaccd3e74f4f6a1cb767ebfc370598f0fa7d2ef8` | `7a184f6d9abbc48c6039610edaccd3e74f4f6a1cb767ebfc370598f0fa7d2ef8` |
| `THIRD_PARTY_NOTICES.md` | T1.1 text kept. It already names runtime, fulltext, database-browser, and literature-metrics. The shorter plugin notice was not allowed to regress that baseline. | `33db5f384cb2312a908d27bb130135bc9ccb542e1a961c9b605d80ddc79731db` | `342e1de2a997096db383fd1afbf130a5aa82964a127d825540f69df95955d58f` |
| `README.md` | T1.1 placeholder kept. Plugin README rewrite belongs to M6/T6.1. | not copied | unchanged placeholder |
| `.gitignore` | T1.1 rules kept. Added local output globs from the plugin ignore file: `bootstrap-report*.json`, `windows-acceptance*.json`, `onboarding-result*.json`, `onboarding-status*.json`, `*.tgz`. | not overwritten | augmented |

## Exclusion list

Not migrated:

- Parent `.git/` history. This repository is a fresh seed. The only `.git` is this repository's own.
- `forge/**`, explicitly including `forge/vpnsci` and `forge/zotero-style`. Those directories exist in the parent working tree and were not copied. `find` in this repository reports no `forge` directory.
- Parent design notes and plans that are not in the M1 file table: `*-plan.md`, `*-design.md`, `literature-workbench 插件设计.md`, `zotero-期刊指标与标签展示设计.md`, `v0.1.0-release-plan.md`, `plans/`, `macos-acceptance.json`.
- Assembled plugin snapshots of `skills/`, `runtime/`, and `fulltext-runtime/`. Formal parent packages were the baseline instead.
- `node_modules/`, `dist/`, `data/`, pytest/coverage caches, and every `.env*` except `.env.example`.

Present locally after validation, and ignored rather than tracked:

- `runtime/node_modules/`, `fulltext-runtime/node_modules/`, `database-browser-runtime/node_modules/`, `literature-metrics/node_modules/`
- `runtime/dist/`, `fulltext-runtime/dist/`, `database-browser-runtime/dist/`, `literature-metrics/dist/` (includes `literature-metrics/dist/literature-metrics-0.1.13.xpi`)

No `data/` directory and no `.env` file other than the three `.env.example` files were found.

## `.mcp.json` resolution

Stdio commands are relative to the repository root (`cwd: "."`). After `npm run build` in each runtime:

| Server | Argument | Resolved path | Exists |
| --- | --- | --- | --- |
| `ai4s-literature-zotero` | `./runtime/dist/index.js` | `runtime/dist/index.js` | yes, produced by `tsc` |
| `ai4s-literature-fulltext` | `./fulltext-runtime/dist/index.js` | `fulltext-runtime/dist/index.js` | yes, produced by `tsc` |

`check` does not build these files. If either is missing it exits non-zero and prints:

```text
cd runtime && npm ci && npm run build
cd fulltext-runtime && npm ci && npm run build
```

The historical esbuild bundle step is not used. `runtime/package.json` `scripts` are byte-identical to the parent package, and `npm run build` is `tsc -p tsconfig.json`.

## XPI

`literature-metrics/` tree hash matches the parent root package (see the bundle table). No XPI source file was edited. `npm run package` wrote `literature-metrics/dist/literature-metrics-0.1.13.xpi`. Onboarding still points at `literature-metrics/dist/literature-metrics-<version>.xpi`.

## In-repo check

`node scripts/assemble-plugin.mjs check` verifies:

1. Structure: three skills, three runtime packages' `src` + `package.json` + lockfile, `literature-metrics/manifest.json`, `tests/`, `scripts/`, `.mcp.json`.
2. `bundle-manifest.json` schema 2 inventory. It must not contain `sha256` or `source_root`.
3. The two MCP dist entries exist.
4. Four lockfiles are acceptable to `npm ci --ignore-scripts --dry-run`.
5. TypeScript build entries are non-empty, contain `async function main`, and pass `tsc --noEmit`. `literature-metrics` build inputs pass `node scripts/check.mjs`.

A damaged lockfile or a damaged `runtime/src/index.ts` makes `check` exit 1. Restoring the file makes it exit 0. Editing ordinary source does not trip a fixed hash.
