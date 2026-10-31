# Contributing to GNU Radio 4 Studio

Keep changes focused and include a description of the problem, the resulting
behavior, and how you tested it in your pull request. See the [README](README.md)
for development and build instructions.

## Developer Certificate of Origin

Every commit in a pull request must include a `Signed-off-by` line certifying
that you agree to the [Developer Certificate of Origin (DCO)](https://github.com/gnuradio/gr-governance/blob/main/DCO.txt).
Read the DCO before signing off your contributions.

Use your name and email address in your Git configuration, then add a signoff
when committing:

```sh
git commit -s -m "Describe the change"
```

This adds a trailer to the commit message:

```text
Signed-off-by: Your Name <you@example.com>
```

To add a missing signoff to your latest commit:

```sh
git commit --amend --no-edit -s
```

To add your signoff to multiple commits you authored on a topic branch:

```sh
git fetch origin
git rebase --signoff origin/main
```

If those commits were already pushed, update your branch with
`git push --force-with-lease`. Coordinate with other contributors before
rewriting a shared branch.

The pull request workflow runs one DCO check covering every commit. Tests,
type checking, and WASM builds wait for it to pass. Main-branch pushes and
manual builds do not run the pull request signoff check.

## Validation

Install dependencies and run the frontend checks before submitting changes:

```sh
npm ci
npm test
npx tsc -b
```

For Studio block or binding changes, also review
[the architecture](docs/studio-blocks-architecture.md) and
[the payload contracts](docs/studio-blocks-payload-contracts.md), and run the
relevant native block checks.
