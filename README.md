# Dependabot Review Action

Review npm, pnpm, and GitHub Actions updates before merging them.

The action supports two modes:

- **Prompt mode** is the default. It collects release notes and upstream source
  changes, then posts a ready-to-copy prompt on the Dependabot pull request.
  Paste that prompt into an AI-enabled IDE where the repository is already
  available. No OpenAI API key, API billing, or GitHub App is required.
- **OpenAI mode** sends bounded repository context and upstream evidence to the
  OpenAI Responses API, then posts an automated codebase-impact review. It can
  optionally create a separate remediation PR.

The action does not install dependencies, execute repository code, run
lifecycle scripts, or merge changes.

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

## Default prompt mode

Prompt mode detects dependency updates, resolves their upstream repositories,
and fetches bounded release notes and version-to-version source diffs. It
publishes that evidence inside a prompt which asks a local IDE agent to inspect
the checked-out repository, assess compatibility, implement required changes,
and run relevant tests.

Repository source code is never included in the prompt comment. Upstream
release notes, commit messages, and diffs are explicitly marked as untrusted
data. Large evidence is truncated while source, release, and comparison links
are retained.

```yaml
name: Dependabot review

on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  contents: read
  pull-requests: write

jobs:
  review:
    if: github.actor == 'dependabot[bot]'
    runs-on: ubuntu-latest
    steps:
      - name: Prepare dependency review prompt
        uses: mfranzke/dependabot-review-action@v0.1.0
        with:
          github-token: ${{ github.token }}
```

The explicit `pull-requests: write` permission allows the built-in
`GITHUB_TOKEN` to create or update the PR comment. The comment is authored by
`github-actions[bot]`.

