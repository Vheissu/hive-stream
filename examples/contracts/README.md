# Contract Examples

These are small, self-contained snippets that show how to register and call the built-in contracts using the new `defineContract/action` system.

- `rps.ts` - Rock/Paper/Scissors game example
- `poll.ts` - Poll creation and voting
- `tipjar.ts` - Tip jar with message
- `exchange.ts` - Exchange pair creation, deposit, and order placement

Additional high-level flow examples live in `examples/flows/`:

- `auto-burn.ts` - Automatically burn a percentage of inbound HIVE/HBD transfers using `streamer.flows`
- `auto-forward.ts` - Forward inbound HIVE/HBD transfers to another account
- `auto-split.ts` - Split inbound HIVE/HBD transfers across multiple recipients
- `auto-refund.ts` - Refund inbound HIVE/HBD transfers back to the sender
