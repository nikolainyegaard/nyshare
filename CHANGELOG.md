# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- Archive downloads sent a misspelled `ContentType` header instead of `Content-Type`, so zip/tar.gz responses had no content type
- One-time files could be skipped during cleanup after a "download all" because the bucket list was modified while being iterated
- A failed post-download cleanup could crash the server via an unhandled promise rejection
- Resuming an upload into a locked bucket was not rejected; the lock check read a metadata field that was never written
- Per-file size display used a wrong field name when an upload finished
- Offline auto-resume could stop re-attaching after a manual retry
- Error page still showed PsiTransfer branding and used FontAwesome icon classes that no longer exist, rendering blank icons

### Changed
- Admin login now uses constant-time credential comparison
- UI polish: subtle panel and modal shadows, green progress bars, modal fade-in with blurred backdrop, visible keyboard focus rings, softer corner rounding, alert accent border

### Removed
- Unused dependencies (`common-streams` backend, `uuid` frontend), leftover polyfill files and dead code

## [0.1.2] - 2026-06-03

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

[Unreleased]: https://github.com/nikolainyegaard/nyshare/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/nikolainyegaard/nyshare/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/nikolainyegaard/nyshare/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/nikolainyegaard/nyshare/releases/tag/v0.1.0
