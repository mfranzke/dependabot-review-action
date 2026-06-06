# Dependabot AI Review Action

An AI-assisted reviewer for Dependabot pull requests that update npm packages,
pnpm projects, or GitHub Actions. It compares release information and upstream
source changes, checks their likely impact on the consuming repository, and
maintains one review comment on the Dependabot PR.

The action complements human review. It does not install dependencies, execute
repository code, run lifecycle scripts, or merge changes.

## Supported updates

- npm lockfile versions 2 and 3
- pnpm lockfile versions 6 through 9
- pnpm 11.x projects, including workspaces/importers, catalogs, npm aliases,
  peer-suffixed snapshots, `dedupePeers`, simplified `patchedDependencies`,
  config dependency metadata, and package-manager resolution metadata
- GitHub Actions referenced by `uses:` in `.github/workflows/*.yml`
- Grouped Dependabot pull requests
- Public GitHub and GitLab upstream repositories

Yarn lockfiles are not supported.

## How it works

1. The action reads changed dependency files from the base and head commits via
   the GitHub API.
2. It resolves npm package source repositories from registry metadata.
3. It fetches release notes and bounded tag comparisons from GitHub or GitLab.
4. It collects eligible text files from the checked-out repository, excluding
   common secrets, credentials, binaries, dependencies, and generated output.
5. It asks the OpenAI Responses API for strict structured analysis.
6. It creates or edits a marker-based comment on the Dependabot PR.
7. When enabled, it asks for a minimal patch, validates it, and opens a separate
   PR whose base is the Dependabot branch.

Repository content, changelogs, and upstream diffs are treated as untrusted
data in model instructions. Review your organization's source-code and AI data
policies before enabling the action.

## GitHub App setup

Automatic Dependabot workflows receive a read-only built-in `GITHUB_TOKEN`.
Create a GitHub App instead, install it on each consuming repository, and grant:

- **Contents:** Read and write
- **Pull requests:** Read and write
- **Issues:** Read and write
- **Metadata:** Read

Store the App ID, private key, and OpenAI key as
[Dependabot secrets](https://docs.github.com/en/code-security/dependabot/working-with-dependabot/managing-encrypted-secrets-for-dependabot).
Do not store them only as ordinary Actions secrets.

## Example workflow

```yaml
name: Dependabot AI review

on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  contents: read

jobs:
  review:
    if: github.actor == 'dependabot[bot]'
    runs-on: ubuntu-latest
    steps:
      - name: Create installation token
        id: app-token
        uses: actions/create-github-app-token@67018539274d69449ef7c02e8e71183d1719ab42 # v2.1.4
        with:
          app-id: ${{ secrets.REVIEW_APP_ID }}
          private-key: ${{ secrets.REVIEW_APP_PRIVATE_KEY }}

      - name: Check out the Dependabot head
        uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
        with:
          ref: ${{ github.event.pull_request.head.sha }}
          fetch-depth: 0
          persist-credentials: false

      - name: Review dependency update
        uses: mfranzke/dependabot-review-action@v1
        with:
          github-token: ${{ steps.app-token.outputs.token }}
          openai-api-key: ${{ secrets.OPENAI_API_KEY }}
          openai-model: your-approved-model
          create-fix-pr: false
```

Set `create-fix-pr: true` to allow a separate remediation PR. This requires the
Dependabot branch to exist in the same repository and the checkout to point
exactly at the pull request head SHA.

## Inputs

| Input | Required | Default | Description |
| --- | --- | --- | --- |
| `github-token` | Yes | | Write-capable GitHub App token |
| `openai-api-key` | Yes | | OpenAI API key |
| `openai-model` | Yes | | Model approved by the consuming organization |
| `openai-base-url` | No | `https://api.openai.com/v1` | Responses API base URL |
| `gitlab-token` | No | | Token for private GitLab projects or higher limits |
| `create-fix-pr` | No | `false` | Enable a separate remediation PR |
| `max-context-characters` | No | `600000` | Repository context budget |
| `exclude` | No | | Newline-separated path globs |

## Outputs

| Output | Description |
| --- | --- |
| `review-comment-url` | Maintained review comment URL |
| `risk-level` | `low`, `medium`, `high`, or `critical` |
| `fix-required` | Whether required repository changes were identified |
| `fix-pr-url` | Remediation PR URL, if one was created |
| `dependencies-reviewed` | Number of grouped updates reviewed |

## pnpm 11 notes

pnpm 11 itself requires Node.js 22 or newer. The action runs with GitHub
Actions' Node 24 runtime but never invokes pnpm, so it can review repositories
without installing their declared package-manager version.

pnpm 9, 10, and 11 can all use `lockfileVersion: '9.0'`. The action therefore
feature-detects pnpm 11 metadata rather than inferring the package-manager major
from the lockfile version. `packageManager` and `devEngines.packageManager` are
used when present.

Config dependencies and package-manager resolution metadata are inspected for
format compatibility but are not reported as ordinary application dependency
updates. Workspace links are ignored unless their external resolution changes.

## Remediation safety

Generated patches are rejected when they:

- are not unified Git diffs
- contain absolute paths or parent traversal
- modify workflows, lockfiles, `.env` files, private keys, or certificates
- fail `git apply --check --whitespace=error`
- target a checkout that does not match the Dependabot head SHA

The action never executes model-generated commands. The remediation branch is
deterministic (`dependabot-review/fix-<number>`) and is refreshed on reruns.
Normal repository CI remains responsible for installation, builds, and tests.

## Development

Node.js 24 is required.

```sh
corepack enable
pnpm install
pnpm check
```

The runtime has no production Node dependencies. TypeScript uses erasable syntax
and is executed directly by Node 24.
