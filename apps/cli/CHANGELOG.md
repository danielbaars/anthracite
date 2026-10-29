# Changelog

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
