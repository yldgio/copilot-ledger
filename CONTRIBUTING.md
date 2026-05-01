# Contributing

Thanks for helping improve `copilot-ledger`.

This project currently accepts issues for bug reports, feature requests, documentation gaps, and design discussion. External pull requests are not accepted unless a maintainer explicitly invites one for a specific issue.

## Before opening an issue

1. Search existing issues to avoid duplicates.
2. Check the README and design document for the expected behavior.
3. Collect enough detail for maintainers to reproduce or evaluate the request.

## Bug reports

Include:

- Copilot CLI version
- Operating system
- Install location: user extension folder or workspace extension folder
- Steps to reproduce
- Expected behavior
- Actual behavior
- Relevant logs with secrets and private data removed

Do not include `.ledger/*.jsonl` files unless a maintainer explicitly asks for a redacted sample.

## Feature requests

Open an issue describing:

- The problem you want solved
- Who benefits from the change
- The workflow you expect
- Any privacy, security, or compatibility considerations

## Pull requests

Please do not open unsolicited implementation pull requests. Start with an issue and wait for a maintainer to confirm whether a pull request is appropriate.

When a maintainer asks for a pull request:

1. Keep the change focused on the agreed issue.
2. Update docs for behavior changes.
3. Add or update tests when code behavior changes.
4. Run the existing test suite before requesting review.

## Development

The extension code lives in `extension/`.

```bash
cd extension
npm install
npm test
```

Use the smallest diff that solves the issue and avoid unrelated refactors.
