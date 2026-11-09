# Dashboard data

The coach dashboard reads `games.json` from this folder. Right now it holds **sample data**
made by `make-sample-data.mjs`. When your analysis model is ready, have it write `games.json`
in the same shape and the dashboard will show the real results with no other changes.

## Shape

```json
{
  "team": "Team name",
  "sample": false,
  "games": [
    {
      "id": "game-14",
      "number": 14,
      "date": "2026-11-03",
      "opponent": "Storm",
      "home": true,
      "score": { "team": 78, "opp": 71 },
      "quarters": [ { "q": 1, "team": 20, "opp": 17, "tov": 3, "fouls": 4 } ],
      "players": [
        { "no": 7, "pos": "Point guard", "starter": true, "min": 32, "pts": 21,
          "reb": 3, "ast": 6, "tov": 2, "stl": 1,
          "fgm": 8, "fga": 16, "tpm": 3, "tpa": 7, "ftm": 2, "fta": 2, "pm": 9 }
      ],
      "lineups": [ { "name": "Starters", "players": [7, 11, 23, 32, 44], "min": 14, "pm": 8 } ],
      "shots": [ { "player": 7, "q": 2, "x": -12.4, "y": 18.1, "zone": "Mid-range", "three": false, "made": true } ]
    }
  ]
}
```

## Notes

- **Games:** listed oldest first; the dashboard opens on the last one.
- **Shot positions** are in feet on a half court: `x` runs across (-25 to 25, 0 is the middle) and
  `y` runs out from the baseline (0 to 47). The rim is at `x: 0, y: 5.25`.
- **Zones:** `Paint`, `Mid-range`, `Corner 3` or `Above-break 3`.
- **Quarters:** `q` is 1 to 4; add 5 and up for overtime.
- **Points** for a player are `2 × (fgm − tpm) + 3 × tpm + ftm`.
- Set `"sample": false` when the data is real, and the dashboard drops its "sample data" note.