Dependabot `pull_request` workflows are treated like fork workflows. In the
repository's **Settings → Actions → General → Fork pull request workflows**,
enable **Send write tokens to workflows from pull requests** when that control
is available. Without permission to send a write token, GitHub downgrades the
requested scope and comment creation fails with
`Resource not accessible by integration`. If repository or organization
policy does not expose or allow that control, use a GitHub App installation
token instead. See
[GitHub's Actions permission settings](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository).

## Automated OpenAI review

Set `review-mode: openai` to perform the review on GitHub. This mode checks out
the Dependabot head, collects eligible text files from the repository, and asks
the OpenAI Responses API for strict structured analysis.

```yaml
name: Dependabot automated review

on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  contents: read
  pull-requests: write

jobs:
  review:
    if: github.actor == 'dependabot[bot]'
    runs-on: ubuntu-latest
    steps:
      - name: Check out the Dependabot head
        uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
        with:
          ref: ${{ github.event.pull_request.head.sha }}
          fetch-depth: 0
          persist-credentials: false

      - name: Review dependency update
        uses: mfranzke/dependabot-review-action@v0.1.0
        with:
          github-token: ${{ github.token }}
          review-mode: openai
          openai-api-key: ${{ secrets.OPENAI_API_KEY }}
          openai-model: gpt-5.4
```

The `OPENAI_API_KEY` must be stored as a
[Dependabot secret](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/manage-your-dependency-security/configure-access-to-private-registries#storing-credentials-for-dependabot-to-use).
Ordinary Actions secrets are not exposed to workflows triggered by
Dependabot.

Repository content, changelogs, and upstream diffs are treated as untrusted
data in model instructions. Review your organization's source-code and AI data
policies before enabling this mode.

This workflow needs the same **Send write tokens to workflows from pull
requests** repository setting described above. The action reads checked-out
repository content but does not execute it.

### OpenAI API setup

ChatGPT Free, Plus, Pro, Business, and Enterprise subscriptions do not include
general OpenAI API usage. The API Platform is a separate pay-as-you-go service.
Prompt mode remains available without API billing.

For automated review, use a dedicated OpenAI project and project service
account rather than a personal key:

1. Open the
   [OpenAI projects page](https://platform.openai.com/settings/organization/projects)
   and create a project such as `dependabot-review-action`.
2. In the project's **Members** settings, create a service account such as
   `dependabot-review-action GitHub`. Copy the secret immediately.
3. Keep that project selected, open **API Keys** in the main navigation, edit
   the service-account key, and set **Permissions** to **Restricted**.
4. Configure the key permissions:

| Section | Setting | Permission |
| --- | --- | --- |
| **Model capabilities** | Responses (`/v1/responses`) | **Read-write** |
| **Model capabilities** | Text-to-speech, Realtime, Chat completions, Embeddings, Images, Moderations | **None** |
| Other settings | List models, Assistants, Threads, Evals, Fine-tuning, Files, Videos, Vector Stores, Prompts, Datasets | **None** |

The implementation only sends `POST /v1/responses` requests. It does not need
permission to list models or use other endpoints.

5. Store the key as the `OPENAI_API_KEY` Dependabot secret. Do not commit it or
   place it directly in workflow YAML.

The `openai-model` value must be the exact, case-sensitive API identifier, not
the display name. For example, use `gpt-5.4`, not `GPT-5.4`. Consult the
[OpenAI model catalog](https://developers.openai.com/api/docs/models) and
enable the selected model in the project's **Limits** settings.

### Usage and quota

In the OpenAI project's **Limits** settings:

- Enable only the configured model.
- Set suitable request and token rate limits.
- Set a monthly project budget and notification thresholds.

Project budgets are alerts, not hard spending caps. An HTTP `429` with
`code: insufficient_quota` indicates unavailable API billing or organization
quota, not a temporary request-rate limit. Check:

1. [Billing overview](https://platform.openai.com/settings/organization/billing/overview)
2. [Credit balance](https://platform.openai.com/settings/organization/billing/credit-grants)
3. [Usage dashboard](https://platform.openai.com/usage)
4. [Organization limits](https://platform.openai.com/settings/organization/limits)

See OpenAI's documentation for
[API-key permissions](https://help.openai.com/en/articles/8867743-assign-api-key-permissions),
[project service accounts and limits](https://help.openai.com/en/articles/9186755-managing-projects-in-the-api-platform),
[API error codes](https://platform.openai.com/docs/guides/error-codes), and
[Responses API access](https://platform.openai.com/docs/guides/rbac).

## Remediation PRs

Set `create-fix-pr: true` in OpenAI mode to ask the model for a minimal patch
and open a separate PR based on the Dependabot branch.

The supported remediation configuration uses a GitHub App installation token,
not the built-in `GITHUB_TOKEN`. Events created with `GITHUB_TOKEN` normally do
not trigger new workflow runs, while a GitHub App gives the remediation PR its
own automation identity and allows normal CI to run.

Create and install a GitHub App with these repository permissions:

- **Contents:** Read and write
- **Pull requests:** Read and write
- **Issues:** Read and write
- **Metadata:** Read

Generate a private key, install the App on the repository, and add these
Dependabot secrets:

| Secret | Value |
| --- | --- |
| `REVIEW_APP_ID` | Numeric App ID from the GitHub App settings page |
| `REVIEW_APP_PRIVATE_KEY` | Complete contents of the generated `.pem` file |
| `OPENAI_API_KEY` | Restricted OpenAI project service-account key |

```yaml
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

      - name: Review and remediate dependency update
        uses: mfranzke/dependabot-review-action@v0.1.0
        with:
          github-token: ${{ steps.app-token.outputs.token }}
          review-mode: openai
          openai-api-key: ${{ secrets.OPENAI_API_KEY }}
          openai-model: gpt-5.4
          create-fix-pr: true
```

The Dependabot branch must exist in the same repository, and the checkout must
point exactly at the pull request head SHA. Token provenance cannot be detected
reliably by the action; insufficient App permissions surface as GitHub API or
Git push errors.

See GitHub's documentation for
[registering a GitHub App](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app),
[installing your own GitHub App](https://docs.github.com/en/apps/using-github-apps/installing-your-own-github-app),
and
[`actions/create-github-app-token`](https://github.com/actions/create-github-app-token).

## Inputs

| Input | Required | Default | Description |
| --- | --- | --- | --- |
| `github-token` | Yes | | Token that can read the PR and publish issue comments |
| `review-mode` | No | `prompt` | `prompt` or `openai` |
| `openai-api-key` | In `openai` mode | | OpenAI API key |
| `openai-model` | In `openai` mode | | Exact API model ID, for example `gpt-5.4` |
| `openai-base-url` | No | `https://api.openai.com/v1` | Responses API base URL |
| `gitlab-token` | No | | Token for private GitLab projects or higher limits |
| `create-fix-pr` | No | `false` | Create a separate remediation PR; requires `openai` mode and a GitHub App token |
| `max-context-characters` | No | `600000` | Repository context budget in `openai` mode |
| `exclude` | No | | Newline-separated repository path globs excluded from OpenAI context |

## Outputs

| Output | Description |
| --- | --- |
| `review-comment-url` | Maintained review comment URL |
| `risk-level` | `low`, `medium`, `high`, or `critical` in OpenAI mode; empty in prompt mode |
| `fix-required` | Whether OpenAI identified required changes; empty in prompt mode |
| `fix-pr-url` | Remediation PR URL, when created |
| `dependencies-reviewed` | Number of grouped updates reviewed |

## Remediation safety

Generated patches are rejected when they:

- are not unified Git diffs
- contain absolute paths or parent traversal
- modify workflows, lockfiles, `.env` files, private keys, or certificates
- fail `git apply --check --whitespace=error`
- target a checkout that does not match the Dependabot head SHA

The action never executes model-generated commands. The remediation branch is
deterministic (`dependabot-review/fix-<number>`) and refreshed on reruns.
Normal repository CI remains responsible for installation, builds, and tests.

## pnpm 11 notes

pnpm 11 itself requires Node.js 22 or newer. The action runs with GitHub
Actions' Node 24 runtime but never invokes pnpm.

pnpm 9, 10, and 11 can all use `lockfileVersion: '9.0'`. The action therefore
feature-detects pnpm 11 metadata rather than inferring the package-manager major
from the lockfile version. Workspace links are ignored unless their external
resolution changes.

## Development

Node.js 24 is required.

```sh
corepack enable
pnpm install
pnpm check
```

The runtime has no production Node dependencies. TypeScript uses erasable
syntax and is executed directly by Node 24.
