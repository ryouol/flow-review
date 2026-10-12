# GitHub review integration

The quickest entry point is a PR URL:

```sh
node dist/cli.js pr --url https://github.com/owner/repository/pull/123 --out reports/pr-123.html
```

The GitHub CLI reads PR metadata using the account already signed in on the machine. Flow Review fetches the pinned Git objects into its own temporary bare repository. It does not change the author's checkout, run the reviewed repository, create comments, approve a PR, or merge it. Generated reports remain local.

## Generate a workflow artifact

This composite-action example assumes the trusted Flow Review tool is available at `.tools/flow-review` (vendor a reviewed version or check out a pinned tool commit separately). Fetch both commit histories in the target checkout. Run the workflow on a normal `pull_request` event with read-only permissions. Do not combine privileged `pull_request_target` credentials with untrusted source execution.

```yaml
name: Read the change
on: pull_request
permissions:
  contents: read
jobs:
  report:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.pull_request.head.sha }}
          fetch-depth: 0
      # Check out or vendor a trusted, pinned Flow Review tool at .tools/flow-review.
      # A private cross-repository checkout/action needs separately authorized access.
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - uses: ./.tools/flow-review
        id: reader
        with:
          base: ${{ github.event.pull_request.base.sha }}
          head: ${{ github.event.pull_request.head.sha }}
      - uses: actions/upload-artifact@v4
        with:
          name: flow-review
          path: |
            ${{ steps.reader.outputs.html }}
            ${{ steps.reader.outputs.json }}
```

The tool checkout and its dependency/build commands must come from trusted tool source, not a folder modified by the PR being reviewed. Artifacts inherit the repository/workflow access rules. Download the artifact and open `report.html`; its code, navigation, and reading ledger work without a server. Adding a PR comment with a link is an optional integration step, not a behavior enabled by this action.

The product's own CI exercises the action on identical refs and separately exercises changed Git snapshots in adversarial tests. A production team should pin action/dependency versions according to its own policy and validate its fork/access configuration before rollout.
