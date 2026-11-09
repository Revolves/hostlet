# hostlet-skill

Agent skill for publishing static applications to [Hostlet](https://hostlet.cn) through [`hostlet-cli`](https://www.npmjs.com/package/hostlet-cli).

## Install

```sh
npx hostlet-skill install
```

The installer copies `SKILL.md`, `agents/`, and `references/` into `$CODEX_HOME/skills/hostlet-publish` by default.

Install into a project-local skills directory:

```sh
npx hostlet-skill install --target ./.codex/skills/hostlet-publish
```

From a source checkout:

```sh
node skills/hostlet-publish/install.js --target ./.agents/skills/hostlet-publish
```

Start a new agent session after installation so the skill is discovered.

## CLI dependency

```sh
npm install -g hostlet-cli
```

Create a 30-day API credential with `read`, `publish`, and optionally `share` scopes, then set `HOSTLET_TOKEN`. `HOSTLET_URL` defaults to `https://hostlet.cn`; set it for a self-hosted instance.

## Links

- GitHub: <https://github.com/Revolves/hostlet/tree/master/skills/hostlet-publish>
- npm: <https://www.npmjs.com/package/hostlet-skill>
- CLI: <https://www.npmjs.com/package/hostlet-cli>
- Issues: <https://github.com/Revolves/hostlet/issues>
