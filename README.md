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

The documented configuration uses a GitHub App even when `create-fix-pr` is
`false`. The App, rather than Dependabot, authors the review comment and any
remediation PR. `actions/create-github-app-token` exchanges the App credentials
for a short-lived installation token that the review action can use.

This is an authentication choice made by this action, not a consequence of
Dependabot being the PR author. GitHub can also grant the workflow's built-in
`GITHUB_TOKEN` write permission through the workflow's `permissions` block.
Using a separate App provides an explicit automation identity and, for
remediation PRs, avoids the special workflow-triggering restrictions that
apply to changes made with `GITHUB_TOKEN`.

### Required permissions

For review comments only (`create-fix-pr: false`), grant these repository
permissions to the GitHub App:

- **Contents:** Read
- **Pull requests:** Read
- **Issues:** Read and write
- **Metadata:** Read

When remediation PRs are enabled (`create-fix-pr: true`), increase:

- **Contents:** Read and write
- **Pull requests:** Read and write

Contents write access is needed to push the remediation branch, and pull
requests write access is needed to open the separate remediation PR.

### Create and install the App

1. Under your personal or organization settings, open **Developer settings**,
   then **GitHub Apps**, and select **New GitHub App**.
2. Give the App the repository permissions listed above. A webhook is not
   required for this action.
3. On the App settings page, generate a private key and download the `.pem`
   file.
4. Select **Install App** and install it on the repository or repositories that
   will run this action.
5. Open the repository's **Settings**, select **Secrets and variables**,
   **Dependabot**, and add the following
   [Dependabot secrets](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/manage-your-dependency-security/configure-access-to-private-registries#storing-credentials-for-dependabot-to-use):

| Secret | Value |
| --- | --- |
| `REVIEW_APP_ID` | The numeric App ID shown on the GitHub App settings page |
| `REVIEW_APP_PRIVATE_KEY` | The complete contents of the generated `.pem` private-key file |
| `OPENAI_API_KEY` | A restricted project service-account key; see **OpenAI API setup** below |

GitHub selects the available secret store from the actor that triggered the
workflow, not from the identity that will later make API calls. Because the
`pull_request` workflow is triggered by `dependabot[bot]`, ordinary repository
or organization Actions secrets are not exposed to the run; only Dependabot
secrets populate the `secrets` context. The generated installation token then
authenticates subsequent comments, branch pushes, and PR creation as the
GitHub App.

These values must therefore be configured as Dependabot secrets for this
workflow. If another workflow also needs them when triggered by non-Dependabot
actors, store equivalent Actions secrets separately, usually under the same
names. Keep the private key restricted to administrators and rotate it if it
is exposed. See GitHub's
[Dependabot workflow restrictions](https://docs.github.com/en/code-security/dependabot/troubleshooting-dependabot/troubleshooting-dependabot-on-github-actions)
for the underlying token and secret rules.

See GitHub's documentation for
[registering a GitHub App](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app),
[installing your own GitHub App](https://docs.github.com/en/apps/using-github-apps/installing-your-own-github-app),
and
[`actions/create-github-app-token`](https://github.com/actions/create-github-app-token).

## OpenAI API setup

The action sends repository context and dependency information to
`POST /v1/responses`. It does not upload files, create Assistants, fine-tune
models, or manage OpenAI resources.

For automation, use a dedicated OpenAI project and project service account
rather than a personal key:

1. Open the
   [OpenAI projects page](https://platform.openai.com/settings/organization/projects)
   and create a project for this action, for example
   `dependabot-review-action`.
2. In that project's **Members** settings, create a service account with a
   descriptive name, for example `dependabot-review-action GitHub`. Copy the
   generated secret immediately; OpenAI only displays the full value once.
3. Keep the new project selected in the project switcher, open **API Keys** in
   the main navigation, find the service-account key, select its edit control,
   and set **Permissions** to **Restricted**.
4. Configure the key permissions as follows:

| Section | Setting | Permission |
| --- | --- | --- |
| **Model capabilities** | Responses (`/v1/responses`) | **Read-write** |
| **Model capabilities** | Text-to-speech, Realtime, Chat completions, Embeddings, Images, Moderations | **None** |
| Other settings | List models, Assistants, Threads, Evals, Fine-tuning, Files, Videos, Vector Stores, Prompts, Datasets | **None** |

The action only sends `POST /v1/responses` requests, so it does not need
permission to list models or use any other endpoint. **Read** is insufficient
because creating a response requires **Read-write**.

5. Store the secret value as the `OPENAI_API_KEY` Dependabot secret described
   above. Do not commit it, include it directly in workflow YAML, or expose it
   in logs.

Service-account keys initially receive broad project API access. Review and
restrict the key after creating the service account. For a user-owned key, the
same **All**, **Restricted**, or **Read Only** choice appears in the key-creation
dialog; select **Restricted**.

### Limit usage and spend

In the dedicated project's **Limits** settings:

- Enable only the model configured by the workflow's `openai-model` input.
- Lower that model's request and token rate limits to suit the expected number
  and size of Dependabot PRs. Keep the token limit large enough for the
  repository-context budget configured by `max-context-characters`.
- Set a monthly project budget and notification thresholds.

OpenAI project budgets are alerting thresholds, not hard spending caps:
requests continue after the budget is exceeded. Model restrictions, rate
limits, key rotation, and usage monitoring remain important. API billing is
also separate from ChatGPT subscriptions; configure the
[API billing account](https://platform.openai.com/account/billing/overview)
before expecting the workflow to run.

See OpenAI's documentation for
[API-key permissions](https://help.openai.com/en/articles/8867743-assign-api-key-permissions),
[project service accounts and limits](https://help.openai.com/en/articles/9186755-managing-projects-in-the-api-platform),
[API-key safety](https://platform.openai.com/docs/api-reference/authentication),
and
[Responses API access](https://platform.openai.com/docs/guides/rbac).

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
          github-app-token: ${{ steps.app-token.outputs.token }}
          openai-api-key: ${{ secrets.OPENAI_API_KEY }}
          openai-model: your-approved-model
          create-fix-pr: false
```

Set `create-fix-pr: true` to allow a separate remediation PR and grant the App
the additional write permissions described above. The Dependabot branch must
exist in the same repository, and the checkout must point exactly at the pull
request head SHA.

## Inputs

| Input | Required | Default | Description |
| --- | --- | --- | --- |
| `github-app-token` | Yes | | GitHub App installation token with permission to publish review comments |
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
