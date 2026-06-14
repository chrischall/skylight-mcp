# Changelog

## [0.4.3](https://github.com/chrischall/skylight-mcp/compare/v0.4.2...v0.4.3) (2026-06-14)


### Documentation

* require Conventional Commit PR titles for release-please ([#51](https://github.com/chrischall/skylight-mcp/issues/51)) ([7fa2bf2](https://github.com/chrischall/skylight-mcp/commit/7fa2bf2597eeb81db68db1bc5849351f11a78588))

## [0.4.2](https://github.com/chrischall/skylight-mcp/compare/v0.4.1...v0.4.2) (2026-06-13)


### Bug Fixes

* bot PRs bypass the CI gate unconditionally ([#46](https://github.com/chrischall/skylight-mcp/issues/46)) ([42cb0b4](https://github.com/chrischall/skylight-mcp/commit/42cb0b43c01aec1e0d53be1059e0570e25ac0998))


### Documentation

* add MIT LICENSE file and README badges ([#43](https://github.com/chrischall/skylight-mcp/issues/43)) ([d63e452](https://github.com/chrischall/skylight-mcp/commit/d63e4522fc5f8e4ee50b7cd5e026f4062172151d))

## [0.4.1](https://github.com/chrischall/skylight-mcp/compare/v0.4.0...v0.4.1) (2026-06-10)


### Bug Fixes

* retry transient login failures, single-flight first login, add request timeout ([#38](https://github.com/chrischall/skylight-mcp/issues/38)) ([a2df459](https://github.com/chrischall/skylight-mcp/commit/a2df459d166da48404411180423240f4404fabba))


### Refactor

* adopt CookieSessionManager for lazy login + config-error caching ([#41](https://github.com/chrischall/skylight-mcp/issues/41)) ([4e95a53](https://github.com/chrischall/skylight-mcp/commit/4e95a530b9d64f0970725c7da672cd5818847b0c))
* adopt createOAuth2Refresher and stateful CookieJar from mcp-utils 0.7.0 ([#40](https://github.com/chrischall/skylight-mcp/issues/40)) ([abdc462](https://github.com/chrischall/skylight-mcp/commit/abdc46251744832f7091804e4a6f56912987c406))
* drop isExpired stub now that mcp-utils 0.9.0 makes it optional ([#42](https://github.com/chrischall/skylight-mcp/issues/42)) ([bcace28](https://github.com/chrischall/skylight-mcp/commit/bcace2877f7573d3a7653789d70a0da897a4e9a9))

## [0.4.0](https://github.com/chrischall/skylight-mcp/compare/v0.3.0...v0.4.0) (2026-06-02)


### Features

* 0.4.0 — recurring chores, routines, AI auto-creation, meals/rewards/album fixes (mobile-app surface) ([#24](https://github.com/chrischall/skylight-mcp/issues/24)) ([7847f57](https://github.com/chrischall/skylight-mcp/commit/7847f5778955b86f8b9f9e18a6263e7f271fa904))
* create_category + list_avatars ([#10](https://github.com/chrischall/skylight-mcp/issues/10)) ([#26](https://github.com/chrischall/skylight-mcp/issues/26)) ([d318067](https://github.com/chrischall/skylight-mcp/commit/d318067371ffb2fef30d77aba637b06e2863753f))
* custom-photo member avatars via multipart upload ([#10](https://github.com/chrischall/skylight-mcp/issues/10)) ([#30](https://github.com/chrischall/skylight-mcp/issues/30)) ([51825f3](https://github.com/chrischall/skylight-mcp/commit/51825f34ffab1ae0dd93a69e58091eee9cc6ac3f))
* list_auto_creation_intents + list_auto_creation_items ([#15](https://github.com/chrischall/skylight-mcp/issues/15)) ([#27](https://github.com/chrischall/skylight-mcp/issues/27)) ([0c80bc4](https://github.com/chrischall/skylight-mcp/commit/0c80bc4889866e916b3a28ae13bf84bda483895d))
* photo/video upload to the frame ([#12](https://github.com/chrischall/skylight-mcp/issues/12)) ([#28](https://github.com/chrischall/skylight-mcp/issues/28)) ([5252f15](https://github.com/chrischall/skylight-mcp/commit/5252f159a66edf1406c3bfe75ba9ab564a204a38))


### Bug Fixes

* per-instance chore completion ([#13](https://github.com/chrischall/skylight-mcp/issues/13)) ([#29](https://github.com/chrischall/skylight-mcp/issues/29)) ([fdd66ff](https://github.com/chrischall/skylight-mcp/commit/fdd66ffc1422f069a909863b80642496d49dce6c))


### Performance

* stream avatar upload from disk instead of buffering it ([#32](https://github.com/chrischall/skylight-mcp/issues/32)) ([bf2cbea](https://github.com/chrischall/skylight-mcp/commit/bf2cbea13c9f1b2e9897136bd470577fe68e4e63))


### Refactor

* adopt mcp-utils 0.4.0 fileBlob for the avatar upload + enforce coverage ([#34](https://github.com/chrischall/skylight-mcp/issues/34)) ([21e990c](https://github.com/chrischall/skylight-mcp/commit/21e990cfed9ef98ce2699cd1c2e4e42379f7de06))
* SkylightClient onto shared createApiClient + TokenManager ([#31](https://github.com/chrischall/skylight-mcp/issues/31)) ([a6861e8](https://github.com/chrischall/skylight-mcp/commit/a6861e86fe97d7b9e07ed0c12595152b5758d8e9))

## [0.3.0](https://github.com/chrischall/skylight-mcp/compare/v0.2.2...v0.3.0) (2026-06-01)


### Features

* expand to 86 tools — rewards, chores, meal writes, frame/calendar settings, albums/messages, member management + polish ([#20](https://github.com/chrischall/skylight-mcp/issues/20)) ([22fd03c](https://github.com/chrischall/skylight-mcp/commit/22fd03c035cecf40ac1e87bc2eceb0bb7b6c945b))
* expand tool surface to 37 (meals, tasks, messages, calendars, reward points) + fix update verbs & list writes ([#7](https://github.com/chrischall/skylight-mcp/issues/7)) ([b0463ae](https://github.com/chrischall/skylight-mcp/commit/b0463ae6a828af333655bcef77a52dbdcb3a6952))

## [0.2.2](https://github.com/chrischall/skylight-mcp/compare/v0.2.1...v0.2.2) (2026-05-30)


### Bug Fixes

* add .mcpbignore to shrink the .mcpb bundle ([#5](https://github.com/chrischall/skylight-mcp/issues/5)) ([076e89c](https://github.com/chrischall/skylight-mcp/commit/076e89c18cccffd1e1a7a99398aaaf8777a4e5b7))

## [0.2.1](https://github.com/chrischall/skylight-mcp/compare/v0.2.0...v0.2.1) (2026-05-30)


### Bug Fixes

* add SKILL.md so release publish packaging succeeds ([#3](https://github.com/chrischall/skylight-mcp/issues/3)) ([bac61fd](https://github.com/chrischall/skylight-mcp/commit/bac61fd75d3ce0af46a2289836a4f7848d1c0120))

## [0.2.0](https://github.com/chrischall/skylight-mcp/compare/v0.1.0...v0.2.0) (2026-05-30)


### Features

* Skylight Calendar MCP (events, chores, lists) ([#1](https://github.com/chrischall/skylight-mcp/issues/1)) ([25846c6](https://github.com/chrischall/skylight-mcp/commit/25846c6ae0058ff7e60e57f447b8d50fe4c6793e))


### Documentation

* skylight-mcp design spec (v0.1.0) ([ae4d5d6](https://github.com/chrischall/skylight-mcp/commit/ae4d5d6536f7f61268112ad1cc4aaad05324093b))
* skylight-mcp implementation plan ([5eeb0c4](https://github.com/chrischall/skylight-mcp/commit/5eeb0c437a2504bbd5bf1319cf53226b47bf5ad0))
