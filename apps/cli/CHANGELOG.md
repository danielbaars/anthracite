# Changelog

## [0.6.10](https://github.com/danielbaars/anthracite/compare/v0.6.9...v0.6.10) (2026-11-05)


### Bug Fixes

* **cli:** preserve ancestor PR bodies during selective submit ([54c11fd](https://github.com/danielbaars/anthracite/commit/54c11fd794448da8c350a30b223f8dba18685f89))
* **cli:** repair stale dependency footers on unchanged submit ([1e7ab69](https://github.com/danielbaars/anthracite/commit/1e7ab6900791ec9d6fd01668da9853d0b3b5557d))

## [0.6.9](https://github.com/danielbaars/anthracite/compare/v0.6.8...v0.6.9) (2026-11-04)


### Bug Fixes

* **cli:** fall back to sh for executable shebangless hooks [skip ci] ([6c16918](https://github.com/danielbaars/anthracite/commit/6c16918f74a5a6a95c6cb8b5104df8ec86e5179c))
* **cli:** parse userinfo in GitHub remote URLs [skip ci] ([b1e444a](https://github.com/danielbaars/anthracite/commit/b1e444aafee4f6a840cb092cc59a6d7bbfdd5984))

## [0.6.8](https://github.com/danielbaars/anthracite/compare/v0.6.7...v0.6.8) (2026-11-04)


### Bug Fixes

* **cli:** honor test execution scope and trunk selection [skip ci] ([efc5c41](https://github.com/danielbaars/anthracite/commit/efc5c4137e9871006fc1a3a3a621cada6f95261e))
* **cli:** identify sync PR repositories by owner and name [skip ci] ([5986699](https://github.com/danielbaars/anthracite/commit/59866997fb117c8020c12b14f84893b801306ea3))

## [0.6.7](https://github.com/danielbaars/anthracite/compare/v0.6.6...v0.6.7) (2026-11-03)


### Bug Fixes

* **cli:** verify landing policy when rules access is plan-restricted ([b9f9081](https://github.com/danielbaars/anthracite/commit/b9f9081d9271473d420ebe9ed0f38c42270d2fc8))

## [0.6.6](https://github.com/danielbaars/anthracite/compare/v0.6.5...v0.6.6) (2026-11-03)


### Bug Fixes

* **cli:** inspect resumed landing plans before confirmation ([d036ac3](https://github.com/danielbaars/anthracite/commit/d036ac3130b7e26f865d33f3f9d9195f364837b1))

## [0.6.5](https://github.com/danielbaars/anthracite/compare/v0.6.4...v0.6.5) (2026-11-02)


### Bug Fixes

* **cli:** resume landing after independent trunk advances ([e61d445](https://github.com/danielbaars/anthracite/commit/e61d4455e002f0cea21facdbc1fcab268912162f))

## [0.6.4](https://github.com/danielbaars/anthracite/compare/v0.6.3...v0.6.4) (2026-11-02)


### Bug Fixes

* **cli:** simplify resumed landing plans ([9e8d382](https://github.com/danielbaars/anthracite/commit/9e8d382d17b4f299fb72828f74f8a0e702c1f02b))

## [0.6.3](https://github.com/danielbaars/anthracite/compare/v0.6.2...v0.6.3) (2026-11-02)


### Bug Fixes

* **cli:** clarify landing plans and wait for running checks ([e854e89](https://github.com/danielbaars/anthracite/commit/e854e89edff1d9c3b2fc915d0ffc75e660282c9b))

## [0.6.2](https://github.com/danielbaars/anthracite/compare/v0.6.1...v0.6.2) (2026-11-02)


### Bug Fixes

* **cli:** verify classic absence for ruleset-only landing ([f3ff5fa](https://github.com/danielbaars/anthracite/commit/f3ff5fa017fb14ed9695138bfa5152516f3c1f6c))

## [0.6.1](https://github.com/danielbaars/anthracite/compare/v0.6.0...v0.6.1) (2026-11-02)


### Bug Fixes

* **cli:** preserve local commits after a parent PR merges ([410a4bd](https://github.com/danielbaars/anthracite/commit/410a4bd4968857af33f05618eebe4954663772ea))

## [0.6.0](https://github.com/danielbaars/anthracite/compare/v0.5.1...v0.6.0) (2026-11-01)


### Features

* **cli:** add scoped get updates and restack controls ([#77](https://github.com/danielbaars/anthracite/issues/77)) [skip ci] ([26c8b64](https://github.com/danielbaars/anthracite/commit/26c8b64373e0c57bf2fd833a6a65bfeb827d8bfd))
* **cli:** refresh sync branches with separate cleanup consent ([ac3a2fd](https://github.com/danielbaars/anthracite/commit/ac3a2fd638bf2376a0d8371f8b8f7d5e3cf4baf1))

## [0.5.1](https://github.com/danielbaars/anthracite/compare/v0.5.0...v0.5.1) (2026-10-31)


### Bug Fixes

* **cli:** clean closed descendants below retained branches [skip ci] ([beaee3f](https://github.com/danielbaars/anthracite/commit/beaee3f846f93d8f5dc867645727da1db46b48fa))

## [0.5.0](https://github.com/danielbaars/anthracite/compare/v0.4.0...v0.5.0) (2026-10-30)


### Features

* **cli:** add GitHub review and scoped stack landing ([#65](https://github.com/danielbaars/anthracite/issues/65)) [skip ci] ([1d3f753](https://github.com/danielbaars/anthracite/commit/1d3f753f5e40d8a0aeab2ce2ef2738de2435a74a))

## [0.4.0](https://github.com/danielbaars/anthracite/compare/v0.3.0...v0.4.0) (2026-10-30)


### Features

* **cli:** choose insertion children interactively ([43ab22b](https://github.com/danielbaars/anthracite/commit/43ab22bb9604900cdce08b53afad1e32449f0e9d))
* **cli:** deliver targeted insertion to agents ([d5b6985](https://github.com/danielbaars/anthracite/commit/d5b69854c70cd8d1033996a8334ef6c530e73310))
* **cli:** select explicit children for branch insertion ([b45856d](https://github.com/danielbaars/anthracite/commit/b45856d9b9b4ff3cde73122b4ce94875ddbe27c4))


### Bug Fixes

* **cli:** protect selected insert continuation scope ([f116e7f](https://github.com/danielbaars/anthracite/commit/f116e7f37a139cf58698734971657bef813412bc))
* **cli:** warn before implicit multi-child insertion ([98251af](https://github.com/danielbaars/anthracite/commit/98251af933641b02c658942ed06a5e20928643fa))

## [0.3.0](https://github.com/danielbaars/anthracite/compare/v0.2.1...v0.3.0) (2026-10-29)


### Features

* **cli:** absorb multiple corrections and replay tracked fan-out ([#43](https://github.com/danielbaars/anthracite/issues/43)) ([60c2103](https://github.com/danielbaars/anthracite/commit/60c210327c8b1b373064c90d9428306815615fcd))
* **cli:** add absorb staging and plan confirmation ([#45](https://github.com/danielbaars/anthracite/issues/45)) ([0511781](https://github.com/danielbaars/anthracite/commit/0511781a7d87a7212b91a45cd266404c74f35022))
* **cli:** add safe absorb previews ([#40](https://github.com/danielbaars/anthracite/issues/40)) ([35393db](https://github.com/danielbaars/anthracite/commit/35393dbcc8a42cfad6f1f170fe07e7fbf8e4a1e8))
* **cli:** apply a single absorb correction with retained work ([#42](https://github.com/danielbaars/anthracite/issues/42)) ([98540be](https://github.com/danielbaars/anthracite/commit/98540bef72438528972f3fa1ac6b034d83542739))
* **cli:** resume absorb replays and restore retained input safely ([aeaa80e](https://github.com/danielbaars/anthracite/commit/aeaa80ed2caa1dd7892841c1ce3006dae6bd6cd0))
* **cli:** select absorb destinations per text hunk ([#41](https://github.com/danielbaars/anthracite/issues/41)) ([8a61cf4](https://github.com/danielbaars/anthracite/commit/8a61cf43267ff8e613f962203fdd6c1665781181))


### Bug Fixes

* **cli:** continue owned absorb construction conflicts ([fe2f2c1](https://github.com/danielbaars/anthracite/commit/fe2f2c136204c25296b7039cca8c4cecedbbb3c4))
* **cli:** guard absorb parent refs and recovery boundaries ([43442f0](https://github.com/danielbaars/anthracite/commit/43442f01402ced1794f2c08c4e38bc455d4c0f54))
* **cli:** guard absorb prospective staging and preview ([#45](https://github.com/danielbaars/anthracite/issues/45)) ([a65d361](https://github.com/danielbaars/anthracite/commit/a65d36109f7bf793a8dd9417417fb2cd6c29a8c9))
* **cli:** guard standalone absorb restoration from redirected Git ([b2e51fe](https://github.com/danielbaars/anthracite/commit/b2e51fe6444da9c3c260e9649ff7ec4093314d56))
* **cli:** preserve absorb input boundaries and document agent workflow ([728835f](https://github.com/danielbaars/anthracite/commit/728835fc651930d15c323893e60b08447d98d3b8))

## [0.2.1](https://github.com/danielbaars/anthracite/compare/v0.2.0...v0.2.1) (2026-10-28)


### Miscellaneous Chores

* release 0.2.1 for OIDC validation ([da0c99d](https://github.com/danielbaars/anthracite/commit/da0c99d0b5fafdfe7c2679d0f366a3da7a328df4))

## [0.2.0](https://github.com/danielbaars/anthracite/compare/v0.1.1...v0.2.0) (2026-10-28)


### Features

* **cli:** add npm distribution and release automation ([#36](https://github.com/danielbaars/anthracite/issues/36)) ([149f474](https://github.com/danielbaars/anthracite/commit/149f474dcd8ff15778e733e740374c2107b22443))


### Bug Fixes

* display direct children in branch info ([#26](https://github.com/danielbaars/anthracite/issues/26)) ([#28](https://github.com/danielbaars/anthracite/issues/28)) ([ddcb6d6](https://github.com/danielbaars/anthracite/commit/ddcb6d6b1083b797820a41232f2830f470969c4f))
* honor explicit zero depth in full log ([#2](https://github.com/danielbaars/anthracite/issues/2)) ([66fe405](https://github.com/danielbaars/anthracite/commit/66fe405c3bd396d32071a45a23e248f336fec155))
* honor zero depth in short log and aliases ([#3](https://github.com/danielbaars/anthracite/issues/3)) ([3ef4f06](https://github.com/danielbaars/anthracite/commit/3ef4f06ce33dcd430f347e3c0c960c636b898cfc))
* preserve zero-depth log inspection and recovery state ([#4](https://github.com/danielbaars/anthracite/issues/4)) ([2ebdde8](https://github.com/danielbaars/anthracite/commit/2ebdde8423d0415443a24d9065faad04f49b5d14))
