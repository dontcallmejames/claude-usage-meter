# usage-meter

A small Claude Code mod that puts your usage just above the prompt box.

```
ctx ▰▰▰▱▱  5h ▰▱▱▱▱  7d ▰▰▰▱▱  $1.84
```

Hover over it to see the details:

```
ctx    42%  84k / 200k        messages 52k · tools 18k · mcp 9k · system 3k
5h     23%  resets 2h14m
7d     61%  resets Thu 9:00
turn        12k in            1k out · 41k cached (89%)
```

- **ctx**: how full the context window is, with the biggest categories from `/context`
- **5h / 7d**: your rate-limit windows and when they reset (only shown on a subscription)
- **turn**: tokens for the last turn, and how much came from the prompt cache
- **$**: what the session has cost so far

Colors come from your Claude Code theme. Bars are green below 60%, yellow up to 85%, red past that. The context breakdown is estimated locally, so the meter doesn't make any extra API calls.

Works in the terminal and in the Claude desktop app's Code tab. In a terminal, hover needs mouse reporting (fullscreen mode).

## Install

In a Claude Code session, run:

```
/plugin install usage-meter --marketplace dontcallmejames/claude-usage-meter
```

Answer `y` to add the marketplace, then press Enter to install it for your user. The meter shows up right away and in every session after that.

## Develop

```
claude plugin validate .
claude plugin test .
```

Or load a local checkout without installing it: `claude --plugin-dir <path to this folder>`.
