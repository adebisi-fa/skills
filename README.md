# yrka-skills

Reusable skills for developer tooling and coding workflows.

## Included Skills

- `skills/evtstore-quickstart`
  - Start here to build your first `evtstore`-backed feature quickly in a TypeScript/Node.js project.
- `skills/evtstore-reference`
  - Detailed reference for `evtstore` aggregates, commands, projections, providers, handler lifecycle, and advanced patterns.
  - Covers projection integrity (position guards), throughput (bookmark coalescing and a write buffer), read-after-write waits, health and rebuilds, shutdown, and appends generic Node.js and SvelteKit wiring.

## Structure

```text
skills/
  evtstore-quickstart/
    SKILL.md
  evtstore-reference/
    SKILL.md
```

## License

MIT

## Checks

```bash
npm install     # once, for the API-drift layer
npm run check   # sections, anchors, fences, forbidden guidance, library symbols
```

`scripts/check-skills.mjs` verifies that every in-page anchor resolves to a
heading, code fences balance, the required sections exist, no fixed-delay
read-after-write guidance survives outside the anti-pattern section, and the
library symbols the skills teach still appear in the installed `evtstore`,
`mongodb` and `@sveltejs/adapter-node` typings.

Without the devDependencies it runs the structure checks and warns that the symbol
checks were skipped; `--strict` makes that a failure, which is what a CI job should
use. `--modules=<dir>` resolves the packages from another `node_modules`, and
`--check-installed` also diffs the repository copy against
`~/.agents/skills/evtstore-reference`.
