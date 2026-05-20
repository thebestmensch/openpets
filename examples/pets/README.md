# Example pets

OpenPets includes real Petdex-compatible pet packs for demos and alpha testing.

Each pet directory contains:

- `pet.json`
- `spritesheet.webp` or `spritesheet.png` at `1536x1872`
- 8 columns × 9 rows of `192x208` frames

## Included pets

| Pet | Path | Description |
|---|---|---|
| Slayer | `examples/pets/slayer` | A compact armored slayer digital pet with a green sci-fi helmet, bulky olive armor, and a round spiked shield. |
| Bean | `examples/pets/bean` | JM's tricolor Mini Australian Shepherd × Blue Heeler mix. |
| Gia | `examples/pets/gia` | JM's agouti-mask Siberian Husky with ice-blue eyes. |
| Ruthie | `examples/pets/ruthie` | JM's red-and-white Alaskan Klee Kai. |
| Ollie | `examples/pets/ollie` | A scruffy black tricolor Mini Australian Shepherd puppy. |
| Couple | `examples/pets/couple` | Pixel-art chibi bust portrait of JM and partner. |

## Usage

```bash
openpets start --pet ./examples/pets/slayer
openpets start --pet ./examples/pets/bean
openpets start --pet ./examples/pets/gia
openpets start --pet ./examples/pets/ruthie
openpets start --pet ./examples/pets/ollie
openpets start --pet ./examples/pets/couple
```

Or, from source (after `bun install && bun run build`):

```bash
bun packages/cli/src/index.ts start --pet ./examples/pets/bean
```

Replace `bean` with any pet directory name above.

The legacy generated minimal sample remains available at `examples/sample-pet` for loader testing.

## Notes on Recraft-sourced pets (bean / gia / ruthie / ollie / couple)

These pet packs are sourced via Recraft web UI. They use Option B sprite layout: 1 hero pose per row, replicated across 8 columns — state changes work, but no within-row animation. Rows 6/7/8 (waiting / running / review) reuse idle as a placeholder so the loader passes.
