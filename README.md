<div align="center">

# jules-wrapped

**Your year in code, beautifully visualized.**

<p>
  <strong>Credit:</strong> Built on top of
  <a href="https://github.com/moddi3/opencode-wrapped">opencode-wrapped</a>
  by moddi3 (<a href="https://x.com/moddi3io">@moddi3io</a>).
</p>

Generate a personalized "Spotify Wrapped"-style summary of your Jules usage.

Inspired by <a href="https://github.com/numman-ali/cc-wrapped">cc-wrapped</a> and <a href="https://github.com/numman-ali/codex-wrapped">codex-wrapped</a> by <a href="https://x.com/nummanali">numman-ali</a>.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Bun](https://img.shields.io/badge/Bun-%23000000.svg?logo=bun&logoColor=white)](https://bun.sh)

<img src="./assets/images/demo-wrapped.png" alt="Jules Wrapped Example" width="600" />

</div>

---

## Installation

Run directly using your preferred package manager:

```bash
npx jules-wrapped # or bunx, pnpx, yarn dlx
```

> [!IMPORTANT]
> **Privacy:** Your Jules API key is only used to fetch data from the official Jules API and is never shared elsewhere.
> **Performance:** The Jules API has strict rate limits; generating your summary may take several minutes.

## Options

| Option          | Description                          |
| --------------- | ------------------------------------ |
| `--year, -y`    | Generate wrapped for a specific year |
| `--api-key`     | Jules API key (prompted if omitted)  |
| `--sample`      | Use bundled sample data              |
| `--hide-top-repos` | Hide Top Worked Repos in the image |
| `--no-clipboard`| Skip copying the image to clipboard  |
| `--no-save`     | Skip saving the image to disk        |
| `--no-share`    | Skip share prompt                    |

## Terminal Support

Images display natively in **Ghostty, Kitty, WezTerm, iTerm2, and Konsole**. In other terminals, the wrapped card is saved as a PNG to your home directory.

## Development

```bash
bun run dev    # Development with hot reload
bun run build  # Production build
```

## License

MIT License - see [LICENSE](LICENSE) for details.

---

<div align="center">

Built for the Jules community

Credit: <a href="https://github.com/ryoppippi/ccusage">ccusage</a>

</div>
