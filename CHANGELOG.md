# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- Share link IDs shortened from 12 hex chars to 7 chars using an unambiguous alphabet (no 0/o, 1/i/l); ~21 billion combinations

## [0.1.1] - 2026-05-16

### Added
- Live upload speed display per file during upload, updated every 0.5s with EMA smoothing

## [0.1.0] - 2026-05-16

### Fixed
- CSS `[disabled]` attribute selector matched `<a disabled="false">`, causing `pointer-events: none` on all `.btn` anchor elements regardless of actual disabled state; changed to `[disabled="true"]`

### Changed
- Replaced the small add-files button with a dashed drop zone row at the bottom of the file list, consistent with the main drop area style
- Updated `dropFilesHere` lang string (en) to mention clicking as well as dropping

[Unreleased]: https://github.com/nikolainyegaard/nyshare/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/nikolainyegaard/nyshare/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/nikolainyegaard/nyshare/releases/tag/v0.1.0
